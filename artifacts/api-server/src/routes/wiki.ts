import { Router, type IRouter } from "express";
import { eq, asc, isNull, and, ne, sql, cosineDistance, desc, inArray } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { db, wikiPagesTable, uploadsTable, knowledgeChunksTable, EMBEDDING_DIMENSIONS } from "@workspace/db";
import { requireSuperAuth } from "../middlewares/auth";
import { retrieve, indexWikiPage } from "../lib/knowledge-index";
import { generateDownloadUrl, getBackupBucket } from "../lib/gcsClient";
import sharp from "sharp";
import { extractImages } from "../lib/pdf-extractor";
import { assignImageToWikiPage, synthesizeWikiGaps } from "../lib/ai-service";
import { logger } from "../lib/logger";
import { getTextAIConfig } from "../lib/ai-text-model";

let synthesizeRunning = false;

// In-flight lock for thumbnail generation — prevents duplicate resizes for concurrent requests.
const thumbInFlight = new Map<string, Promise<void>>();

function formatPageSummary(p: {
  id: number;
  slug: string;
  title: string;
  tags: unknown;
  relatedSlugs: unknown;
  updatedAt: Date;
  excerpt: string;
  imageUrl: string | null;
  sources: unknown;
  responsibleAi: boolean;
}) {
  const sources = (p.sources as Array<{ ref?: string }>) ?? [];
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    tags: (p.tags as string[]) ?? [],
    relatedSlugs: (p.relatedSlugs as string[]) ?? [],
    updatedAt: p.updatedAt.toISOString(),
    excerpt: p.excerpt.trim(),
    imageUrl: p.imageUrl ?? null,
    synthesized: sources.some((s) => s.ref === "wiki-seed-synthesis"),
    responsibleAi: p.responsibleAi,
  };
}

const router: IRouter = Router();

async function fetchAllPageSummaries() {
  const pages = await db
    .select({
      id: wikiPagesTable.id,
      slug: wikiPagesTable.slug,
      title: wikiPagesTable.title,
      tags: wikiPagesTable.tags,
      relatedSlugs: wikiPagesTable.relatedSlugs,
      updatedAt: wikiPagesTable.updatedAt,
      excerpt: sql<string>`left(${wikiPagesTable.bodyMarkdown}, 200)`,
      imageUrl: wikiPagesTable.imageUrl,
      sources: wikiPagesTable.sources,
      responsibleAi: wikiPagesTable.responsibleAi,
    })
    .from(wikiPagesTable)
    .orderBy(
      sql`${wikiPagesTable.imageUrl} IS NOT NULL DESC`,
      desc(wikiPagesTable.createdAt),
      asc(wikiPagesTable.title)
    );
  return pages.map(formatPageSummary);
}

router.get("/wiki", async (_req, res) => {
  res.json(await fetchAllPageSummaries());
});

router.post("/wiki/search", async (req, res) => {
  const { query } = req.body as { query?: unknown };
  if (!query || typeof query !== "string" || query.trim().length < 3) {
    res.status(400).json({ error: "Query must be at least 3 characters" });
    return;
  }

  const allPages = await fetchAllPageSummaries();
  const aiConfig = getTextAIConfig("gpt-5-mini");

  if (!aiConfig) {
    res.json({ ranked: false, pages: allPages });
    return;
  }

  // Use vector retrieval to narrow the candidate set the LLM ranks over. This
  // surfaces semantically relevant pages even when keywords don't match, and
  // keeps the prompt small. Falls back to all pages if retrieval finds nothing.
  let candidatePages = allPages;
  try {
    const hits = await retrieve(query.trim(), { sourceTypes: ["wiki"], limit: 24 });
    const orderedSlugs: string[] = [];
    const seen = new Set<string>();
    for (const h of hits) {
      if (h.sourceSlug && !seen.has(h.sourceSlug)) {
        seen.add(h.sourceSlug);
        orderedSlugs.push(h.sourceSlug);
      }
    }
    const bySlug = new Map(allPages.map((p) => [p.slug, p]));
    const vectorPages = orderedSlugs.flatMap((slug) => { const p = bySlug.get(slug); return p ? [p] : []; });
    if (vectorPages.length > 0) candidatePages = vectorPages;
  } catch (err) {
    logger.warn({ err }, "Wiki vector pre-filter failed — ranking over all pages");
  }

  const pageList = candidatePages
    .map((p, i) => `${i + 1}. slug:"${p.slug}" | title:"${p.title}" | tags:[${p.tags.join(", ")}] | excerpt:"${p.excerpt.slice(0, 120)}"`)
    .join("\n");

  // Abort the LLM call if the client disconnects before the stream opens.
  const clientAbort = new AbortController();
  req.on("close", () => clientAbort.abort());

  // Open the stream BEFORE committing to SSE response headers — this preserves
  // the JSON fallback when the model is unreachable.
  type StreamChunk = { choices?: Array<{ delta?: { content?: string | null } }> };
  let openaiStream: AsyncIterable<StreamChunk>;
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: aiConfig.apiKey, baseURL: aiConfig.baseUrl, timeout: 20_000 });
    openaiStream = (await client.chat.completions.create(
      {
        model: aiConfig.model,
        messages: [
          {
            role: "system",
            content:
              "You are a semantic search assistant for a wiki about AI in Hong Kong's marketing industry. " +
              "Given a user query, return the slugs of the most relevant wiki pages in ranked order (most relevant first), " +
              "then a short 2–4 sentence plain-English summary that directly answers or contextualises the query using insights from those top pages. " +
              "In the summary, whenever you refer to a specific wiki page by name, wrap it with the marker [[Page Title|slug]] using the page's exact title and slug from the list below. " +
              "Only use this marker format for specific pages you are referencing — do not mark general phrases. " +
              "Output EXACTLY in this two-part format — no text before the SLUGS line:\n" +
              'SLUGS:["slug-one","slug-two"]\n\nYour 2–4 sentence summary here.\n' +
              "Detect the language of the user's question and respond in that same language (English or Traditional Chinese).",
          },
          {
            role: "user",
            content: `Query: "${query.trim()}"\n\nAvailable pages:\n${pageList}\n\nReturn up to 10 slugs ranked by relevance plus a 2–4 sentence summary.`,
          },
        ],
        max_completion_tokens: 1024,
        stream: true,
      },
      { signal: clientAbort.signal },
    )) as AsyncIterable<StreamChunk>;
  } catch (err) {
    if ((err as Error).name === "AbortError") { if (!res.headersSent) res.end(); return; }
    logger.error({ err }, "Wiki AI search stream failed to open — returning unranked");
    res.json({ ranked: false, pages: allPages });
    return;
  }

  // Stream is open — safe to commit SSE headers.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event: string, data: string) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${data}\n\n`);
  };

  const slugMap = new Map(allPages.map((p) => [p.slug, p]));
  let accumulated = "";
  let slugsEmitted = false;

  try {
    for await (const chunk of openaiStream) {
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
      if (!delta) continue;
      accumulated += delta;

      if (!slugsEmitted) {
        // Buffer until we see the end of the first line (the SLUGS: line).
        const newlineIdx = accumulated.indexOf("\n");
        if (newlineIdx !== -1) {
          const firstLine = accumulated.slice(0, newlineIdx).trim();
          if (firstLine.startsWith("SLUGS:")) {
            try {
              const slugArray = JSON.parse(firstLine.slice(6).trim()) as unknown[];
              const rankedSlugs = slugArray.filter((s): s is string => typeof s === "string");
              const seenSlugs = new Set<string>();
              const ranked = rankedSlugs
                .filter((s) => { if (seenSlugs.has(s)) return false; seenSlugs.add(s); return true; })
                .slice(0, 10)
                .flatMap((s) => { const p = slugMap.get(s); return p ? [p] : []; });
              sendEvent("slugs", JSON.stringify(ranked));
            } catch {
              sendEvent("slugs", JSON.stringify([]));
            }
          } else {
            sendEvent("slugs", JSON.stringify([]));
          }
          slugsEmitted = true;
          // Emit any summary text that arrived in the same chunk after the slug line.
          const rest = accumulated.slice(newlineIdx + 1).trimStart();
          if (rest) sendEvent("token", JSON.stringify(rest));
        }
      } else {
        sendEvent("token", JSON.stringify(delta));
      }
    }

    if (!slugsEmitted) sendEvent("slugs", JSON.stringify([]));
    sendEvent("done", "");
    logger.info({ query: query.trim() }, "Wiki AI search streamed");
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      logger.error({ err }, "Wiki AI search stream error");
      if (!slugsEmitted) sendEvent("slugs", JSON.stringify([]));
      sendEvent("done", "");
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});

// In-memory cache for related-pages results. The centroid + cosine scan is
// expensive and results change rarely; a 1h TTL bounds staleness from
// mutations happening outside this file (upload processing, re-indexing).
const RELATED_CACHE_TTL_MS = 60 * 60 * 1000;
const relatedCache = new Map<string, { data: ReturnType<typeof formatPageSummary>[]; expiresAt: number }>();

// Any wiki mutation can change OTHER pages' related lists (the similarity
// scan runs across all pages), so mutations clear the whole cache.
function clearRelatedCache(): void {
  relatedCache.clear();
}

router.get("/wiki/:slug/related", async (req, res) => {
  const slug = req.params.slug as string;

  const cached = relatedCache.get(slug);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      res.json(cached.data);
      return;
    }
    relatedCache.delete(slug);
  }

  try {
    // 1. Fetch all chunk embeddings for this page
    const ownChunks = await db
      .select({ embedding: knowledgeChunksTable.embedding })
      .from(knowledgeChunksTable)
      .where(
        and(
          eq(knowledgeChunksTable.sourceType, "wiki"),
          eq(knowledgeChunksTable.sourceSlug, slug),
        ),
      );

    if (ownChunks.length === 0) {
      relatedCache.set(slug, { data: [], expiresAt: Date.now() + RELATED_CACHE_TTL_MS });
      res.json([]);
      return;
    }

    // 2. Average embeddings component-wise to produce centroid vector
    const dim = EMBEDDING_DIMENSIONS;
    const centroid = new Array<number>(dim).fill(0);
    for (const { embedding } of ownChunks) {
      const vec = embedding as number[];
      for (let i = 0; i < dim; i++) centroid[i] += vec[i];
    }
    for (let i = 0; i < dim; i++) centroid[i] /= ownChunks.length;

    // 3. Cosine similarity query against other wiki pages' chunks
    const similarityExpr = sql<number>`1 - (${cosineDistance(knowledgeChunksTable.embedding, centroid)})`;
    const hits = await db
      .select({
        sourceSlug: knowledgeChunksTable.sourceSlug,
        similarity: similarityExpr,
      })
      .from(knowledgeChunksTable)
      .where(
        and(
          eq(knowledgeChunksTable.sourceType, "wiki"),
          ne(knowledgeChunksTable.sourceSlug, slug),
        ),
      )
      .orderBy(desc(similarityExpr))
      .limit(25);

    // 4. Deduplicate by sourceSlug (first = highest scoring due to ORDER BY)
    const seen = new Set<string>();
    const topSlugs: string[] = [];
    for (const h of hits) {
      if (h.sourceSlug && !seen.has(h.sourceSlug)) {
        seen.add(h.sourceSlug);
        topSlugs.push(h.sourceSlug);
        if (topSlugs.length >= 5) break;
      }
    }

    if (topSlugs.length === 0) {
      relatedCache.set(slug, { data: [], expiresAt: Date.now() + RELATED_CACHE_TTL_MS });
      res.json([]);
      return;
    }

    // 5. Fetch full page rows and return in similarity order
    const pages = await db
      .select({
        id: wikiPagesTable.id,
        slug: wikiPagesTable.slug,
        title: wikiPagesTable.title,
        tags: wikiPagesTable.tags,
        relatedSlugs: wikiPagesTable.relatedSlugs,
        updatedAt: wikiPagesTable.updatedAt,
        excerpt: sql<string>`left(${wikiPagesTable.bodyMarkdown}, 200)`,
        imageUrl: wikiPagesTable.imageUrl,
        sources: wikiPagesTable.sources,
        responsibleAi: wikiPagesTable.responsibleAi,
      })
      .from(wikiPagesTable)
      .where(inArray(wikiPagesTable.slug, topSlugs));

    const bySlug = new Map(pages.map((p) => [p.slug, p]));
    const ordered = topSlugs.flatMap((s) => { const p = bySlug.get(s); return p ? [formatPageSummary(p)] : []; });

    relatedCache.set(slug, { data: ordered, expiresAt: Date.now() + RELATED_CACHE_TTL_MS });
    res.json(ordered);
  } catch (err) {
    logger.error({ err, slug }, "Failed to compute embedding-based related pages");
    res.json([]);
  }
});

/**
 * GET /api/wiki/duplicates
 * Super-admin: find groups of wiki pages that share a near-identical normalised title.
 * NOTE: must be defined BEFORE GET /wiki/:slug to avoid the slug param capturing "duplicates".
 */
router.get("/wiki/duplicates", requireSuperAuth, async (_req, res) => {
  try {
    const pages = await db
      .select({
        id: wikiPagesTable.id,
        slug: wikiPagesTable.slug,
        title: wikiPagesTable.title,
        updatedAt: wikiPagesTable.updatedAt,
      })
      .from(wikiPagesTable)
      .orderBy(asc(wikiPagesTable.updatedAt));

    function normalizeTitle(t: string): string {
      return t.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff\s]/g, "").replace(/\s+/g, " ").trim();
    }

    const groups = new Map<string, typeof pages>();
    for (const page of pages) {
      const key = normalizeTitle(page.title);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(page);
    }

    const duplicateGroups = Array.from(groups.values())
      .filter((g) => g.length > 1)
      .map((g) =>
        g.map((p) => ({
          id: p.id,
          slug: p.slug,
          title: p.title,
          updatedAt: p.updatedAt.toISOString(),
        })),
      );

    res.json({ groups: duplicateGroups });
  } catch (err) {
    logger.error({ err }, "Failed to find duplicate wiki pages");
    res.status(500).json({ error: "Failed to find duplicate wiki pages" });
  }
});

/**
 * GET /api/wiki/:slug/source-files
 * Public: list downloadable original source files (and external source links)
 * for a wiki page. Upload-backed sources resolve to files on disk; rejected
 * uploads and missing files are skipped.
 */
router.get("/wiki/:slug/source-files", async (req, res) => {
  const slug = req.params.slug as string;

  try {
    const [page] = await db
      .select({ sources: wikiPagesTable.sources })
      .from(wikiPagesTable)
      .where(eq(wikiPagesTable.slug, slug))
      .limit(1);

    if (!page) {
      res.status(404).json({ error: "Wiki page not found" });
      return;
    }

    const sources = (page.sources as Array<{ label?: string; ref?: string }>) ?? [];
    const links: Array<{ label: string; url: string }> = [];
    const uploadIds = new Set<number>();
    const labelByUploadId = new Map<number, string>();

    for (const src of sources) {
      const ref = typeof src.ref === "string" ? src.ref : "";
      const label = typeof src.label === "string" && src.label.trim() ? src.label.trim() : ref;
      if (/^https?:\/\//i.test(ref)) {
        links.push({ label, url: ref });
        continue;
      }
      const match = ref.match(/^Upload #(\d+)/);
      if (match) {
        const id = Number(match[1]);
        uploadIds.add(id);
        if (!labelByUploadId.has(id)) labelByUploadId.set(id, label);
      }
    }

    const files: Array<{ uploadId: number; filename: string; sizeBytes: number; label: string }> = [];
    const submitters: string[] = [];

    if (uploadIds.size > 0) {
      const uploads = await db
        .select({
          id: uploadsTable.id,
          filePath: uploadsTable.filePath,
          moderationStatus: uploadsTable.moderationStatus,
          uploaderName: uploadsTable.uploaderName,
        })
        .from(uploadsTable)
        .where(inArray(uploadsTable.id, Array.from(uploadIds)));

      const uploadsDir = path.join(process.cwd(), "uploads");
      for (const upload of uploads) {
        if (upload.moderationStatus === "rejected") continue;

        if (upload.uploaderName && !submitters.includes(upload.uploaderName)) {
          submitters.push(upload.uploaderName);
        }

        if (!upload.filePath) continue;
        const filenames = upload.filePath.split(",").map((f) => f.trim()).filter(Boolean);
        for (const filename of filenames) {
          if (path.basename(filename) !== filename) continue;
          const absPath = path.join(uploadsDir, filename);
          try {
            const stat = fs.statSync(absPath);
            if (!stat.isFile()) continue;
            files.push({
              uploadId: upload.id,
              filename,
              sizeBytes: stat.size,
              label: labelByUploadId.get(upload.id) ?? filename,
            });
          } catch {
            // File missing on disk — skip silently.
          }
        }
      }
    }

    res.json({ files, links, submitters });
  } catch (err) {
    logger.error({ err, slug }, "Failed to list wiki source files");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/wiki-source-file?uploadId=&filename=
 * Public: stream one original uploaded source file. The filename must belong
 * to the referenced upload's stored file list (no path traversal), and the
 * upload must not be rejected by moderation.
 */
router.get("/wiki-source-file", async (req, res) => {
  const { uploadId: rawId, filename } = req.query as { uploadId?: string; filename?: string };
  const uploadId = parseInt(String(rawId), 10);

  if (isNaN(uploadId) || !filename || typeof filename !== "string") {
    res.status(400).json({ error: "uploadId and filename are required" });
    return;
  }
  if (path.basename(filename) !== filename || filename.includes("..")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  try {
    const [upload] = await db
      .select({
        id: uploadsTable.id,
        filePath: uploadsTable.filePath,
        moderationStatus: uploadsTable.moderationStatus,
      })
      .from(uploadsTable)
      .where(eq(uploadsTable.id, uploadId))
      .limit(1);

    if (!upload || upload.moderationStatus === "rejected" || !upload.filePath) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const allowed = upload.filePath.split(",").map((f) => f.trim()).filter(Boolean);
    if (!allowed.includes(filename)) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const absPath = path.join(process.cwd(), "uploads", filename);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    res.download(absPath, filename, (err) => {
      if (err && !res.headersSent) {
        logger.error({ err, uploadId, filename }, "Failed to stream source file");
        res.status(500).json({ error: "Failed to download file" });
      }
    });
  } catch (err) {
    logger.error({ err, uploadId, filename }, "Failed to download wiki source file");
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/wiki/:slug", async (req, res) => {
  const slug = req.params.slug as string;

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
    sources: [],
    imageUrl: page.imageUrl ?? null,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  });
});

router.get("/wiki-image", async (req, res) => {
  const { path: objectPath, variant } = req.query as { path?: string; variant?: string };
  if (!objectPath || typeof objectPath !== "string" || objectPath.trim().length === 0) {
    res.status(400).json({ error: "Missing path query parameter" });
    return;
  }
  if (!objectPath.startsWith("wiki-images/")) {
    res.status(400).json({ error: "Invalid image path" });
    return;
  }

  // Derive thumbnail GCS path: wiki-images/foo.png → wiki-images/thumbs/foo.webp
  const wantThumb = variant === "thumb";
  let serveObjectPath = objectPath;

  if (wantThumb) {
    const lastSlash = objectPath.lastIndexOf("/");
    const dir = objectPath.slice(0, lastSlash);
    const file = objectPath.slice(lastSlash + 1);
    const baseName = file.includes(".") ? file.slice(0, file.lastIndexOf(".")) : file;
    const thumbPath = `${dir}/thumbs/${baseName}.webp`;

    try {
      const bucket = getBackupBucket();
      const [exists] = await bucket.file(thumbPath).exists();

      if (!exists) {
        // Ensure only one resize runs at a time per thumbnail path.
        let inFlight = thumbInFlight.get(thumbPath);
        if (!inFlight) {
          inFlight = (async () => {
            const [origBuffer] = await bucket.file(objectPath).download();
            const thumbBuffer = await sharp(origBuffer)
              .resize({ width: 600, withoutEnlargement: true })
              .webp({ quality: 75 })
              .toBuffer();
            await bucket.file(thumbPath).save(thumbBuffer, { contentType: "image/webp" });
          })();
          thumbInFlight.set(thumbPath, inFlight);
          try {
            await inFlight;
          } finally {
            thumbInFlight.delete(thumbPath);
          }
        } else {
          await inFlight;
        }
      }

      serveObjectPath = thumbPath;
    } catch (err) {
      // Thumbnail generation failed — fall back to original silently.
      logger.warn({ err, objectPath, thumbPath }, "Thumbnail generation failed — serving original");
      serveObjectPath = objectPath;
    }
  }

  try {
    const signedUrl = await generateDownloadUrl(serveObjectPath);
    res.redirect(302, signedUrl);
  } catch (err) {
    logger.error({ err, objectPath }, "Failed to generate wiki image signed URL");
    res.status(500).json({ error: "Image unavailable" });
  }
});

/**
 * DELETE /api/wiki/:slug/image
 * Super-admin: clear the image on a specific wiki page.
 */
router.delete("/wiki/:slug/image", requireSuperAuth, async (req, res) => {
  const slug = req.params.slug as string;
  try {
    const [updated] = await db
      .update(wikiPagesTable)
      .set({ imageUrl: null, updatedAt: new Date() })
      .where(eq(wikiPagesTable.slug, slug))
      .returning({ slug: wikiPagesTable.slug, title: wikiPagesTable.title });
    if (!updated) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    clearRelatedCache();
    logger.info({ slug }, "Wiki page image cleared by super-admin");
    res.json({ ok: true, slug: updated.slug, title: updated.title });
  } catch (err) {
    logger.error({ err, slug }, "Failed to clear wiki page image");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/wiki/backfill-images
 * Super-admin: re-process archived PDFs to assign images to wiki pages that
 * currently have no image. Already-imaged pages are skipped.
 */
router.post("/wiki/backfill-images", requireSuperAuth, async (_req, res) => {
  const uploadsDir = path.join(process.cwd(), "uploads");

  try {
    // Fetch all uploads that have a stored PDF file path
    const uploads = await db
      .select({
        id: uploadsTable.id,
        filePath: uploadsTable.filePath,
        contentType: uploadsTable.contentType,
        contributorName: uploadsTable.contributorName,
      })
      .from(uploadsTable);

    const pdfUploads = uploads.filter(
      (u) => u.filePath && u.filePath.split(",").some((f) => f.trim().toLowerCase().endsWith(".pdf")),
    );

    // Fetch all wiki pages that have no image yet
    const imagelessPages = await db
      .select({
        id: wikiPagesTable.id,
        slug: wikiPagesTable.slug,
        title: wikiPagesTable.title,
        bodyMarkdown: wikiPagesTable.bodyMarkdown,
        sources: wikiPagesTable.sources,
      })
      .from(wikiPagesTable)
      .where(isNull(wikiPagesTable.imageUrl));

    if (imagelessPages.length === 0) {
      res.json({ pagesUpdated: 0, uploadsProcessed: 0, message: "All wiki pages already have images." });
      return;
    }

    // Build a map: uploadId -> imageless wiki pages sourced from it
    const pagesByUploadId = new Map<number, typeof imagelessPages>();
    for (const page of imagelessPages) {
      const sources = (page.sources as Array<{ label: string; ref: string }>) ?? [];
      for (const source of sources) {
        const match = source.ref.match(/^Upload #(\d+)/);
        if (!match) continue;
        const uploadId = Number(match[1]);
        if (!pagesByUploadId.has(uploadId)) pagesByUploadId.set(uploadId, []);
        pagesByUploadId.get(uploadId)!.push(page);
      }
    }

    let pagesUpdated = 0;
    let uploadsProcessed = 0;

    for (const upload of pdfUploads) {
      const targetPages = pagesByUploadId.get(upload.id);
      if (!targetPages || targetPages.length === 0) continue;

      const absPath = path.join(uploadsDir, upload.filePath!);
      logger.info({ uploadId: upload.id, filePath: upload.filePath }, "Backfill: extracting images from PDF");

      let candidateImageUrls: string[];
      try {
        candidateImageUrls = await extractImages(absPath);
      } catch (err) {
        logger.warn({ err, uploadId: upload.id }, "Backfill: image extraction failed — skipping upload");
        continue;
      }

      if (candidateImageUrls.length === 0) {
        logger.info({ uploadId: upload.id }, "Backfill: no images found in PDF — skipping");
        continue;
      }

      uploadsProcessed++;

      for (const page of targetPages) {
        const chosen = await assignImageToWikiPage(page.title, page.bodyMarkdown, candidateImageUrls);
        if (!chosen) continue;

        await db
          .update(wikiPagesTable)
          .set({ imageUrl: chosen, updatedAt: new Date() })
          .where(eq(wikiPagesTable.id, page.id));

        pagesUpdated++;
        logger.info({ pageSlug: page.slug, imageUrl: chosen }, "Backfill: assigned image to wiki page");
      }
    }

    if (pagesUpdated > 0) clearRelatedCache();
    logger.info({ pagesUpdated, uploadsProcessed }, "Wiki image backfill complete");
    res.json({ pagesUpdated, uploadsProcessed });
  } catch (err) {
    logger.error({ err }, "Wiki image backfill failed");
    res.status(500).json({ error: "Wiki image backfill failed" });
  }
});

router.post("/wiki/synthesize-gaps", requireSuperAuth, async (_req, res) => {
  if (synthesizeRunning) {
    res.status(409).json({ error: "Synthesis already in progress" });
    return;
  }
  synthesizeRunning = true;
  try {
    const pages = await db
      .select({ title: wikiPagesTable.title, slug: wikiPagesTable.slug, bodyMarkdown: wikiPagesTable.bodyMarkdown })
      .from(wikiPagesTable)
      .orderBy(asc(wikiPagesTable.title));

    const sectionSummaries = pages.map((p) => ({
      title: p.title,
      bodyMarkdown: p.bodyMarkdown as string,
    }));
    const existingPages = pages.map((p) => ({ title: p.title, slug: p.slug }));

    const { created, updated } = await synthesizeWikiGaps(sectionSummaries, existingPages);
    if (created > 0 || updated > 0) clearRelatedCache();
    logger.info({ created, updated }, "Wiki gap synthesis complete");
    res.json({ created, updated });
  } catch (err) {
    logger.error({ err }, "Wiki gap synthesis failed");
    res.status(500).json({ error: "Wiki gap synthesis failed" });
  } finally {
    synthesizeRunning = false;
  }
});

/**
 * POST /api/wiki/merge
 * Super-admin: merge the content of deleteSlug into keepSlug, then delete deleteSlug.
 * Body: { keepSlug: string; deleteSlug: string; mergeContent: boolean }
 */
router.post("/wiki/merge", requireSuperAuth, async (req, res) => {
  const { keepSlug, deleteSlug, mergeContent } = req.body as {
    keepSlug?: unknown;
    deleteSlug?: unknown;
    mergeContent?: unknown;
  };

  if (typeof keepSlug !== "string" || typeof deleteSlug !== "string") {
    res.status(400).json({ error: "keepSlug and deleteSlug are required strings" });
    return;
  }
  if (keepSlug === deleteSlug) {
    res.status(400).json({ error: "keepSlug and deleteSlug must be different" });
    return;
  }

  try {
    const [keepPage] = await db
      .select()
      .from(wikiPagesTable)
      .where(eq(wikiPagesTable.slug, keepSlug))
      .limit(1);
    const [deletePage] = await db
      .select()
      .from(wikiPagesTable)
      .where(eq(wikiPagesTable.slug, deleteSlug))
      .limit(1);

    if (!keepPage) {
      res.status(404).json({ error: `Page not found: ${keepSlug}` });
      return;
    }
    if (!deletePage) {
      res.status(404).json({ error: `Page not found: ${deleteSlug}` });
      return;
    }

    if (mergeContent === true) {
      const appendedBody = `${keepPage.bodyMarkdown as string}\n\n---\n\n*Merged from "${deletePage.title}":*\n\n${deletePage.bodyMarkdown as string}`;
      await db
        .update(wikiPagesTable)
        .set({ bodyMarkdown: appendedBody, updatedAt: new Date() })
        .where(eq(wikiPagesTable.slug, keepSlug));

      try {
        await indexWikiPage(keepSlug);
      } catch (indexErr) {
        logger.warn({ indexErr, slug: keepSlug }, "Merge: re-indexing kept page failed (non-fatal)");
      }
    }

    await db.delete(knowledgeChunksTable).where(
      and(
        eq(knowledgeChunksTable.sourceType, "wiki"),
        eq(knowledgeChunksTable.sourceSlug, deleteSlug),
      ),
    );
    await db.delete(wikiPagesTable).where(eq(wikiPagesTable.slug, deleteSlug));

    clearRelatedCache();
    logger.info({ keepSlug, deleteSlug, mergeContent }, "Wiki pages merged");
    res.json({ ok: true, keepSlug, deletedSlug: deleteSlug });
  } catch (err) {
    logger.error({ err }, "Wiki page merge failed");
    res.status(500).json({ error: "Wiki page merge failed" });
  }
});

router.delete("/wiki/pages", requireSuperAuth, async (req, res) => {
  const { slugs } = req.body as { slugs?: unknown };
  if (!Array.isArray(slugs) || slugs.length === 0 || !slugs.every((s) => typeof s === "string")) {
    res.status(400).json({ error: "slugs must be a non-empty array of strings" });
    return;
  }
  try {
    await db.delete(knowledgeChunksTable).where(
      and(
        eq(knowledgeChunksTable.sourceType, "wiki"),
        inArray(knowledgeChunksTable.sourceSlug, slugs as string[]),
      ),
    );
    const result = await db.delete(wikiPagesTable).where(inArray(wikiPagesTable.slug, slugs as string[])).returning({ slug: wikiPagesTable.slug });
    clearRelatedCache();
    logger.info({ deleted: result.length, slugs }, "Wiki pages deleted");
    res.json({ deleted: result.length });
  } catch (err) {
    logger.error({ err }, "Wiki page deletion failed");
    res.status(500).json({ error: "Wiki page deletion failed" });
  }
});

export default router;
