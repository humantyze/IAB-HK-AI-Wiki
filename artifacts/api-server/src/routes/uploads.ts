import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import multer from "multer";
import path from "path";
import { db, uploadsTable, sectionsTable, sectionVersionsTable } from "@workspace/db";
import { CreateUploadBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { processUpload } from "../lib/ai-service";
import { logger } from "../lib/logger";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: path.join(process.cwd(), "uploads"),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
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

router.post("/uploads", requireAuth, upload.single("file"), async (req, res) => {
  const data = CreateUploadBody.parse(
    typeof req.body.targetSections === "string"
      ? { ...req.body, targetSections: JSON.parse(req.body.targetSections) }
      : req.body,
  );

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
