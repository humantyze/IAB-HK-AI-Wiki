import { asc, eq, sql } from "drizzle-orm";
import { db, wikiPagesTable, sectionsTable, sectionVersionsTable } from "@workspace/db";
import { extractWikiPages, synthesizeWikiGaps } from "./ai-service";
import { removeAllOfType } from "./knowledge-index";
import { logger } from "./logger";

export async function runWikiSeed(): Promise<{ pagesCreated: number; pagesUpdated: number }> {
  // Wipe all existing wiki pages so Build Wiki is always a clean rebuild
  // from the current section state — not an accumulation of prior content.
  await db.delete(wikiPagesTable);
  // Drop stale wiki vectors too; extractWikiPages/synthesizeWikiGaps re-index
  // each page as it is rebuilt.
  await removeAllOfType("wiki");
  logger.info("Wiki pages cleared before rebuild");

  const rows = await db
    .select({
      slug: sectionsTable.slug,
      title: sectionsTable.title,
      bodyMarkdown: sectionVersionsTable.bodyMarkdown,
    })
    .from(sectionsTable)
    .leftJoin(sectionVersionsTable, eq(sectionsTable.currentVersionId, sectionVersionsTable.id))
    .orderBy(asc(sectionsTable.displayOrder));

  const validSections = rows.filter((r) => r.bodyMarkdown);

  let pagesCreated = 0;
  let pagesUpdated = 0;

  for (const row of validSections) {
    const sourceRef = `§ ${row.title}`;
    const result = await extractWikiPages(row.title, row.bodyMarkdown as string, sourceRef);
    pagesCreated += result.created;
    pagesUpdated += result.updated;
  }

  if (validSections.length > 0) {
    const allPages = await db
      .select({ title: wikiPagesTable.title })
      .from(wikiPagesTable);
    const existingTitles = allPages.map((p) => p.title);

    const sectionSummaries = validSections.map((r) => ({
      title: r.title,
      bodyMarkdown: r.bodyMarkdown as string,
    }));

    const synthesis = await synthesizeWikiGaps(sectionSummaries, existingTitles);
    pagesCreated += synthesis.created;
  }

  return { pagesCreated, pagesUpdated };
}

export async function seedWikiIfEmpty(): Promise<void> {
  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    logger.info("AI env vars not set — skipping wiki auto-seed");
    return;
  }

  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(wikiPagesTable);

    if (count > 0) {
      logger.info({ count }, "Wiki already has pages — skipping auto-seed");
      return;
    }

    logger.info("Wiki is empty — starting automatic seed");

    const { pagesCreated, pagesUpdated } = await runWikiSeed();

    logger.info({ pagesCreated, pagesUpdated }, "Auto-seed complete");
  } catch (err) {
    logger.error({ err }, "Auto-seed failed — server will continue without wiki content");
  }
}
