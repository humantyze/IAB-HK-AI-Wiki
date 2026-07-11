import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { db, uploadsTable, wikiPagesTable } from "@workspace/db";
import type { ProcessingError } from "@workspace/db";
import { requireAuth, requireSuperAuth } from "../middlewares/auth";
import { extractWikiPages, describeDocumentVisuals, removeRefFromPage } from "../lib/ai-service";
import { indexSource, removeSource, indexWikiPage } from "../lib/knowledge-index";
import { extractTextOnly, extractImages, renderPdfPagesBatched } from "../lib/pdf-extractor";
import { dispatchExtraction, SUPPORTED_MIME_TYPES, isSupportedMimeType } from "../lib/doc-extractor";
import { getBackupBucket } from "../lib/gcsClient";
import { logger } from "../lib/logger";
import { generateAndStoreQuestions } from "../lib/question-generator";

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
      const msg = err instanceof Error ? err.message : "File upload failed";
      if (msg.toLowerCase().includes("file type not supported") || msg.toLowerCase().includes("type not supported")) {
        res.status(400).json({ errorCode: "UNSUPPORTED_FILE_TYPE", message: msg, error: msg });
      } else {
        res.status(400).json({ error: msg });
      }
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

      // NON-CRITICAL: visual analysis — process in batches of 2 pages to avoid
      // accumulating WASM pixmaps in memory; each batch is described then freed
      try {
        logger.info({ filename: fname }, "Rendering PDF pages for visual analysis (batched)");
        const batchDescriptions: string[] = [];
        await renderPdfPagesBatched(file.path, 6, 2, async (batchBuffers, startPage) => {
          logger.info({ filename: fname, startPage, pages: batchBuffers.length }, "Describing PDF batch");
          const desc = await describeDocumentVisuals(batchBuffers, fname);
          if (desc) batchDescriptions.push(desc);
        });
        if (batchDescriptions.length > 0) {
          fileText = `${fileText}\n\n---\n\n## Visual Content (charts, tables, diagrams)\n\n${batchDescriptions.join("\n\n")}`;
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

        // Decide the final status from extraction outcomes BEFORE indexing, so
        // we never index content that belongs to a pending/failed upload.
        // failed = wiki extraction produced zero content from non-empty text
        // partial = non-critical failures (visual analysis, some files) alongside successful extraction
        const wikiTotallyFailed = totalCreated === 0 && totalUpdated === 0 && asyncErrors.some((e) => e.step === "wiki_extraction");
        const hasNonCriticalErrors = capturedSyncErrors.length > 0 || asyncErrors.some((e) => e.step === "visual_analysis");
        let finalStatus: string;
        if (wikiTotallyFailed) {
          finalStatus = "failed";
        } else if (hasNonCriticalErrors || asyncErrors.some((e) => e.step === "wiki_extraction")) {
          finalStatus = "partial";
        } else {
          finalStatus = "processed";
        }

        // Persist the eligible status first so the upload is in its final,
        // searchable state before any chunks exist for it.
        await db
          .update(uploadsTable)
          .set({
            status: finalStatus,
            processedAt: new Date(),
            processingErrors: [...capturedSyncErrors, ...asyncErrors].length > 0 ? [...capturedSyncErrors, ...asyncErrors] : null,
          })
          .where(eq(uploadsTable.id, uploadId));

        if (finalStatus === "failed") {
          // Defense-in-depth: a failed upload must never be searchable. Remove
          // any chunks that might linger (e.g. from a prior reprocessing run).
          try {
            await removeSource("upload", uploadId);
          } catch (err) {
            logger.error({ err, uploadId }, "Failed to remove failed upload from knowledge index");
          }
        } else {
          // Eligible upload — now safe to index. A failure here is non-critical;
          // downgrade processed -> partial so the issue is visible.
          try {
            const uploadTitle = `${data.contributorName ? `${data.contributorName} — ` : ""}${data.contentType.replace(/_/g, " ")}`;
            await indexSource({
              sourceType: "upload",
              sourceId: uploadId,
              sourceSlug: null,
              title: uploadTitle,
              text: fileExtractions.map((e) => e.text).join("\n\n---\n\n"),
            });
            // Fire-and-forget: regenerate sample questions from updated content
            setImmediate(() => { void generateAndStoreQuestions(); });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error({ err, uploadId }, "Knowledge indexing failed");
            asyncErrors.push({ step: "knowledge_indexing", message, ts: new Date().toISOString() });
            finalStatus = finalStatus === "processed" ? "partial" : finalStatus;
            await db
              .update(uploadsTable)
              .set({
                status: finalStatus,
                processingErrors: [...capturedSyncErrors, ...asyncErrors],
              })
              .where(eq(uploadsTable.id, uploadId));
          }
        }

        logger.info(
          { uploadId, totalCreated, totalUpdated, asyncErrors: asyncErrors.length, syncErrors: capturedSyncErrors.length, finalStatus },
          "Upload processing complete",
        );
      })();
    });
  } else {
    // Only pasted text — run knowledge indexing then mark processed
    setImmediate(() => {
      void (async () => {
        // Move to an eligible status first so the upload is never indexed while
        // still "pending", then index. A failure downgrades it to "partial".
        await db.update(uploadsTable).set({ status: "processed", processedAt: new Date() }).where(eq(uploadsTable.id, uploadRecord.id));
        try {
          const uploadTitle = `${data.contributorName ? `${data.contributorName} — ` : ""}${data.contentType.replace(/_/g, " ")}`;
          await indexSource({
            sourceType: "upload",
            sourceId: uploadRecord.id,
            sourceSlug: null,
            title: uploadTitle,
            text: pastedText,
          });
          // Fire-and-forget: regenerate sample questions from updated content
          setImmediate(() => { void generateAndStoreQuestions(); });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ err, uploadId: uploadRecord.id }, "Knowledge indexing failed for pasted-text upload");
          await db.update(uploadsTable).set({
            status: "partial",
            processingErrors: [{ step: "knowledge_indexing", message, ts: new Date().toISOString() }],
          }).where(eq(uploadsTable.id, uploadRecord.id)).catch(() => {});
        }
      })();
    });
  }

});

router.get("/uploads/:id/impact", requireSuperAuth, async (req, res) => {
  const uploadId = parseInt(String(req.params.id), 10);
  if (isNaN(uploadId)) {
    res.status(400).json({ error: "Invalid upload ID" });
    return;
  }

  const allWikiPages = await db.select({ id: wikiPagesTable.id, slug: wikiPagesTable.slug, title: wikiPagesTable.title, sources: wikiPagesTable.sources }).from(wikiPagesTable);
  const affected: Array<{ slug: string; title: string; willBeDeleted: boolean }> = [];

  for (const page of allWikiPages) {
    const sources = (page.sources as Array<{ label: string; ref: string }>) ?? [];
    const hasThisUpload = sources.some((s) => {
      const match = s.ref.match(/^Upload #(\d+)/);
      return match && Number(match[1]) === uploadId;
    });
    if (!hasThisUpload) continue;
    const otherSources = sources.filter((s) => {
      const match = s.ref.match(/^Upload #(\d+)/);
      return !(match && Number(match[1]) === uploadId);
    });
    affected.push({ slug: page.slug, title: page.title, willBeDeleted: otherSources.length === 0 });
  }

  const toDelete = affected.filter((p) => p.willBeDeleted);
  const toUpdate = affected.filter((p) => !p.willBeDeleted);

  res.json({
    sectionsReverted: toDelete.length + toUpdate.length,
    versionsDeleted: toDelete.length,
    sectionsRevertedList: affected.map((p) => ({ slug: p.slug, title: p.title, action: p.willBeDeleted ? "deleted" : "source_removed" })),
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

  // Strip this upload from every wiki page it contributed to — both the
  // citation AND its body segment(s), so the deleted upload's prose actually
  // leaves the page (it previously stayed and remained searchable).
  const isThisUpload = (ref: string) => {
    const match = ref.match(/^Upload #(\d+)/);
    return match ? Number(match[1]) === uploadId : false;
  };
  const allWikiPages = await db.select().from(wikiPagesTable);
  const deletedWikiPageIds: number[] = [];
  const updatedWikiSlugs: string[] = [];
  for (const page of allWikiPages) {
    const sources = (page.sources as Array<{ label: string; ref: string }>) ?? [];
    if (!sources.some((s) => isThisUpload(s.ref))) continue;
    const reconciled = removeRefFromPage(page, isThisUpload);
    if (reconciled.isEmpty) {
      await db.delete(wikiPagesTable).where(eq(wikiPagesTable.id, page.id));
      deletedWikiPageIds.push(page.id);
    } else {
      await db
        .update(wikiPagesTable)
        .set({
          sources: reconciled.sources,
          bodySegments: reconciled.bodySegments,
          bodyMarkdown: reconciled.bodyMarkdown,
          updatedAt: new Date(),
        })
        .where(eq(wikiPagesTable.id, page.id));
      updatedWikiSlugs.push(page.slug);
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
