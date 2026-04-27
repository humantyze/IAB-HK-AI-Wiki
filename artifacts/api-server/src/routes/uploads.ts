import { Router, type IRouter } from "express";
import { eq, desc, inArray } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { db, uploadsTable, sectionsTable, sectionVersionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { processUpload, analyzeSections, extractWikiPages } from "../lib/ai-service";
import { logger } from "../lib/logger";

const UploadFormSchema = z.object({
  contributorName: z.string().optional(),
  contentType: z.enum(["whitepaper", "case_study", "market_data", "regulation_update", "trend_insight"]),
  targetSections: z.array(z.string()).min(1, "At least one target section is required"),
  rawText: z.string().optional().default(""),
});

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
      cb(new Error(`File type ${file.mimetype} not allowed. Allowed: PDF, TXT, CSV, DOCX, XLSX`));
    }
  },
});

const router: IRouter = Router();

router.get("/uploads", requireAuth, async (_req, res) => {
  const uploads = await db
    .select()
    .from(uploadsTable)
    .orderBy(desc(uploadsTable.createdAt));

  res.json(
    uploads.map((u) => ({
      id: u.id,
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

router.post("/uploads/analyze", requireAuth, (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err instanceof multer.MulterError ? `Upload error: ${err.message}` : (err.message || "File upload failed") });
      return;
    }
    next();
  });
}, async (req, res) => {
  const rawText: string = req.body.rawText ?? "";
  const contentType: string = req.body.contentType ?? "market_data";

  if (!rawText.trim() && !req.file) {
    res.status(400).json({ error: "Provide either raw text content or a file to analyse." });
    return;
  }

  const allSections = await db
    .select({ slug: sectionsTable.slug, title: sectionsTable.title })
    .from(sectionsTable);

  const textToAnalyse = rawText.trim() || `Uploaded file: ${req.file?.originalname ?? "unknown"}`;

  try {
    const result = await analyzeSections(textToAnalyse, contentType, allSections);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Section analysis failed");
    res.status(500).json({ error: "Analysis failed. Please try again." });
  }
});

router.post("/uploads", requireAuth, (req, res, next) => {
  upload.single("file")(req, res, (err) => {
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
  let targetSections: string[];
  try {
    targetSections = typeof req.body.targetSections === "string"
      ? JSON.parse(req.body.targetSections)
      : req.body.targetSections;
  } catch {
    res.status(400).json({ error: "Invalid targetSections: must be a valid JSON array" });
    return;
  }

  const parseResult = UploadFormSchema.safeParse({
    ...req.body,
    targetSections,
  });
  if (!parseResult.success) {
    res.status(400).json({ error: "Validation failed", details: parseResult.error.flatten().fieldErrors });
    return;
  }
  const data = parseResult.data;

  if (data.targetSections.length > 0) {
    const existingSections = await db
      .select({ slug: sectionsTable.slug })
      .from(sectionsTable)
      .where(inArray(sectionsTable.slug, data.targetSections));
    const existingSlugs = new Set(existingSections.map((s) => s.slug));
    const invalid = data.targetSections.filter((s) => !existingSlugs.has(s));
    if (invalid.length > 0) {
      res.status(400).json({ error: `Unknown target sections: ${invalid.join(", ")}` });
      return;
    }
  }

  const filePath = req.file ? req.file.filename : null;

  const [uploadRecord] = await db
    .insert(uploadsTable)
    .values({
      contributorName: data.contributorName ?? null,
      contentType: data.contentType,
      targetSections: data.targetSections,
      rawText: data.rawText,
      filePath,
      status: "pending",
    })
    .returning();

  try {
    const results = await processUpload(
      data.rawText,
      data.targetSections,
      data.contentType,
    );

    for (const result of results) {
      const [section] = await db
        .select()
        .from(sectionsTable)
        .where(eq(sectionsTable.slug, result.sectionSlug))
        .limit(1);

      if (section) {
        const [newVersion] = await db
          .insert(sectionVersionsTable)
          .values({
            sectionId: section.id,
            bodyMarkdown: result.bodyMarkdown,
            keyInsights: result.keyInsights,
            chartData: result.chartData,
            imageUrl: result.imageUrl ?? null,
            createdByUploadId: uploadRecord.id,
          })
          .returning();

        await db
          .update(sectionsTable)
          .set({ currentVersionId: newVersion.id })
          .where(eq(sectionsTable.id, section.id));
      }
    }

    const [updated] = await db
      .update(uploadsTable)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(uploadsTable.id, uploadRecord.id))
      .returning();

    res.status(201).json({
      id: updated.id,
      contributorName: updated.contributorName,
      contentType: updated.contentType,
      targetSections: updated.targetSections,
      rawText: updated.rawText,
      filePath: updated.filePath,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      processedAt: updated.processedAt?.toISOString() ?? null,
    });

    // Non-blocking wiki extraction — runs after response is sent
    if (data.rawText.trim()) {
      const sourceLabel = data.contributorName ?? data.contentType.replace(/_/g, " ");
      const sourceRef = `Upload #${updated.id} — ${data.contentType.replace(/_/g, " ")}`;
      setImmediate(() => {
        extractWikiPages(sourceLabel, data.rawText, sourceRef).catch((err: unknown) => {
          logger.error({ err, uploadId: updated.id }, "Non-blocking wiki extraction failed");
        });
      });
    }
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

export default router;
