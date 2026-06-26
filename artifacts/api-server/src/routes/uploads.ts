import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { db, uploadsTable, wikiPagesTable } from "@workspace/db";
import { requireAuth, requireSuperAuth } from "../middlewares/auth";
import { extractWikiPages, describeDocumentVisuals } from "../lib/ai-service";
import { indexSource, removeSource, indexWikiPage } from "../lib/knowledge-index";
import { extractTextOnly, extractImages, renderPdfPages } from "../lib/pdf-extractor";
import { dispatchExtraction, SUPPORTED_MIME_TYPES, isSupportedMimeType } from "../lib/doc-extractor";
import { logger } from "../lib/logger";

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

const MAX_FILE_SIZE = 10 * 1024 * 1024;

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
      createdAt: u.createdAt.toISOString(),
      processedAt: u.processedAt?.toISOString() ?? null,
    })),
  );
});

router.post("/uploads", requireAuth, (req, res, next) => {
  upload.array("files")(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        res.status(400).json({ error: `Upload error: ${err.message}` });
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

  // Build effective text: pasted input + extracted text from each file (combined)
  let effectiveText = data.rawText.trim();
  let candidateImageUrls: string[] = [];

  for (const file of uploadedFiles) {
    const mime = file.mimetype;
    const fname = file.originalname;

    if (mime === "application/pdf") {
      // PDF: text extraction + GPT vision for visual content + pdfimages for thumbnails
      try {
        logger.info({ filename: fname }, "Extracting text from PDF");
        const pdfText = await extractTextOnly(file.path);
        logger.info({ filename: fname, chars: pdfText.length }, "PDF text extraction complete");
        effectiveText = effectiveText ? `${effectiveText}\n\n---\n\n${pdfText}` : pdfText;
      } catch (err) {
        logger.error({ err, filename: fname }, "PDF text extraction failed — using filename as fallback");
        if (!effectiveText) effectiveText = `Uploaded file: ${fname}`;
      }

      try {
        logger.info({ filename: fname }, "Rendering PDF pages for visual analysis");
        const pageImages = await renderPdfPages(file.path, 4);
        if (pageImages.length > 0) {
          const visualDesc = await describeDocumentVisuals(pageImages, fname);
          if (visualDesc) {
            effectiveText = `${effectiveText}\n\n---\n\n## Visual Content (charts, tables, diagrams)\n\n${visualDesc}`;
          }
        }
      } catch (err) {
        logger.warn({ err, filename: fname }, "PDF visual analysis failed — continuing without visuals");
      }

      try {
        const pdfImages = await extractImages(file.path);
        candidateImageUrls = candidateImageUrls.concat(pdfImages);
      } catch (err) {
        logger.warn({ err, filename: fname }, "PDF image extraction failed — continuing without images");
      }
    } else if (isSupportedMimeType(mime)) {
      // All other supported formats — unified extractor
      try {
        logger.info({ filename: fname, mime }, "Dispatching file extraction");
        const extracted = await dispatchExtraction(file.path, mime, fname);
        if (extracted.text) {
          effectiveText = effectiveText
            ? `${effectiveText}\n\n---\n\n${extracted.text}`
            : extracted.text;
        } else if (!effectiveText) {
          effectiveText = `Uploaded file: ${fname}`;
        }
        candidateImageUrls = candidateImageUrls.concat(extracted.imageUrls);
        logger.info({ filename: fname, chars: extracted.text.length, images: extracted.imageUrls.length }, "File extraction complete");
      } catch (err) {
        logger.error({ err, filename: fname, mime }, "File extraction failed — using fallback text");
        if (!effectiveText) effectiveText = `Uploaded file: ${fname}`;
      }
    }
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
    })
    .returning();

  try {
    const [updated] = await db
      .update(uploadsTable)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(uploadsTable.id, uploadRecord.id))
      .returning();

    res.status(201).json({
      id: updated.id,
      uploaderName: updated.uploaderName,
      contributorName: updated.contributorName,
      contentType: updated.contentType,
      targetSections: updated.targetSections,
      rawText: updated.rawText,
      filePath: updated.filePath,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      processedAt: updated.processedAt?.toISOString() ?? null,
    });

    // Non-blocking wiki extraction — fires after a successful upload
    {
      const sourceLabel = data.contributorName ?? data.contentType.replace(/_/g, " ");
      const sourceRef = `Upload #${updated.id} — ${data.contentType.replace(/_/g, " ")}`;
      setImmediate(() => {
        extractWikiPages(sourceLabel, effectiveText, sourceRef, candidateImageUrls).catch((err: unknown) => {
          logger.error({ err, uploadId: updated.id }, "Non-blocking wiki extraction failed");
        });
      });
    }

    // Non-blocking knowledge indexing of the raw upload
    setImmediate(() => {
      void (async () => {
        try {
          const uploadTitle = `${data.contributorName ? `${data.contributorName} — ` : ""}${data.contentType.replace(/_/g, " ")}`;
          await indexSource({
            sourceType: "upload",
            sourceId: updated.id,
            sourceSlug: null,
            title: uploadTitle,
            text: effectiveText,
          });
        } catch (err) {
          logger.error({ err, uploadId: updated.id }, "Non-blocking knowledge indexing failed");
        }
      })();
    });
  } catch (err) {
    logger.error({ err, uploadId: uploadRecord.id }, "Failed to process upload");
    await db
      .update(uploadsTable)
      .set({ status: "error" })
      .where(eq(uploadsTable.id, uploadRecord.id));

    const [errUpload] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, uploadRecord.id))
      .limit(1);

    res.status(500).json({
      id: errUpload.id,
      uploaderName: errUpload.uploaderName,
      contributorName: errUpload.contributorName,
      contentType: errUpload.contentType,
      targetSections: errUpload.targetSections,
      rawText: errUpload.rawText,
      filePath: errUpload.filePath,
      status: errUpload.status,
      createdAt: errUpload.createdAt.toISOString(),
      processedAt: errUpload.processedAt?.toISOString() ?? null,
    });
  }
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
