import { sql } from "drizzle-orm";
import { db, wikiPagesTable } from "@workspace/db";
import { logger } from "./logger";

export async function runWikiSeed(): Promise<{ pagesCreated: number; pagesUpdated: number }> {
  logger.info("runWikiSeed: report sections have been removed — wiki is built from uploaded PDFs");
  return { pagesCreated: 0, pagesUpdated: 0 };
}

export async function seedWikiIfEmpty(): Promise<void> {
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(wikiPagesTable);

    if (count > 0) {
      logger.info({ count }, "Wiki already has pages — skipping auto-seed");
      return;
    }

    logger.info("Wiki is empty — no auto-seed available (wiki is built from uploaded PDFs)");
  } catch (err) {
    logger.error({ err }, "seedWikiIfEmpty check failed");
  }
}
