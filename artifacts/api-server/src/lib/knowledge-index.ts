import { and, eq, sql, cosineDistance, gt, desc, inArray } from "drizzle-orm";
import {
  db,
  knowledgeChunksTable,
  wikiPagesTable,
  uploadsTable,
  type KnowledgeSourceType,
  type InsertKnowledgeChunk,
} from "@workspace/db";
import { embed, embedBatch, chunkText } from "./embeddings";
import { logger } from "./logger";

interface IndexSourceInput {
  sourceType: KnowledgeSourceType;
  sourceId: number;
  sourceSlug?: string | null;
  title: string;
  text: string;
}

// Stable numeric class per source type for Postgres two-key advisory locks.
const ADVISORY_LOCK_CLASS: Record<KnowledgeSourceType, number> = {
  wiki: 1,
  upload: 2,
};

/**
 * Chunk + embed a source's text into rows ready for insertion. Does NOT touch
 * the database, so the (potentially slow) embedding work happens outside any
 * transaction/lock.
 */
async function buildChunkRows(input: IndexSourceInput): Promise<InsertKnowledgeChunk[]> {
  const { sourceType, sourceId, sourceSlug = null, title } = input;
  const chunks = chunkText(input.text);
  if (chunks.length === 0) return [];

  // Prefix each chunk with the title so isolated chunks keep topical context.
  const toEmbed = chunks.map((c) => (title ? `${title}\n\n${c}` : c));
  const vectors = await embedBatch(toEmbed);

  return chunks.map((content, i) => ({
    sourceType,
    sourceId,
    sourceSlug,
    title,
    chunkIndex: i,
    content,
    embedding: vectors[i],
  }));
}

/**
 * Re-index a single source: removes its existing chunks, then chunks + embeds
 * the new text and stores the vectors. Idempotent per source.
 *
 * The delete + insert run inside one transaction guarded by a per-source
 * advisory lock, so concurrent index jobs for the SAME source serialize
 * instead of interleaving into duplicate/stale chunk sets.
 */
export async function indexSource(input: IndexSourceInput): Promise<number> {
  const { sourceType, sourceId } = input;
  const rows = await buildChunkRows(input);

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASS[sourceType]}, ${sourceId})`,
    );
    await tx
      .delete(knowledgeChunksTable)
      .where(and(eq(knowledgeChunksTable.sourceType, sourceType), eq(knowledgeChunksTable.sourceId, sourceId)));
    if (rows.length > 0) {
      await tx.insert(knowledgeChunksTable).values(rows);
    }
  });

  return rows.length;
}

export async function removeSource(sourceType: KnowledgeSourceType, sourceId: number): Promise<void> {
  await db
    .delete(knowledgeChunksTable)
    .where(and(eq(knowledgeChunksTable.sourceType, sourceType), eq(knowledgeChunksTable.sourceId, sourceId)));
}

export async function removeAllOfType(sourceType: KnowledgeSourceType): Promise<void> {
  await db.delete(knowledgeChunksTable).where(eq(knowledgeChunksTable.sourceType, sourceType));
}

/** Re-index a single wiki page by slug (removes it from the index if empty/missing). */
export async function indexWikiPage(slug: string): Promise<void> {
  const [page] = await db
    .select({
      id: wikiPagesTable.id,
      slug: wikiPagesTable.slug,
      title: wikiPagesTable.title,
      bodyMarkdown: wikiPagesTable.bodyMarkdown,
    })
    .from(wikiPagesTable)
    .where(eq(wikiPagesTable.slug, slug))
    .limit(1);
  if (!page || !page.bodyMarkdown.trim()) return;
  await indexSource({
    sourceType: "wiki",
    sourceId: page.id,
    sourceSlug: page.slug,
    title: page.title,
    text: page.bodyMarkdown,
  });
}

export interface RetrievedChunk {
  sourceType: KnowledgeSourceType;
  sourceId: number;
  sourceSlug: string | null;
  title: string;
  content: string;
  similarity: number;
}

export interface RetrieveOptions {
  limit?: number;
  sourceTypes?: KnowledgeSourceType[];
  minSimilarity?: number;
}

/** Embed the query and return the most similar chunks across the corpus. */
export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<RetrievedChunk[]> {
  const { limit = 8, sourceTypes, minSimilarity = 0.10 } = opts;
  const trimmed = query.trim();
  if (!trimmed) return [];

  const queryVector = await embed(trimmed);
  const similarity = sql<number>`1 - (${cosineDistance(knowledgeChunksTable.embedding, queryVector)})`;

  const conditions = [gt(similarity, minSimilarity)];
  if (sourceTypes && sourceTypes.length > 0) {
    conditions.push(inArray(knowledgeChunksTable.sourceType, sourceTypes));
  }

  const rows = await db
    .select({
      sourceType: knowledgeChunksTable.sourceType,
      sourceId: knowledgeChunksTable.sourceId,
      sourceSlug: knowledgeChunksTable.sourceSlug,
      title: knowledgeChunksTable.title,
      content: knowledgeChunksTable.content,
      similarity,
    })
    .from(knowledgeChunksTable)
    .where(and(...conditions))
    .orderBy(desc(similarity))
    .limit(limit);

  return rows.map((r) => ({
    sourceType: r.sourceType as KnowledgeSourceType,
    sourceId: r.sourceId,
    sourceSlug: r.sourceSlug,
    title: r.title,
    content: r.content,
    similarity: Number(r.similarity),
  }));
}

/** Count indexed chunks (used to decide whether a backfill is needed). */
export async function countChunks(): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(knowledgeChunksTable);
  return count;
}

/**
 * Rebuild the entire knowledge index from current wiki pages and uploads.
 * Returns per-source counts.
 */
export async function reindexAll(): Promise<{ wiki: number; uploads: number; chunks: number }> {
  // Build every chunk + embedding FIRST (slow work, no DB writes), then swap
  // the whole corpus in a single transaction.
  const allRows: InsertKnowledgeChunk[] = [];

  // Wiki pages
  const wiki = await db
    .select({ id: wikiPagesTable.id, slug: wikiPagesTable.slug, title: wikiPagesTable.title, bodyMarkdown: wikiPagesTable.bodyMarkdown })
    .from(wikiPagesTable);
  let wikiCount = 0;
  for (const w of wiki) {
    if (!w.bodyMarkdown.trim()) continue;
    const rows = await buildChunkRows({ sourceType: "wiki", sourceId: w.id, sourceSlug: w.slug, title: w.title, text: w.bodyMarkdown });
    if (rows.length === 0) continue;
    allRows.push(...rows);
    wikiCount++;
  }

  // Uploads (raw submitted text)
  const uploads = await db
    .select({ id: uploadsTable.id, contentType: uploadsTable.contentType, contributorName: uploadsTable.contributorName, rawText: uploadsTable.rawText })
    .from(uploadsTable);
  let uploadCount = 0;
  for (const u of uploads) {
    if (!u.rawText.trim()) continue;
    const title = `${u.contributorName ? `${u.contributorName} — ` : ""}${u.contentType.replace(/_/g, " ")}`;
    const rows = await buildChunkRows({ sourceType: "upload", sourceId: u.id, sourceSlug: null, title, text: u.rawText });
    if (rows.length === 0) continue;
    allRows.push(...rows);
    uploadCount++;
  }

  await db.transaction(async (tx) => {
    await tx.delete(knowledgeChunksTable);
    const BATCH = 200;
    for (let i = 0; i < allRows.length; i += BATCH) {
      await tx.insert(knowledgeChunksTable).values(allRows.slice(i, i + BATCH));
    }
  });

  const result = { wiki: wikiCount, uploads: uploadCount, chunks: allRows.length };
  logger.info(result, "Knowledge index rebuild complete");
  return result;
}

/**
 * Delete any knowledge_chunks rows with a source_type that no longer exists
 * in the schema (e.g. legacy "section" rows from before the sections feature
 * was removed). Safe to call on every startup — a no-op when no stale rows
 * exist.
 */
export async function cleanupLegacyChunks(): Promise<void> {
  try {
    const result = await db.execute(
      sql`DELETE FROM knowledge_chunks WHERE source_type NOT IN ('wiki', 'upload')`,
    );
    const deleted = (result as { rowCount?: number }).rowCount ?? 0;
    if (deleted > 0) {
      logger.info({ deleted }, "Cleaned up legacy knowledge chunks (non-wiki/upload source types)");
    }
  } catch (err) {
    logger.error({ err }, "cleanupLegacyChunks failed — stale chunks may remain");
  }
}

/** Run a one-off backfill in the background if the index is empty. */
export async function indexKnowledgeIfEmpty(): Promise<void> {
  try {
    const count = await countChunks();
    if (count > 0) {
      logger.info({ count }, "Knowledge index already populated — skipping backfill");
      return;
    }
    logger.info("Knowledge index empty — starting backfill");
    await reindexAll();
  } catch (err) {
    logger.error({ err }, "Knowledge backfill failed — retrieval will be degraded until reindex");
  }
}
