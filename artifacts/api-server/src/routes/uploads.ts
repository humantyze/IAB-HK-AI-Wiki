import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, uploadsTable, sectionsTable, sectionVersionsTable } from "@workspace/db";
import { CreateUploadBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { processUpload } from "../lib/ai-service";
import { logger } from "../lib/logger";

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

router.post("/uploads", requireAuth, async (req, res) => {
  const data = CreateUploadBody.parse(req.body);

  const [upload] = await db
    .insert(uploadsTable)
    .values({
      contributorName: data.contributorName ?? null,
      contentType: data.contentType,
      targetSections: data.targetSections,
      rawText: data.rawText,
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
            createdByUploadId: upload.id,
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
      .where(eq(uploadsTable.id, upload.id))
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
    logger.error({ err, uploadId: upload.id }, "Failed to process upload");
    await db
      .update(uploadsTable)
      .set({ status: "error" })
      .where(eq(uploadsTable.id, upload.id));

    const [errUpload] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, upload.id))
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
