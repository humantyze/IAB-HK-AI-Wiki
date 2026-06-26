import { Router, type IRouter } from "express";
import { eq, gt, asc } from "drizzle-orm";
import { db, uploadsTable, wikiPagesTable, knowledgeChunksTable } from "@workspace/db";
import type { ProcessingError } from "@workspace/db";
import { requireSuperAuth } from "../middlewares/auth";
import { extractWikiPages } from "../lib/ai-service";
import { indexSource, removeSource, indexWikiPage } from "../lib/knowledge-index";
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
    const cascadeDeletedWikiIds: number[] = [];
    const updatedWikiSlugs: string[] = [];
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
            cascadeDeletedWikiIds.push(page.id);
          } else {
            await db.update(wikiPagesTable).set({ sources: filteredSources }).where(eq(wikiPagesTable.id, page.id));
            updatedWikiSlugs.push(page.slug);
          }
        }
      }
    }

    // Reconcile the knowledge index with every delete/update above so a
    // regression never leaves stale chunks pointing at removed sources.
    try {
      for (const w of deletedWiki) await removeSource("wiki", w.id);
      for (const u of deletedUploads) await removeSource("upload", u.id);
      for (const id of cascadeDeletedWikiIds) await removeSource("wiki", id);
      for (const slug of updatedWikiSlugs) await indexWikiPage(slug);
    } catch (reconcileErr) {
      logger.error({ err: reconcileErr }, "Knowledge index reconciliation after regress failed");
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

interface ReprocessResult {
  id: number;
  status: string;
  wikiPagesCreated: number;
  wikiPagesUpdated: number;
  errors: ProcessingError[];
}

/**
 * Re-runs wiki extraction and knowledge indexing for every upload that has
 * stored raw text. Runs synchronously so the caller receives per-upload
 * results in the response body.
 */
router.post("/admin/reprocess-uploads", requireSuperAuth, async (_req, res) => {
  const uploads = await db.select().from(uploadsTable).orderBy(asc(uploadsTable.id));
  const eligible = uploads.filter((u) => u.rawText && u.rawText.trim().length >= 50);

  const results: ReprocessResult[] = [];

  for (const upload of eligible) {
    const errors: ProcessingError[] = [];
    let wikiPagesCreated = 0;
    let wikiPagesUpdated = 0;
    let finalStatus = "processed";

    const sourceLabel = upload.contributorName ?? upload.contentType.replace(/_/g, " ");
    const sourceRef = `Upload #${upload.id} — ${upload.contentType.replace(/_/g, " ")}`;
    const uploadTitle = `${upload.contributorName ? `${upload.contributorName} — ` : ""}${upload.contentType.replace(/_/g, " ")}`;

    try {
      const { created, updated } = await extractWikiPages(sourceLabel, upload.rawText, sourceRef, []);
      wikiPagesCreated = created;
      wikiPagesUpdated = updated;

      if (created === 0 && updated === 0) {
        errors.push({
          step: "wiki_extraction",
          message: "AI returned 0 pages from non-empty text during reprocess",
          ts: new Date().toISOString(),
        });
        finalStatus = "failed";
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, uploadId: upload.id }, "Wiki extraction failed during reprocess");
      errors.push({ step: "wiki_extraction", message, ts: new Date().toISOString() });
      finalStatus = "failed";
    }

    // Only index eligible uploads; a failed upload must never leave chunks
    // behind, so pull any existing ones when reprocessing ends in failure.
    if (finalStatus === "failed") {
      try {
        await removeSource("upload", upload.id);
      } catch (err) {
        logger.error({ err, uploadId: upload.id }, "Failed to remove failed upload from index during reprocess");
      }
    } else {
      try {
        await indexSource({
          sourceType: "upload",
          sourceId: upload.id,
          sourceSlug: null,
          title: uploadTitle,
          text: upload.rawText,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err, uploadId: upload.id }, "Knowledge indexing failed during reprocess");
        errors.push({ step: "knowledge_indexing", message, ts: new Date().toISOString() });
        finalStatus = finalStatus === "processed" ? "partial" : finalStatus;
      }
    }

    await db
      .update(uploadsTable)
      .set({
        status: finalStatus,
        processedAt: new Date(),
        processingErrors: errors.length > 0 ? errors : null,
      })
      .where(eq(uploadsTable.id, upload.id))
      .catch((dbErr) => logger.error({ dbErr, uploadId: upload.id }, "Failed to write reprocess result to DB"));

    results.push({ id: upload.id, status: finalStatus, wikiPagesCreated, wikiPagesUpdated, errors });
  }

  const succeeded = results.filter((r) => r.status === "processed").length;
  const failed = results.filter((r) => r.status === "partial").length;
  logger.info({ succeeded, failed, total: eligible.length }, "Upload reprocess complete");

  res.json({ count: eligible.length, succeeded, failed, results });
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
