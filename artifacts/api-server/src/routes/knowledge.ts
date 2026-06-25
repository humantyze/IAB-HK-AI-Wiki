import { Router, type IRouter } from "express";
import { requireSuperAuth } from "../middlewares/auth";
import { retrieve, reindexAll, type RetrievedChunk } from "../lib/knowledge-index";
import { logger } from "../lib/logger";

const router: IRouter = Router();

interface Citation {
  index: number;
  sourceType: RetrievedChunk["sourceType"];
  sourceId: number;
  sourceSlug: string | null;
  title: string;
  similarity: number;
}

/**
 * Semantic RAG over the FULL corpus (report sections + wiki pages + raw
 * uploads). Embeds the query, retrieves the most similar chunks across every
 * source, then synthesises a grounded answer with citations. Falls back to
 * returning the raw retrieved passages when the chat model is unavailable.
 */
router.post("/knowledge/search", async (req, res) => {
  const { query } = req.body as { query?: unknown };
  if (!query || typeof query !== "string" || query.trim().length < 3) {
    res.status(400).json({ error: "Query must be at least 3 characters" });
    return;
  }
  const trimmed = query.trim();

  let chunks: RetrievedChunk[];
  try {
    chunks = await retrieve(trimmed, { limit: 8 });
  } catch (err) {
    logger.error({ err }, "Knowledge retrieval failed");
    res.status(500).json({ error: "Retrieval failed. Please try again." });
    return;
  }

  // Deduplicate citations by source (type + id) while preserving best-match order.
  const citations: Citation[] = [];
  const indexByKey = new Map<string, number>();
  const citationKey = (sourceType: RetrievedChunk["sourceType"], sourceId: number) => `${sourceType}:${sourceId}`;
  for (const c of chunks) {
    const key = citationKey(c.sourceType, c.sourceId);
    if (indexByKey.has(key)) continue;
    const index = citations.length + 1;
    indexByKey.set(key, index);
    citations.push({
      index,
      sourceType: c.sourceType,
      sourceId: c.sourceId,
      sourceSlug: c.sourceSlug,
      title: c.title,
      similarity: c.similarity,
    });
  }

  if (chunks.length === 0) {
    res.json({
      answer: "I couldn't find anything relevant in the knowledge base for that question yet.",
      citations: [],
      grounded: false,
    });
    return;
  }

  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  // Render passages with their citation numbers for grounding the prompt.
  const context = chunks
    .map((c) => {
      const idx = indexByKey.get(citationKey(c.sourceType, c.sourceId)) ?? 0;
      return `[${idx}] (${c.sourceType}) ${c.title}\n${c.content}`;
    })
    .join("\n\n---\n\n");

  if (!baseUrl || !apiKey) {
    // No chat model configured — return the retrieved passages directly.
    res.json({
      answer: null,
      grounded: true,
      citations,
      passages: chunks.map((c) => ({
        sourceType: c.sourceType,
        sourceSlug: c.sourceSlug,
        title: c.title,
        content: c.content,
        similarity: c.similarity,
      })),
    });
    return;
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 30_000 });

    const response = await client.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a retrieval-augmented assistant for a knowledge base about the state of AI in Hong Kong's marketing industry. " +
            "Answer the user's question using ONLY the numbered context passages provided. " +
            "Cite the passages you rely on inline using their bracketed numbers, e.g. [1] or [2][3]. " +
            "If the context does not contain the answer, say so plainly instead of inventing facts. " +
            "Write a concise, well-structured answer (2-5 sentences or short bullets).",
        },
        {
          role: "user",
          content: `Question: ${trimmed}\n\nContext passages:\n${context}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 600,
    });

    const answer = (response.choices[0]?.message?.content ?? "").trim();
    logger.info({ query: trimmed, chunks: chunks.length, citations: citations.length }, "Knowledge search complete");
    res.json({ answer, grounded: true, citations });
  } catch (err) {
    logger.error({ err }, "Knowledge answer synthesis failed — returning raw passages");
    res.json({
      answer: null,
      grounded: true,
      citations,
      passages: chunks.map((c) => ({
        sourceType: c.sourceType,
        sourceSlug: c.sourceSlug,
        title: c.title,
        content: c.content,
        similarity: c.similarity,
      })),
    });
  }
});


/** Rebuild the entire vector index from current sections, wiki, and uploads. */
router.post("/knowledge/reindex", requireSuperAuth, async (_req, res) => {
  try {
    const result = await reindexAll();
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Knowledge reindex failed");
    res.status(500).json({ error: "Reindex failed" });
  }
});

export default router;
