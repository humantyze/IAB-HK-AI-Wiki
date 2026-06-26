import { Router, type IRouter } from "express";
import { eq, gt, asc } from "drizzle-orm";
import { db, uploadsTable, wikiPagesTable, knowledgeChunksTable } from "@workspace/db";
import type { ProcessingError } from "@workspace/db";
import { requireSuperAuth } from "../middlewares/auth";
import { extractWikiPages } from "../lib/ai-service";
import { indexSource } from "../lib/knowledge-index";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/admin/regress/preview", requireSuperAuth, async (req, res) => {
  const { targetDate } = req.query;
  if (!targetDate || typeof targetDate !== "string") {
    res.status(400).json({ error: "targetDate query param required (ISO 8601)" });
    return;
  }

  const date = new Date(targetDate);
  if (isNaN(date.getTime())) {
    res.status(400).json({ error: "Invalid targetDate" });
    return;
  }

  const wikiPagesRemoved = await db
    .select({ id: wikiPagesTable.id })
    .from(wikiPagesTable)
    .where(gt(wikiPagesTable.createdAt, date));

  const uploadsRemoved = await db
    .select({ id: uploadsTable.id })
    .from(uploadsTable)
    .where(gt(uploadsTable.createdAt, date));

  res.json({
    sectionsAffected: 0,
    versionsRemoved: 0,
    wikiPagesRemoved: wikiPagesRemoved.length,
    uploadsRemoved: uploadsRemoved.length,
  });
});

router.post("/admin/regress", requireSuperAuth, async (req, res) => {
  const { targetDate } = req.body as { targetDate?: string };
  if (!targetDate) {
    res.status(400).json({ error: "targetDate is required (ISO 8601)" });
    return;
  }

  const date = new Date(targetDate);
  if (isNaN(date.getTime())) {
    res.status(400).json({ error: "Invalid targetDate" });
    return;
  }

  try {
    const deletedWiki = await db
      .delete(wikiPagesTable)
      .where(gt(wikiPagesTable.createdAt, date))
      .returning({ id: wikiPagesTable.id });

    const deletedUploads = await db
      .delete(uploadsTable)
      .where(gt(uploadsTable.createdAt, date))
      .returning({ id: uploadsTable.id });

    // Clean upload source references from remaining wiki pages
    const deletedUploadIds = new Set(deletedUploads.map((u) => u.id));
    if (deletedUploadIds.size > 0) {
      const remainingWiki = await db.select().from(wikiPagesTable);
      for (const page of remainingWiki) {
        const sources = (page.sources as Array<{ label: string; ref: string }>) ?? [];
        const filteredSources = sources.filter((s) => {
          const match = s.ref.match(/^Upload #(\d+)/);
          if (!match) return true;
          return !deletedUploadIds.has(Number(match[1]));
        });
        if (filteredSources.length !== sources.length) {
          if (filteredSources.length === 0) {
            await db.delete(wikiPagesTable).where(eq(wikiPagesTable.id, page.id));
          } else {
            await db.update(wikiPagesTable).set({ sources: filteredSources }).where(eq(wikiPagesTable.id, page.id));
          }
        }
      }
    }

    logger.info(
      { targetDate, deletedWiki: deletedWiki.length, deletedUploads: deletedUploads.length },
      "Wiki regressed to date",
    );

    res.json({
      sectionsReverted: 0,
      versionsDeleted: 0,
      wikiPagesDeleted: deletedWiki.length,
      uploadsDeleted: deletedUploads.length,
    });
  } catch (err) {
    logger.error({ err }, "Regression failed");
    res.status(500).json({ error: "Regression failed. Please try again." });
  }
});

/**
 * Re-runs wiki extraction and knowledge indexing for every upload that has
 * stored raw text. Updates each upload's status and processingErrors in the DB
 * as it goes — admins can refresh the uploads list to see results.
 */
router.post("/admin/reprocess-uploads", requireSuperAuth, async (_req, res) => {
  const uploads = await db.select().from(uploadsTable).orderBy(asc(uploadsTable.id));
  const eligible = uploads.filter((u) => u.rawText && u.rawText.trim().length >= 50);

  res.json({ message: `Reprocessing ${eligible.length} uploads in background`, count: eligible.length });

  setImmediate(async () => {
    let succeeded = 0;
    let failed = 0;

    for (const upload of eligible) {
      const errors: ProcessingError[] = [];
      try {
        const sourceLabel = upload.contributorName ?? upload.contentType.replace(/_/g, " ");
        const sourceRef = `Upload #${upload.id} — ${upload.contentType.replace(/_/g, " ")}`;
        const uploadTitle = `${upload.contributorName ? `${upload.contributorName} — ` : ""}${upload.contentType.replace(/_/g, " ")}`;

        const { created, updated } = await extractWikiPages(sourceLabel, upload.rawText, sourceRef, []);

        if (created === 0 && updated === 0) {
          errors.push({
            step: "wiki_extraction",
            message: "AI returned 0 pages from non-empty text during reprocess",
            ts: new Date().toISOString(),
          });
          await db
            .update(uploadsTable)
            .set({ status: "partial", processedAt: new Date(), processingErrors: errors })
            .where(eq(uploadsTable.id, upload.id));
          failed++;
        } else {
          await db
            .update(uploadsTable)
            .set({ status: "processed", processedAt: new Date(), processingErrors: null })
            .where(eq(uploadsTable.id, upload.id));
        }

        await indexSource({
          sourceType: "upload",
          sourceId: upload.id,
          sourceSlug: null,
          title: uploadTitle,
          text: upload.rawText,
        });

        succeeded++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err, uploadId: upload.id }, "Reprocess failed for upload");
        errors.push({ step: "wiki_extraction", message, ts: new Date().toISOString() });
        await db
          .update(uploadsTable)
          .set({ status: "partial", processedAt: new Date(), processingErrors: errors })
          .where(eq(uploadsTable.id, upload.id))
          .catch((dbErr) => logger.error({ dbErr, uploadId: upload.id }, "Failed to write reprocess errors to DB"));
        failed++;
      }
    }
    logger.info({ succeeded, failed, total: eligible.length }, "Upload reprocess complete");
  });
});

router.post("/admin/wipe", requireSuperAuth, async (_req, res) => {
  try {
    const deletedChunks = await db.delete(knowledgeChunksTable).returning({ id: knowledgeChunksTable.id });
    const deletedWiki = await db.delete(wikiPagesTable).returning({ id: wikiPagesTable.id });
    const deletedUploads = await db.delete(uploadsTable).returning({ id: uploadsTable.id });

    logger.info(
      { deletedWiki: deletedWiki.length, deletedUploads: deletedUploads.length, deletedChunks: deletedChunks.length },
      "Database wiped",
    );

    res.json({
      wikiPagesDeleted: deletedWiki.length,
      uploadsDeleted: deletedUploads.length,
      chunksDeleted: deletedChunks.length,
    });
  } catch (err) {
    logger.error({ err }, "Wipe failed");
    res.status(500).json({ error: "Wipe failed. Please try again." });
  }
});

export default router;
