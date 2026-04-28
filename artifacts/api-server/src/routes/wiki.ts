import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, wikiPagesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { runWikiSeed } from "../lib/wiki-seed";
import { logger } from "../lib/logger";

function formatPageSummary(p: {
  id: number;
  slug: string;
  title: string;
  tags: unknown;
  relatedSlugs: unknown;
  updatedAt: Date;
  bodyMarkdown: unknown;
}) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    tags: (p.tags as string[]) ?? [],
    relatedSlugs: (p.relatedSlugs as string[]) ?? [],
    updatedAt: p.updatedAt.toISOString(),
    excerpt: (p.bodyMarkdown as string).replace(/^#+\s.*/gm, "").replace(/[*_`]/g, "").trim().slice(0, 200),
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

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 20_000 });

    const pageList = allPages
      .map((p, i) => `${i + 1}. slug:"${p.slug}" | title:"${p.title}" | tags:[${p.tags.join(", ")}] | excerpt:"${p.excerpt.slice(0, 120)}"`)
      .join("\n");

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a semantic search assistant for a wiki about AI in Hong Kong's marketing industry. " +
            "Given a user query, return the slugs of the most relevant wiki pages in ranked order (most relevant first). " +
            "Return ONLY a JSON array of slug strings, e.g. [\"slug-one\",\"slug-two\"]. No markdown, no explanation.",
        },
        {
          role: "user",
          content: `Query: "${query.trim()}"\n\nAvailable pages:\n${pageList}\n\nReturn up to 10 slugs ranked by relevance.`,
        },
      ],
      temperature: 0,
      max_tokens: 256,
    });

    const rawContent = (response.choices[0]?.message?.content ?? "").trim().replace(/^```(?:json)?\n?|```$/g, "");

    let rankedSlugs: string[] | null = null;
    try {
      const parsed: unknown = JSON.parse(rawContent);
      if (Array.isArray(parsed)) {
        rankedSlugs = (parsed as unknown[]).filter((s): s is string => typeof s === "string");
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
    const ranked = rankedSlugs.slice(0, 10).flatMap((slug) => { const p = slugMap.get(slug); return p ? [p] : []; });

    logger.info({ query: query.trim(), ranked: ranked.length }, "Wiki AI search complete");
    res.json({ ranked: true, pages: ranked });
  } catch (err) {
    logger.error({ err }, "Wiki AI search failed — client will use local fallback");
    res.json({ ranked: false, pages: allPages });
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
    sources: (page.sources as Array<{ label: string; ref: string }>) ?? [],
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  });
});

router.post("/wiki/seed", requireAuth, async (_req, res) => {
  try {
    const { pagesCreated, pagesUpdated } = await runWikiSeed();
    res.json({ pagesCreated, pagesUpdated });
  } catch (err) {
    logger.error({ err }, "Wiki seed failed");
    res.status(500).json({ error: "Wiki seed failed" });
  }
});

export default router;
