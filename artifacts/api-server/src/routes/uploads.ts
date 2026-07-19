import { Router, type IRouter } from "express";
import { desc, eq, ne, and, not, or } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { createHash } from "crypto";
import { z } from "zod";
import { db, uploadsTable, wikiPagesTable } from "@workspace/db";
import type { ProcessingError } from "@workspace/db";
import { requireAuth, requireSuperAuth } from "../middlewares/auth";
import { extractWikiPages, describeDocumentVisuals, removeRefFromPage, moderateContent } from "../lib/ai-service";
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
  responsibleAi: z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean()).optional().default(false),
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
      moderationStatus: u.moderationStatus ?? "clear",
      moderationReason: u.moderationReason ?? null,
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
      moderationStatus: uploadsTable.moderationStatus,
      moderationReason: uploadsTable.moderationReason,
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
    moderationStatus: upload.moderationStatus ?? null,
    moderationReason: upload.moderationReason ?? null,
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

  // --- Duplicate detection via content hash ---
  const pastedText = data.rawText.trim();
  let contentHash: string | null = null;
  if (uploadedFiles.length > 0) {
    const fileHashes = uploadedFiles.map((f) => {
      const buf = fs.readFileSync(f.path);
      return createHash("sha256").update(buf).digest("hex");
    });
    fileHashes.sort();
    contentHash = fileHashes.join("|");
  } else if (pastedText) {
    contentHash = createHash("sha256").update(pastedText).digest("hex");
  }

  if (contentHash) {
    // Block re-upload unless the previous attempt failed at extraction
    // (status='failed' AND rawText='' means extraction never produced content).
    // Any upload that made it through extraction — even if later async processing
    // failed — keeps its rawText, so it remains duplicate-blocking.
    const [existing] = await db
      .select({ id: uploadsTable.id, filePath: uploadsTable.filePath, createdAt: uploadsTable.createdAt })
      .from(uploadsTable)
      .where(
        and(
          eq(uploadsTable.contentHash, contentHash),
          or(ne(uploadsTable.status, "failed"), ne(uploadsTable.rawText, "")),
        )
      )
      .limit(1);

    if (existing) {
      // Clean up temp files before rejecting
      for (const f of uploadedFiles) {
        fs.unlink(f.path, () => {});
      }
      logger.info({ existingUploadId: existing.id, contentHash }, "Duplicate upload rejected");
      res.status(409).json({
        errorCode: "DUPLICATE_UPLOAD",
        message: "This document has already been submitted.",
        existingUploadId: existing.id,
        existingFilePath: existing.filePath,
        existingCreatedAt: existing.createdAt.toISOString(),
      });
      return;
    }
  }

  const syncErrors: ProcessingError[] = [];

  interface FileExtraction { label: string; text: string; imageUrls: string[] }
  const fileExtractions: FileExtraction[] = [];
  // PDFs that need visual analysis deferred to background so the 201 isn't blocked
  interface PendingVisual { filePath: string; label: string; index: number }
  const pendingVisuals: PendingVisual[] = [];
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

      // Visual analysis and image extraction are deferred to the background task
      // so the 201 response is never held up by slow vision-API calls (30–90 s).

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
      const extractionIndex = fileExtractions.length;
      fileExtractions.push({ label: fname, text: fileText, imageUrls: fileImageUrls });
      if (mime === "application/pdf") {
        pendingVisuals.push({ filePath: file.path, label: fname, index: extractionIndex });
      }
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
        contentHash,
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
      contentHash,
      status: "pending",
      processingErrors: syncErrors.length > 0 ? syncErrors : null,
      responsibleAi: data.responsibleAi ?? false,
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
    const capturedResponsibleAi = data.responsibleAi ?? false;
    const capturedPendingVisuals = pendingVisuals.slice();

    setImmediate(() => {
      void (async () => {
        const asyncErrors: ProcessingError[] = [];
        let totalCreated = 0;
        let totalUpdated = 0;

        // ── PDF visual analysis (deferred from sync path) ────────────────────
        for (const pending of capturedPendingVisuals) {
          try {
            logger.info({ filename: pending.label }, "Rendering PDF pages for visual analysis (batched, background)");
            const batchDescriptions: string[] = [];
            await renderPdfPagesBatched(pending.filePath, 6, 2, async (batchBuffers, startPage) => {
              logger.info({ filename: pending.label, startPage, pages: batchBuffers.length }, "Describing PDF batch");
              const desc = await describeDocumentVisuals(batchBuffers, pending.label);
              if (desc) batchDescriptions.push(desc);
            });
            if (batchDescriptions.length > 0) {
              capturedExtractions[pending.index].text += `\n\n---\n\n## Visual Content (charts, tables, diagrams)\n\n${batchDescriptions.join("\n\n")}`;
            }
            logger.info({ filename: pending.label }, "PDF visual analysis complete");
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn({ err, filename: pending.label }, "PDF visual analysis failed — continuing without visuals");
            asyncErrors.push({ step: "visual_analysis", message: `${pending.label}: ${message}`, ts: new Date().toISOString() });
          }
          // Image extraction (non-critical, deferred alongside visuals)
          try {
            capturedExtractions[pending.index].imageUrls = await extractImages(pending.filePath);
          } catch { /* silent — image extraction is best-effort */ }
        }
        // Update rawText in DB to persist visual descriptions for future reprocessing
        if (capturedPendingVisuals.length > 0) {
          const enrichedText = capturedExtractions.map((e) => e.text).join("\n\n---\n\n");
          await db.update(uploadsTable).set({ rawText: enrichedText }).where(eq(uploadsTable.id, uploadId)).catch(() => {});
        }
        // ────────────────────────────────────────────────────────────────────

        // ── Content moderation ───────────────────────────────────────────────
        let moderationStatus = "clear";
        let moderationReason: string | null = null;
        try {
          logger.info({ uploadId }, "Running content moderation");
          const modResult = await moderateContent(capturedExtractions.map((e) => e.text).join("\n\n"));
          moderationStatus = modResult.verdict;
          moderationReason = modResult.reason || null;
          logger.info({ uploadId, verdict: modResult.verdict }, "Content moderation complete");
        } catch (err) {
          logger.warn({ err, uploadId }, "Content moderation threw unexpectedly — defaulting to 'clear'");
        }

        if (moderationStatus === "rejected") {
          const modError: ProcessingError = {
            step: "content_moderation",
            message: moderationReason ?? "Content rejected by moderation",
            ts: new Date().toISOString(),
          };
          await db
            .update(uploadsTable)
            .set({
              status: "failed",
              processedAt: new Date(),
              processingErrors: [...capturedSyncErrors, modError],
              moderationStatus: "rejected",
              moderationReason,
            })
            .where(eq(uploadsTable.id, uploadId));
          logger.info({ uploadId }, "Upload rejected by content moderation — pipeline stopped");
          return;
        }
        // ────────────────────────────────────────────────────────────────────

        for (const extraction of capturedExtractions) {
          try {
            const { created, updated } = await extractWikiPages(
              extraction.label,
              extraction.text,
              sourceRef,
              extraction.imageUrls,
              capturedResponsibleAi,
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
            moderationStatus,
            moderationReason,
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
                moderationStatus,
                moderationReason,
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
    // Only pasted text — run moderation then knowledge indexing then mark processed
    const capturedPastedText = pastedText;
    const capturedUploadId = uploadRecord.id;
    setImmediate(() => {
      void (async () => {
        // ── Content moderation ─────────────────────────────────────────────────
        let moderationStatus = "clear";
        let moderationReason: string | null = null;
        try {
          logger.info({ uploadId: capturedUploadId }, "Running content moderation (pasted text)");
          const modResult = await moderateContent(capturedPastedText);
          moderationStatus = modResult.verdict;
          moderationReason = modResult.reason || null;
          logger.info({ uploadId: capturedUploadId, verdict: modResult.verdict }, "Content moderation complete");
        } catch (err) {
          logger.warn({ err, uploadId: capturedUploadId }, "Content moderation threw unexpectedly — defaulting to 'clear'");
        }

        if (moderationStatus === "rejected") {
          await db.update(uploadsTable).set({
            status: "failed",
            processedAt: new Date(),
            processingErrors: [{
              step: "content_moderation",
              message: moderationReason ?? "Content rejected by moderation",
              ts: new Date().toISOString(),
            }],
            moderationStatus: "rejected",
            moderationReason,
          }).where(eq(uploadsTable.id, capturedUploadId)).catch(() => {});
          logger.info({ uploadId: capturedUploadId }, "Pasted-text upload rejected by content moderation — pipeline stopped");
          return;
        }
        // ──────────────────────────────────────────────────────────────────────

        // Move to an eligible status first so the upload is never indexed while
        // still "pending", then index. A failure downgrades it to "partial".
        await db.update(uploadsTable).set({ status: "processed", processedAt: new Date(), moderationStatus, moderationReason }).where(eq(uploadsTable.id, capturedUploadId));
        try {
          const uploadTitle = `${data.contributorName ? `${data.contributorName} — ` : ""}${data.contentType.replace(/_/g, " ")}`;
          await indexSource({
            sourceType: "upload",
            sourceId: capturedUploadId,
            sourceSlug: null,
            title: uploadTitle,
            text: capturedPastedText,
          });
          // Fire-and-forget: regenerate sample questions from updated content
          setImmediate(() => { void generateAndStoreQuestions(); });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ err, uploadId: capturedUploadId }, "Knowledge indexing failed for pasted-text upload");
          await db.update(uploadsTable).set({
            status: "partial",
            processingErrors: [{ step: "knowledge_indexing", message, ts: new Date().toISOString() }],
          }).where(eq(uploadsTable.id, capturedUploadId)).catch(() => {});
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

router.patch("/uploads/:id/moderation", requireSuperAuth, async (req, res) => {
  const uploadId = parseInt(String(req.params.id), 10);
  if (isNaN(uploadId)) {
    res.status(400).json({ error: "Invalid upload ID" });
    return;
  }

  const body = req.body as { moderationStatus?: string };
  const allowed = ["clear", "flagged", "rejected"];
  if (!body.moderationStatus || !allowed.includes(body.moderationStatus)) {
    res.status(400).json({ error: "moderationStatus must be one of: clear, flagged, rejected" });
    return;
  }

  const [updated] = await db
    .update(uploadsTable)
    .set({ moderationStatus: body.moderationStatus })
    .where(eq(uploadsTable.id, uploadId))
    .returning({ id: uploadsTable.id, moderationStatus: uploadsTable.moderationStatus });

  if (!updated) {
    res.status(404).json({ error: "Upload not found" });
    return;
  }

  logger.info({ uploadId, moderationStatus: body.moderationStatus }, "Upload moderation status updated");
  res.json({ id: updated.id, moderationStatus: updated.moderationStatus });
});

router.delete("/uploads/:id/wiki-pages", requireSuperAuth, async (req, res) => {
  const uploadId = parseInt(String(req.params.id), 10);
  if (isNaN(uploadId)) {
    res.status(400).json({ error: "Invalid upload ID" });
    return;
  }

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

  setImmediate(() => {
    void (async () => {
      try {
        for (const id of deletedWikiPageIds) {
          await removeSource("wiki", id);
        }
        for (const slug of updatedWikiSlugs) {
          await indexWikiPage(slug);
        }
      } catch (err) {
        logger.error({ err, uploadId }, "Knowledge index reconciliation after wiki-pages delete failed");
      }
    })();
  });

  logger.info({ uploadId, deletedWikiPageIds, updatedWikiSlugs }, "Wiki pages removed for upload (upload record kept)");
  res.json({ wikiPagesDeleted: deletedWikiPageIds.length, wikiPagesUpdated: updatedWikiSlugs.length });
});

export default router;
