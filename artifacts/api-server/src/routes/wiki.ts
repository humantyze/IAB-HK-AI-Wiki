import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, wikiPagesTable, sectionsTable, sectionVersionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { extractWikiPages } from "../lib/ai-service";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/wiki", async (_req, res) => {
  const pages = await db
    .select({
      id: wikiPagesTable.id,
      slug: wikiPagesTable.slug,
      title: wikiPagesTable.title,
      tags: wikiPagesTable.tags,
      relatedSlugs: wikiPagesTable.relatedSlugs,
      updatedAt: wikiPagesTable.updatedAt,
      bodyMarkdown: wikiPagesTable.bodyMarkdown,
    })
    .from(wikiPagesTable)
    .orderBy(asc(wikiPagesTable.title));

  res.json(
    pages.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      tags: (p.tags as string[]) ?? [],
      relatedSlugs: (p.relatedSlugs as string[]) ?? [],
      updatedAt: p.updatedAt.toISOString(),
      excerpt: (p.bodyMarkdown as string).replace(/^#+\s.*/gm, "").replace(/[*_`]/g, "").trim().slice(0, 200),
    })),
  );
});

router.get("/wiki/:slug", async (req, res) => {
  const { slug } = req.params;

  const [page] = await db
    .select()
    .from(wikiPagesTable)
    .where(eq(wikiPagesTable.slug, slug))
    .limit(1);

  if (!page) {
    res.status(404).json({ error: "Wiki page not found" });
    return;
  }

  res.json({
    id: page.id,
    slug: page.slug,
    title: page.title,
    bodyMarkdown: page.bodyMarkdown,
    tags: (page.tags as string[]) ?? [],
    relatedSlugs: (page.relatedSlugs as string[]) ?? [],
    sources: (page.sources as Array<{ label: string; ref: string }>) ?? [],
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  });
});

router.post("/wiki/seed", requireAuth, async (_req, res) => {
  try {
    const rows = await db
      .select({
        slug: sectionsTable.slug,
        title: sectionsTable.title,
        bodyMarkdown: sectionVersionsTable.bodyMarkdown,
      })
      .from(sectionsTable)
      .leftJoin(sectionVersionsTable, eq(sectionsTable.currentVersionId, sectionVersionsTable.id))
      .orderBy(asc(sectionsTable.displayOrder));

    let pagesCreated = 0;
    let pagesUpdated = 0;

    for (const row of rows) {
      if (!row.bodyMarkdown) continue;

      const sourceRef = `§ ${row.title}`;
      const result = await extractWikiPages(row.title, row.bodyMarkdown, sourceRef);
      pagesCreated += result.created;
      pagesUpdated += result.updated;
    }

    res.json({ pagesCreated, pagesUpdated });
  } catch (err) {
    logger.error({ err }, "Wiki seed failed");
    res.status(500).json({ error: "Wiki seed failed" });
  }
});

export default router;
