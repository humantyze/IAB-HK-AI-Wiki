import { Router, type IRouter } from "express";
import { eq, gt } from "drizzle-orm";
import { db, uploadsTable, wikiPagesTable, knowledgeChunksTable } from "@workspace/db";
import { requireSuperAuth } from "../middlewares/auth";
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
