import { Router, type IRouter } from "express";
import { eq, gt, lte, desc, asc, and, notInArray } from "drizzle-orm";
import { db, uploadsTable, sectionsTable, sectionVersionsTable, wikiPagesTable } from "@workspace/db";
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

  const allSections = await db
    .select({ id: sectionsTable.id, currentVersionId: sectionsTable.currentVersionId })
    .from(sectionsTable);

  let sectionsAffected = 0;
  for (const section of allSections) {
    if (!section.currentVersionId) continue;
    const [currentVersion] = await db
      .select({ createdAt: sectionVersionsTable.createdAt })
      .from(sectionVersionsTable)
      .where(eq(sectionVersionsTable.id, section.currentVersionId))
      .limit(1);
    if (currentVersion && currentVersion.createdAt > date) {
      sectionsAffected++;
    }
  }

  const wikiPagesRemoved = await db
    .select({ id: wikiPagesTable.id })
    .from(wikiPagesTable)
    .where(gt(wikiPagesTable.createdAt, date));

  const uploadsRemoved = await db
    .select({ id: uploadsTable.id })
    .from(uploadsTable)
    .where(gt(uploadsTable.createdAt, date));

  const versionsRemoved = await db
    .select({ id: sectionVersionsTable.id })
    .from(sectionVersionsTable)
    .where(gt(sectionVersionsTable.createdAt, date));

  res.json({
    sectionsAffected,
    wikiPagesRemoved: wikiPagesRemoved.length,
    uploadsRemoved: uploadsRemoved.length,
    versionsRemoved: versionsRemoved.length,
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
    let sectionsReverted = 0;
    const allSections = await db.select().from(sectionsTable);

    // Collect fallback (seed) version IDs to preserve from deletion
    const preservedVersionIds: number[] = [];

    for (const section of allSections) {
      // Find the latest version on or before the target date
      const [bestVersion] = await db
        .select({ id: sectionVersionsTable.id })
        .from(sectionVersionsTable)
        .where(and(
          eq(sectionVersionsTable.sectionId, section.id),
          lte(sectionVersionsTable.createdAt, date),
        ))
        .orderBy(desc(sectionVersionsTable.createdAt))
        .limit(1);

      let newVersionId: number | null;

      if (bestVersion) {
        newVersionId = bestVersion.id;
      } else {
        // Fallback: use the earliest (seed) version so section is never empty
        const [seedVersion] = await db
          .select({ id: sectionVersionsTable.id })
          .from(sectionVersionsTable)
          .where(eq(sectionVersionsTable.sectionId, section.id))
          .orderBy(asc(sectionVersionsTable.createdAt))
          .limit(1);
        newVersionId = seedVersion?.id ?? null;
        if (newVersionId !== null) {
          preservedVersionIds.push(newVersionId);
        }
      }

      if (newVersionId !== section.currentVersionId) {
        await db
          .update(sectionsTable)
          .set({ currentVersionId: newVersionId })
          .where(eq(sectionsTable.id, section.id));
        sectionsReverted++;
      }
    }

    // Delete versions after the target date, sparing preserved seed versions
    let deletedVersions: { id: number }[];
    if (preservedVersionIds.length > 0) {
      deletedVersions = await db
        .delete(sectionVersionsTable)
        .where(and(
          gt(sectionVersionsTable.createdAt, date),
          notInArray(sectionVersionsTable.id, preservedVersionIds),
        ))
        .returning({ id: sectionVersionsTable.id });
    } else {
      deletedVersions = await db
        .delete(sectionVersionsTable)
        .where(gt(sectionVersionsTable.createdAt, date))
        .returning({ id: sectionVersionsTable.id });
    }

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
      { targetDate, sectionsReverted, deletedVersions: deletedVersions.length, deletedWiki: deletedWiki.length, deletedUploads: deletedUploads.length, preservedSeedVersions: preservedVersionIds.length },
      "Wiki regressed to date",
    );

    res.json({
      sectionsReverted,
      versionsDeleted: deletedVersions.length,
      wikiPagesDeleted: deletedWiki.length,
      uploadsDeleted: deletedUploads.length,
    });
  } catch (err) {
    logger.error({ err }, "Regression failed");
    res.status(500).json({ error: "Regression failed. Please try again." });
  }
});

export default router;
