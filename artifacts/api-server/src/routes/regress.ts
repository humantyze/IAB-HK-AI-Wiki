import { Router, type IRouter } from "express";
import { eq, gt, asc } from "drizzle-orm";
import { db, uploadsTable, wikiPagesTable, knowledgeChunksTable } from "@workspace/db";
import { requireSuperAuth } from "../middlewares/auth";
import { removeRefFromPage } from "../lib/ai-service";
import { removeSource, indexWikiPage } from "../lib/knowledge-index";
import { reprocessUpload } from "../lib/upload-processing";
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
      const removeDeleted = (ref: string) => {
        const match = ref.match(/^Upload #(\d+)/);
        return match ? deletedUploadIds.has(Number(match[1])) : false;
      };
      const remainingWiki = await db.select().from(wikiPagesTable);
      for (const page of remainingWiki) {
        const sources = (page.sources as Array<{ label: string; ref: string }>) ?? [];
        if (!sources.some((s) => removeDeleted(s.ref))) continue;
        // Strip the deleted uploads' citations AND their body segment(s), then
        // re-derive the body so reverted content actually leaves the page.
        const reconciled = removeRefFromPage(page, removeDeleted);
        if (reconciled.isEmpty) {
          await db.delete(wikiPagesTable).where(eq(wikiPagesTable.id, page.id));
          cascadeDeletedWikiIds.push(page.id);
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

/**
 * Re-runs wiki extraction and knowledge indexing for every upload that has
 * stored raw text. Runs synchronously so the caller receives per-upload
 * results in the response body. Shares the exact per-upload pipeline used by
 * the crash-recovery sweep (reprocessUpload).
 */
router.post("/admin/reprocess-uploads", requireSuperAuth, async (_req, res) => {
  const uploads = await db.select().from(uploadsTable).orderBy(asc(uploadsTable.id));
  const eligible = uploads.filter((u) => u.rawText && u.rawText.trim().length >= 50);

  const results = [];
  for (const upload of eligible) {
    results.push(await reprocessUpload(upload));
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
