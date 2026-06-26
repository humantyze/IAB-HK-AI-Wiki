import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { db, uploadsTable, wikiPagesTable } from "@workspace/db";
import type { ProcessingError } from "@workspace/db";
import { requireAuth, requireSuperAuth } from "../middlewares/auth";
import { extractWikiPages, describeDocumentVisuals } from "../lib/ai-service";
import { indexSource, removeSource, indexWikiPage } from "../lib/knowledge-index";
import { extractTextOnly, extractImages, renderPdfPages } from "../lib/pdf-extractor";
import { dispatchExtraction, SUPPORTED_MIME_TYPES, isSupportedMimeType } from "../lib/doc-extractor";
import { getBackupBucket } from "../lib/gcsClient";
import { logger } from "../lib/logger";

const GCS_UPLOADS_PREFIX = "uploaded-files";

async function backupFileToGCS(localPath: string, filename: string): Promise<void> {
  const { readFile } = await import("fs/promises");
  const bucket = getBackupBucket();
  const data = await readFile(localPath);
  await bucket.file(`${GCS_UPLOADS_PREFIX}/${filename}`).save(data, {
    resumable: false,
    metadata: { cacheControl: "private, max-age=0" },
  });
  logger.info({ filename }, "File backed up to GCS");
}

async function deleteFileFromGCS(filename: string): Promise<void> {
  const bucket = getBackupBucket();
  await bucket.file(`${GCS_UPLOADS_PREFIX}/${filename}`).delete({ ignoreNotFound: true });
  logger.info({ filename }, "File deleted from GCS");
}

const UploadFormSchema = z.object({
  uploaderName: z.string().min(1, "Name is required"),
  uploaderEmail: z.string().email("Must be a valid work email"),
  contributorName: z.string().optional(),
  contentType: z.enum(["whitepaper", "case_study", "market_data", "regulation_update", "trend_insight"]),
  rawText: z.string().optional().default(""),
});

const ALLOWED_MIME_TYPES: string[] = [
  ...SUPPORTED_MIME_TYPES,
  "text/csv",
];

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_FILE_SIZE_MB = MAX_FILE_SIZE / (1024 * 1024);

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, uniqueSuffix + "-" + sanitized);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not supported. Allowed formats: PDF, DOCX, DOC, PPTX, MD, TXT, JPG, PNG, WEBP, GIF, TIFF, CSV`));
    }
  },
});

const router: IRouter = Router();

router.get("/uploads", requireSuperAuth, async (_req, res) => {
  const uploads = await db
    .select()
    .from(uploadsTable)
    .orderBy(desc(uploadsTable.createdAt));

  res.json(
    uploads.map((u) => ({
      id: u.id,
      uploaderName: u.uploaderName,
      uploaderEmail: u.uploaderEmail,
      contributorName: u.contributorName,
      contentType: u.contentType,
      targetSections: u.targetSections,
      rawText: u.rawText,
      filePath: u.filePath,
      status: u.status,
      processingErrors: (u.processingErrors as ProcessingError[] | null) ?? [],
      createdAt: u.createdAt.toISOString(),
      processedAt: u.processedAt?.toISOString() ?? null,
    })),
  );
});

router.get("/uploads/:id/status", requireAuth, async (req, res) => {
  const uploadId = parseInt(String(req.params.id), 10);
  if (isNaN(uploadId)) {
    res.status(400).json({ error: "Invalid upload ID" });
    return;
  }

  const [upload] = await db
    .select({
      id: uploadsTable.id,
      status: uploadsTable.status,
      processingErrors: uploadsTable.processingErrors,
    })
    .from(uploadsTable)
    .where(eq(uploadsTable.id, uploadId))
    .limit(1);

  if (!upload) {
    res.status(404).json({ error: "Upload not found" });
    return;
  }

  res.json({
    id: upload.id,
    status: upload.status,
    processingErrors: (upload.processingErrors as ProcessingError[] | null) ?? [],
  });
});

router.post("/uploads", requireAuth, (req, res, next) => {
  upload.array("files")(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({ error: `File too large. Maximum allowed size is ${MAX_FILE_SIZE_MB} MB.` });
        } else {
          res.status(400).json({ error: `Upload error: ${err.message}` });
        }
        return;
      }
      res.status(400).json({ error: err.message || "File upload failed" });
      return;
    }
    next();
  });
}, async (req, res) => {
  const parseResult = UploadFormSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Validation failed", details: parseResult.error.flatten().fieldErrors });
    return;
  }
  const data = parseResult.data;

  const uploadedFiles = (req.files as Express.Multer.File[] | undefined) ?? [];
  const filePath = uploadedFiles.length > 0 ? uploadedFiles.map((f) => f.filename).join(", ") : null;

  const syncErrors: ProcessingError[] = [];

  interface FileExtraction { label: string; text: string; imageUrls: string[] }
  const fileExtractions: FileExtraction[] = [];

  const pastedText = data.rawText.trim();
  if (pastedText) {
    fileExtractions.push({ label: data.contributorName ?? data.contentType.replace(/_/g, " "), text: pastedText, imageUrls: [] });
  }

  for (const file of uploadedFiles) {
    const mime = file.mimetype;
    const fname = file.originalname;
    let fileText = "";
    let fileImageUrls: string[] = [];

    if (mime === "application/pdf") {
      // CRITICAL: text extraction — no fallback
      try {
        logger.info({ filename: fname }, "Extracting text from PDF");
        const pdfText = await extractTextOnly(file.path);
        if (!pdfText.trim()) {
          throw new Error("Extraction returned empty text — file may be scanned or image-only");
        }
        logger.info({ filename: fname, chars: pdfText.length }, "PDF text extraction complete");
        fileText = pdfText;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err, filename: fname }, "PDF text extraction failed");
        syncErrors.push({ step: "text_extraction", message: `${fname}: ${message}`, ts: new Date().toISOString() });
        continue;
      }

      // NON-CRITICAL: visual analysis — record error but continue
      try {
        logger.info({ filename: fname }, "Rendering PDF pages for visual analysis");
        const pageImages = await renderPdfPages(file.path, 4);
        if (pageImages.length > 0) {
          const visualDesc = await describeDocumentVisuals(pageImages, fname);
          if (visualDesc) {
            fileText = `${fileText}\n\n---\n\n## Visual Content (charts, tables, diagrams)\n\n${visualDesc}`;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err, filename: fname }, "PDF visual analysis failed — continuing without visuals");
        syncErrors.push({ step: "visual_analysis", message: `${fname}: ${message}`, ts: new Date().toISOString() });
      }

      // NON-CRITICAL: image extraction — known to fail in Cloud Run, silent skip
      try {
        fileImageUrls = await extractImages(file.path);
      } catch (err) {
        logger.warn({ err, filename: fname }, "PDF image extraction failed — continuing without images");
      }

    } else if (isSupportedMimeType(mime)) {
      // CRITICAL: non-PDF extraction — no fallback
      try {
        logger.info({ filename: fname, mime }, "Dispatching file extraction");
        const extracted = await dispatchExtraction(file.path, mime, fname);
        if (!extracted.text.trim()) {
          throw new Error("Extraction returned empty text");
        }
        fileText = extracted.text;
        fileImageUrls = extracted.imageUrls;
        logger.info({ filename: fname, chars: extracted.text.length, images: extracted.imageUrls.length }, "File extraction complete");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err, filename: fname, mime }, "File extraction failed");
        syncErrors.push({ step: "text_extraction", message: `${fname}: ${message}`, ts: new Date().toISOString() });
        continue;
      }
    }

    if (fileText) {
      fileExtractions.push({ label: fname, text: fileText, imageUrls: fileImageUrls });
    }
  }

  const effectiveText = fileExtractions.map((e) => e.text).join("\n\n---\n\n");

  // If every uploaded file failed extraction AND no pasted text, return 422
  if (!effectiveText.trim() && uploadedFiles.length > 0 && !pastedText) {
    const isEmptyFile = syncErrors.some((e) =>
      e.message.includes("scanned") || e.message.includes("empty text") || e.message.includes("image-only"),
    );
    const errorCode = isEmptyFile ? "EXTRACTION_EMPTY" : "TEXT_EXTRACTION_FAILED";

    const [failedUpload] = await db
      .insert(uploadsTable)
      .values({
        uploaderName: data.uploaderName,
        uploaderEmail: data.uploaderEmail,
        contributorName: data.contributorName ?? null,
        contentType: data.contentType,
        targetSections: [],
        rawText: "",
        filePath,
        status: "failed",
        processingErrors: syncErrors,
      })
      .returning();

    logger.error({ uploadId: failedUpload.id, syncErrors }, "All file extractions failed — upload marked as failed");

    res.status(422).json({
      errorCode,
      message: isEmptyFile
        ? "The file appears to be scanned or image-only and couldn't be read automatically."
        : "The file could not be read — it may be corrupt or in an unsupported format.",
      uploadId: failedUpload.id,
    });
    return;
  }

  // NON-CRITICAL: back up uploaded files to GCS
  if (uploadedFiles.length > 0) {
    await Promise.allSettled(
      uploadedFiles.map((f) =>
        backupFileToGCS(f.path, f.filename).catch((err: unknown) => {
          logger.warn({ err, filename: f.filename }, "GCS file backup failed — file will only exist on local disk");
        }),
      ),
    );
  }

  const [uploadRecord] = await db
    .insert(uploadsTable)
    .values({
      uploaderName: data.uploaderName,
      uploaderEmail: data.uploaderEmail,
      contributorName: data.contributorName ?? null,
      contentType: data.contentType,
      targetSections: [],
      rawText: effectiveText,
      filePath,
      status: "pending",
      processingErrors: syncErrors.length > 0 ? syncErrors : null,
    })
    .returning();

  res.status(201).json({
    id: uploadRecord.id,
    uploaderName: uploadRecord.uploaderName,
    contributorName: uploadRecord.contributorName,
    contentType: uploadRecord.contentType,
    targetSections: uploadRecord.targetSections,
    rawText: uploadRecord.rawText,
    filePath: uploadRecord.filePath,
    status: uploadRecord.status,
    createdAt: uploadRecord.createdAt.toISOString(),
    processedAt: uploadRecord.processedAt?.toISOString() ?? null,
  });

  // Non-blocking wiki extraction — one call per file so each prompt stays small
  if (fileExtractions.length > 0) {
    const uploadId = uploadRecord.id;
    const sourceRef = `Upload #${uploadId} — ${data.contentType.replace(/_/g, " ")}`;
    const capturedExtractions = fileExtractions.slice();
    const capturedSyncErrors = syncErrors.slice();

    setImmediate(() => {
      void (async () => {
        const asyncErrors: ProcessingError[] = [];
        let totalCreated = 0;
        let totalUpdated = 0;

        for (const extraction of capturedExtractions) {
          try {
            const { created, updated } = await extractWikiPages(
              extraction.label,
              extraction.text,
              sourceRef,
              extraction.imageUrls,
            );
            totalCreated += created;
            totalUpdated += updated;
            if (created === 0 && updated === 0) {
              asyncErrors.push({
                step: "wiki_extraction",
                message: `${extraction.label}: AI returned 0 pages from non-empty text`,
                ts: new Date().toISOString(),
              });
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error({ err, uploadId, file: extraction.label }, "Wiki extraction failed for file");
            asyncErrors.push({
              step: "wiki_extraction",
              message: `${extraction.label}: ${message}`,
              ts: new Date().toISOString(),
            });
          }
        }

        const allErrors = [...capturedSyncErrors, ...asyncErrors];
        const noWikiContent = totalCreated === 0 && totalUpdated === 0 && asyncErrors.length > 0;
        const finalStatus = noWikiContent ? "partial" : "processed";

        await db
          .update(uploadsTable)
          .set({
            status: finalStatus,
            processedAt: new Date(),
            processingErrors: allErrors.length > 0 ? allErrors : null,
          })
          .where(eq(uploadsTable.id, uploadId));

        logger.info(
          { uploadId, totalCreated, totalUpdated, wikiErrors: asyncErrors.length, finalStatus },
          "Upload processing complete",
        );
      })();
    });
  } else {
    // Only pasted text — mark processed immediately after knowledge indexing
    void db
      .update(uploadsTable)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(uploadsTable.id, uploadRecord.id))
      .catch((err) => logger.error({ err, uploadId: uploadRecord.id }, "Failed to mark pasted-text upload as processed"));
  }

  // Non-blocking knowledge indexing of the raw upload text
  const capturedUploadId = uploadRecord.id;
  setImmediate(() => {
    void (async () => {
      try {
        const uploadTitle = `${data.contributorName ? `${data.contributorName} — ` : ""}${data.contentType.replace(/_/g, " ")}`;
        await indexSource({
          sourceType: "upload",
          sourceId: capturedUploadId,
          sourceSlug: null,
          title: uploadTitle,
          text: effectiveText,
        });
      } catch (err) {
        logger.error({ err, uploadId: capturedUploadId }, "Non-blocking knowledge indexing failed");
      }
    })();
  });
});

router.get("/uploads/:id/impact", requireSuperAuth, async (req, res) => {
  const uploadId = parseInt(String(req.params.id), 10);
  if (isNaN(uploadId)) {
    res.status(400).json({ error: "Invalid upload ID" });
    return;
  }

  res.json({
    sectionsReverted: 0,
    versionsDeleted: 0,
    sectionsRevertedList: [],
  });
});

router.delete("/uploads/:id", requireSuperAuth, async (req, res) => {
  const uploadId = parseInt(String(req.params.id), 10);
  if (isNaN(uploadId)) {
    res.status(400).json({ error: "Invalid upload ID" });
    return;
  }

  const [upload] = await db
    .select()
    .from(uploadsTable)
    .where(eq(uploadsTable.id, uploadId))
    .limit(1);

  if (!upload) {
    res.status(404).json({ error: "Upload not found" });
    return;
  }

  const allWikiPages = await db.select().from(wikiPagesTable);
  const deletedWikiPageIds: number[] = [];
  const updatedWikiSlugs: string[] = [];
  for (const page of allWikiPages) {
    const sources = (page.sources as Array<{ label: string; ref: string }>) ?? [];
    const filtered = sources.filter((s) => {
      const match = s.ref.match(/^Upload #(\d+)/);
      if (!match) return true;
      return Number(match[1]) !== uploadId;
    });
    if (filtered.length !== sources.length) {
      if (filtered.length === 0) {
        await db.delete(wikiPagesTable).where(eq(wikiPagesTable.id, page.id));
        deletedWikiPageIds.push(page.id);
      } else {
        await db.update(wikiPagesTable).set({ sources: filtered }).where(eq(wikiPagesTable.id, page.id));
        updatedWikiSlugs.push(page.slug);
      }
    }
  }

  await db.delete(uploadsTable).where(eq(uploadsTable.id, uploadId));

  // Non-blocking: delete GCS backup(s) for this upload.
  if (upload.filePath) {
    const filenames = upload.filePath.split(", ").map((f) => f.trim()).filter(Boolean);
    setImmediate(() => {
      for (const filename of filenames) {
        deleteFileFromGCS(filename).catch((err: unknown) => {
          logger.warn({ err, filename }, "GCS file delete failed — object may remain in storage");
        });
      }
    });
  }

  // Non-blocking: reconcile the knowledge index with the deletion.
  setImmediate(() => {
    void (async () => {
      try {
        await removeSource("upload", uploadId);
        for (const id of deletedWikiPageIds) {
          await removeSource("wiki", id);
        }
        for (const slug of updatedWikiSlugs) {
          await indexWikiPage(slug);
        }
      } catch (err) {
        logger.error({ err, uploadId }, "Knowledge index reconciliation after upload delete failed");
      }
    })();
  });

  logger.info({ uploadId }, "Upload deleted");

  res.json({
    deleted: true,
    sectionsReverted: 0,
    versionsDeleted: 0,
  });
});

export default router;
