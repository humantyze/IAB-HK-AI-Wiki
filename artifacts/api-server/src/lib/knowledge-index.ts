import { and, eq, sql, cosineDistance, desc, inArray, or } from "drizzle-orm";
import {
  db,
  knowledgeChunksTable,
  wikiPagesTable,
  uploadsTable,
  type KnowledgeSourceType,
  type InsertKnowledgeChunk,
} from "@workspace/db";
import { embedQuery, embedPassages, chunkText } from "./embeddings";
import { logger } from "./logger";

// An upload's chunks are only retrievable once it has finished processing
// successfully ("processed") or with non-critical issues ("partial"). Uploads
// that are still "pending" or have "failed" must never surface in search.
export const ELIGIBLE_UPLOAD_STATUSES = ["processed", "partial"];

// Bump this whenever the embedding MODEL or the CHUNKING strategy changes.
// Stored vectors are only comparable to query vectors from the SAME model, and
// chunk boundaries are baked into the stored rows — so a change here must force
// a one-time full rebuild of knowledge_chunks (see ensureIndexUpToDate).
const INDEX_VERSION = "openai-text-embedding-3-small-1536d-v1";

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
  const vectors = await embedPassages(toEmbed);

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
  /** Candidates to gather per retrieval method before fusion. */
  candidatePool?: number;
}

interface Candidate {
  id: number;
  sourceType: KnowledgeSourceType;
  sourceId: number;
  sourceSlug: string | null;
  title: string;
  content: string;
}

// Reciprocal Rank Fusion constant — dampens the influence of any single rank.
const RRF_K = 60;
// Minimum cosine similarity (from vector search) to keep a fused candidate.
// Chunks that appear only in keyword results with no vector signal are dropped.
const MIN_SIMILARITY_FLOOR = 0.3;

/**
 * Hybrid retrieval: fuse dense vector search (semantic) with Postgres full-text
 * keyword search (exact terms, names, numbers) via Reciprocal Rank Fusion, then
 * apply a cosine similarity floor to drop low-signal candidates.
 *
 * Upload chunks are filtered to eligible processing statuses so pending/failed
 * uploads never surface. The keyword score is computed inline with
 * `to_tsvector('simple', ...)` — the corpus is small enough that the per-query
 * cost is negligible.
 */
export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<RetrievedChunk[]> {
  const {
    limit = 8,
    sourceTypes,
    candidatePool = 40,
  } = opts;
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Shared filters: only eligible upload statuses, plus optional source-type filter.
  // LEFT JOIN uploads so the status check applies to upload chunks only; wiki
  // chunks (no join match) always pass.
  const uploadEligible = or(
    sql`${knowledgeChunksTable.sourceType} <> 'upload'`,
    inArray(uploadsTable.status, ELIGIBLE_UPLOAD_STATUSES),
  );
  const typeFilter =
    sourceTypes && sourceTypes.length > 0
      ? inArray(knowledgeChunksTable.sourceType, sourceTypes)
      : undefined;
  const joinUploads = and(
    eq(knowledgeChunksTable.sourceType, sql`'upload'`),
    eq(knowledgeChunksTable.sourceId, uploadsTable.id),
  );

  const baseSelect = {
    id: knowledgeChunksTable.id,
    sourceType: knowledgeChunksTable.sourceType,
    sourceId: knowledgeChunksTable.sourceId,
    sourceSlug: knowledgeChunksTable.sourceSlug,
    title: knowledgeChunksTable.title,
    content: knowledgeChunksTable.content,
  };

  // ---- Dense vector candidates (with similarity score for floor filtering) ----
  const queryVector = await embedQuery(trimmed);
  const similarityExpr = sql<number>`1 - (${cosineDistance(knowledgeChunksTable.embedding, queryVector)})`;
  const vectorRows = await db
    .select({ ...baseSelect, similarity: similarityExpr })
    .from(knowledgeChunksTable)
    .leftJoin(uploadsTable, joinUploads)
    .where(and(uploadEligible, typeFilter))
    .orderBy(desc(similarityExpr))
    .limit(candidatePool);

  // Track per-chunk cosine similarity for the post-fusion floor filter.
  const vectorSimilarity = new Map<number, number>(
    vectorRows.map((r) => [r.id, Number(r.similarity)]),
  );

  // ---- Keyword (full-text) candidates ----
  const tsquery = sql`websearch_to_tsquery('simple', ${trimmed})`;
  const tsvector = sql`to_tsvector('simple', coalesce(${knowledgeChunksTable.title}, '') || ' ' || ${knowledgeChunksTable.content})`;
  const keywordRank = sql<number>`ts_rank_cd(${tsvector}, ${tsquery})`;
  const keywordRows = await db
    .select(baseSelect)
    .from(knowledgeChunksTable)
    .leftJoin(uploadsTable, joinUploads)
    .where(and(uploadEligible, typeFilter, sql`${tsvector} @@ ${tsquery}`))
    .orderBy(desc(keywordRank))
    .limit(candidatePool);

  // ---- Reciprocal Rank Fusion ----
  const fused = new Map<number, { candidate: Candidate; score: number }>();
  const addRanked = (rows: Array<{ id: number; sourceType: string; sourceId: number; sourceSlug: string | null; title: string; content: string }>) => {
    rows.forEach((row, i) => {
      const contribution = 1 / (RRF_K + i + 1);
      const existing = fused.get(row.id);
      if (existing) {
        existing.score += contribution;
      } else {
        fused.set(row.id, {
          candidate: { ...row, sourceType: row.sourceType as KnowledgeSourceType },
          score: contribution,
        });
      }
    });
  };
  addRanked(vectorRows);
  addRanked(keywordRows);

  if (fused.size === 0) return [];

  // Sort by RRF score, then apply cosine similarity floor to drop low-signal chunks.
  const ranked = [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .filter((r) => (vectorSimilarity.get(r.candidate.id) ?? 0) >= MIN_SIMILARITY_FLOOR);

  return ranked.slice(0, limit).map((r) => ({
    sourceType: r.candidate.sourceType,
    sourceId: r.candidate.sourceId,
    sourceSlug: r.candidate.sourceSlug,
    title: r.candidate.title,
    content: r.candidate.content,
    similarity: vectorSimilarity.get(r.candidate.id) ?? 0,
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

  // Uploads (raw submitted text) — only those that finished processing
  // successfully or partially; pending/failed uploads are never indexed.
  const uploads = await db
    .select({ id: uploadsTable.id, contentType: uploadsTable.contentType, contributorName: uploadsTable.contributorName, rawText: uploadsTable.rawText })
    .from(uploadsTable)
    .where(inArray(uploadsTable.status, ELIGIBLE_UPLOAD_STATUSES));
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
 * Additively ensure the wiki_pages.body_segments column exists. Created on
 * demand (ADD COLUMN IF NOT EXISTS — no drizzle migration, no data loss) so the
 * per-source body-segment tracking self-heals in dev and prod regardless of
 * whether migrations are run, mirroring the knowledge_index_meta pattern.
 */
export async function ensureWikiSchema(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS body_segments jsonb NOT NULL DEFAULT '[]'::jsonb`,
  );
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

// Persists which embedding/chunking version the current knowledge_chunks were
// built with. Created on demand (idempotent, additive — no migration, no source
// data touched) so it works identically in dev and production.
async function readIndexVersion(): Promise<string | null> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS knowledge_index_meta (
      id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      version text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const res = await db.execute(sql`SELECT version FROM knowledge_index_meta WHERE id = 1 LIMIT 1`);
  const rows = (res as unknown as { rows: Array<{ version: string }> }).rows ?? [];
  return rows.length > 0 ? rows[0].version : null;
}

async function writeIndexVersion(version: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO knowledge_index_meta (id, version, updated_at)
    VALUES (1, ${version}, now())
    ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, updated_at = now()
  `);
}

/**
 * Ensure the knowledge index matches the current embedding-model + chunking
 * version. Runs exactly ONE full reindex when the version changes (or on a
 * fresh/empty DB), then records the version so subsequent restarts are no-ops.
 *
 * This guarantees a model/chunker swap rebuilds knowledge_chunks automatically
 * instead of leaving stale vectors from an older model that are not comparable
 * to the new query embeddings.
 */
export async function ensureIndexUpToDate(): Promise<void> {
  try {
    const stored = await readIndexVersion();
    const count = await countChunks();
    if (stored === INDEX_VERSION && count > 0) {
      logger.info({ version: stored, count }, "Knowledge index version current — no reindex needed");
      return;
    }
    logger.warn(
      { stored, current: INDEX_VERSION, count },
      "Knowledge index stale or empty — running one-time full reindex",
    );
    await reindexAll();
    await writeIndexVersion(INDEX_VERSION);
  } catch (err) {
    logger.error({ err }, "ensureIndexUpToDate failed — retrieval may be degraded until manual reindex");
  }
}
