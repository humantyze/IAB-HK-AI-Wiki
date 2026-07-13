import { Router, type IRouter } from "express";
import { eq, asc, isNull, and, ne, sql, cosineDistance, desc, inArray } from "drizzle-orm";
import path from "path";
import { db, wikiPagesTable, uploadsTable, knowledgeChunksTable, EMBEDDING_DIMENSIONS } from "@workspace/db";
import { requireSuperAuth } from "../middlewares/auth";
import { retrieve } from "../lib/knowledge-index";
import { generateDownloadUrl } from "../lib/gcsClient";
import { extractImages } from "../lib/pdf-extractor";
import { assignImageToWikiPage, synthesizeWikiGaps } from "../lib/ai-service";
import { logger } from "../lib/logger";

let synthesizeRunning = false;

function formatPageSummary(p: {
  id: number;
  slug: string;
  title: string;
  tags: unknown;
  relatedSlugs: unknown;
  updatedAt: Date;
  bodyMarkdown: unknown;
  imageUrl: string | null;
}) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    tags: (p.tags as string[]) ?? [],
    relatedSlugs: (p.relatedSlugs as string[]) ?? [],
    updatedAt: p.updatedAt.toISOString(),
    excerpt: (p.bodyMarkdown as string).replace(/^#+\s.*/gm, "").replace(/[*_`]/g, "").trim().slice(0, 200),
    imageUrl: p.imageUrl ?? null,
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
      bodyMarkdown: wikiPagesTable.bodyMarkdown,
      imageUrl: wikiPagesTable.imageUrl,
    })
    .from(wikiPagesTable)
    .orderBy(asc(wikiPagesTable.title));
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

  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  if (!baseUrl || !apiKey) {
    res.json({ ranked: false, pages: allPages });
    return;
  }

  // Use vector retrieval to narrow the candidate set the LLM ranks over. This
  // surfaces semantically relevant pages even when keywords don't match, and
  // keeps the prompt small. Falls back to all pages if retrieval finds nothing.
  let candidatePages = allPages;
  try {
    const hits = await retrieve(query.trim(), { sourceTypes: ["wiki"], limit: 24, rerank: false });
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

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 20_000 });

    const pageList = candidatePages
      .map((p, i) => `${i + 1}. slug:"${p.slug}" | title:"${p.title}" | tags:[${p.tags.join(", ")}] | excerpt:"${p.excerpt.slice(0, 120)}"`)
      .join("\n");

    const response = await client.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a semantic search assistant for a wiki about AI in Hong Kong's marketing industry. " +
            "Given a user query, return the slugs of the most relevant wiki pages in ranked order (most relevant first), " +
            "and a short 2–4 sentence plain-English summary that directly answers or contextualises the query using insights from those top pages. " +
            "In the summary, whenever you refer to a specific wiki page by name, wrap it with the marker [[Page Title|slug]] using the page's exact title and slug from the list below. " +
            "Only use this marker format for specific pages you are referencing — do not mark general phrases. " +
            'Respond with a JSON object in exactly this shape: {"slugs":["slug-one","slug-two"],"summary":"Your summary here."}. No markdown, no explanation outside the JSON. ' +
            "Detect the language of the user's question and respond in that same language (English or Traditional Chinese). Keep citation markers like [1] unchanged.",
        },
        {
          role: "user",
          content: `Query: "${query.trim()}"\n\nAvailable pages:\n${pageList}\n\nReturn up to 10 slugs ranked by relevance plus a 2–4 sentence summary as {"slugs":[...],"summary":"..."}.`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 512,
    });

    const rawContent = (response.choices[0]?.message?.content ?? "").trim();

    let rankedSlugs: string[] | null = null;
    let aiSummary: string | undefined;
    try {
      const parsed = JSON.parse(rawContent) as { slugs?: unknown; summary?: unknown };
      if (Array.isArray(parsed.slugs)) {
        rankedSlugs = (parsed.slugs as unknown[]).filter((s): s is string => typeof s === "string");
      }
      if (typeof parsed.summary === "string" && parsed.summary.trim().length > 0) {
        aiSummary = parsed.summary.trim();
      }
    } catch {
      rankedSlugs = null;
    }

    if (rankedSlugs === null) {
      logger.warn({ query: query.trim() }, "Wiki AI search — malformed LLM output, returning unranked");
      res.json({ ranked: false, pages: allPages });
      return;
    }

    const slugMap = new Map(allPages.map((p) => [p.slug, p]));
    const seenSlugs = new Set<string>();
    const ranked = rankedSlugs
      .filter((slug) => { if (seenSlugs.has(slug)) return false; seenSlugs.add(slug); return true; })
      .slice(0, 10)
      .flatMap((slug) => { const p = slugMap.get(slug); return p ? [p] : []; });

    if (ranked.length === 0) {
      logger.info({ query: query.trim() }, "Wiki AI search — no valid slugs resolved, returning unranked");
      res.json({ ranked: false, pages: allPages });
      return;
    }

    logger.info({ query: query.trim(), ranked: ranked.length }, "Wiki AI search complete");
    res.json({ ranked: true, pages: ranked, ...(aiSummary ? { summary: aiSummary } : {}) });
  } catch (err) {
    logger.error({ err }, "Wiki AI search failed — client will use local fallback");
    res.json({ ranked: false, pages: allPages });
  }
});

router.get("/wiki/:slug/related", async (req, res) => {
  const { slug } = req.params;
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
        bodyMarkdown: wikiPagesTable.bodyMarkdown,
        imageUrl: wikiPagesTable.imageUrl,
      })
      .from(wikiPagesTable)
      .where(inArray(wikiPagesTable.slug, topSlugs));

    const bySlug = new Map(pages.map((p) => [p.slug, p]));
    const ordered = topSlugs.flatMap((s) => { const p = bySlug.get(s); return p ? [formatPageSummary(p)] : []; });

    res.json(ordered);
  } catch (err) {
    logger.error({ err, slug }, "Failed to compute embedding-based related pages");
    res.json([]);
  }
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
    sources: [],
    imageUrl: page.imageUrl ?? null,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  });
});

router.get("/wiki-image", async (req, res) => {
  const { path: objectPath } = req.query as { path?: string };
  if (!objectPath || typeof objectPath !== "string" || objectPath.trim().length === 0) {
    res.status(400).json({ error: "Missing path query parameter" });
    return;
  }
  if (!objectPath.startsWith("wiki-images/")) {
    res.status(400).json({ error: "Invalid image path" });
    return;
  }
  try {
    const signedUrl = await generateDownloadUrl(objectPath);
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
  const { slug } = req.params;
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
    logger.info({ created, updated }, "Wiki gap synthesis complete");
    res.json({ created, updated });
  } catch (err) {
    logger.error({ err }, "Wiki gap synthesis failed");
    res.status(500).json({ error: "Wiki gap synthesis failed" });
  } finally {
    synthesizeRunning = false;
  }
});

export default router;
