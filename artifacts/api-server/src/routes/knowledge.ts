import { Router, type IRouter } from "express";
import { requireSuperAuth } from "../middlewares/auth";
import { retrieve, reindexAll, type RetrievedChunk } from "../lib/knowledge-index";
import { generateAndStoreQuestions, getStoredQuestions } from "../lib/question-generator";
import { getStoredQuiz, generateAndStoreQuiz } from "../lib/quiz-generator";
import { regenerateWikiTitles } from "../lib/ai-service";
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
 * uploads). Embeds the query, retrieves the most similar chunks, then
 * synthesises a grounded answer via SSE streaming when the model is available.
 *
 * SSE event format (when model is available and stream succeeds):
 *   event: citations\ndata: <JSON Citation[]>\n\n
 *   event: token\ndata: <JSON-encoded delta string>\n\n  (many times)
 *   event: done\ndata: \n\n
 *
 * Falls back to plain JSON for:
 *   • No model configured
 *   • Zero matching chunks
 *   • OpenAI connection/auth failure (BEFORE any SSE headers are sent)
 *   • Retrieval error
 *
 * If the stream STARTS but then fails mid-way, an event:error is emitted
 * and the partial answer is preserved on the client.
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
    chunks = await retrieve(trimmed, { limit: 8, sourceTypes: ["wiki"] });
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

  const passagesJson = chunks.map((c) => ({
    sourceType: c.sourceType,
    sourceSlug: c.sourceSlug,
    title: c.title,
    content: c.content,
    similarity: c.similarity,
  }));

  if (chunks.length === 0) {
    res.json({
      answer: "I couldn't find anything relevant in the knowledge base for that question yet.",
      citations: [],
      grounded: false,
    });
    return;
  }

  const aiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  // Render passages with their citation numbers for grounding the prompt.
  // Truncate each passage to keep the total input well within the model's
  // context window — untruncated wiki pages can be thousands of tokens each,
  // leaving no room for the answer (observed as chars=0, finishReason="length").
  const context = chunks
    .slice(0, 6)
    .map((c) => {
      const idx = indexByKey.get(citationKey(c.sourceType, c.sourceId)) ?? 0;
      const snippet = c.content.length > 800 ? c.content.slice(0, 800) + "…" : c.content;
      return `[${idx}] (${c.sourceType}) ${c.title}\n${snippet}`;
    })
    .join("\n\n---\n\n");

  if (!aiBaseUrl || !apiKey) {
    // No chat model configured — return the retrieved passages directly (JSON).
    res.json({ answer: null, grounded: true, citations, passages: passagesJson });
    return;
  }

  // Abort the LLM call if the client disconnects.
  const clientAbort = new AbortController();
  req.on("close", () => clientAbort.abort());

  // Attempt to open the OpenAI stream BEFORE committing to SSE response
  // headers. This preserves the JSON passages fallback when the model is
  // unreachable or returns an auth/rate error.
  let openaiStream: AsyncIterable<Record<string, unknown>>;
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey, baseURL: aiBaseUrl, timeout: 30_000 });
    openaiStream = (await client.chat.completions.create(
      {
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a retrieval-augmented assistant for a knowledge base about the state of AI in Hong Kong's marketing industry. " +
              "Answer the user's question using ONLY the numbered context passages provided. " +
              "Cite the passages you rely on inline using their bracketed numbers, e.g. [1] or [2][3]. " +
              "If the context does not contain the answer, say so plainly instead of inventing facts. " +
              "Write a concise answer in plain prose (2-4 sentences). Do NOT use markdown, bullet points, hyphens, headers, or any special formatting — plain sentences only. " +
              "Detect the language of the user's question and respond in that same language (English or Traditional Chinese). Keep citation markers like [1] unchanged.",
          },
          {
            role: "user",
            content: `Question: ${trimmed}\n\nContext passages:\n${context}`,
          },
        ],
        // gpt-5-mini is a reasoning model: hidden reasoning tokens count
        // against this cap. 600 was too low — hard questions (esp. Chinese)
        // burned the budget on reasoning and truncated the visible answer
        // (observed as chars=30, finishReason="length").
        max_completion_tokens: 2500,
        stream: true,
      },
      { signal: clientAbort.signal },
    )) as AsyncIterable<Record<string, unknown>>;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      // Client disconnected before we could start — nothing to send.
      res.end();
      return;
    }
    // OpenAI unavailable / auth failure → fall back to raw passages (JSON).
    logger.error({ err }, "Knowledge answer synthesis failed — returning raw passages");
    res.json({ answer: null, grounded: true, citations, passages: passagesJson });
    return;
  }

  // Stream is open — now it is safe to commit to SSE response headers.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event: string, data: string) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${data}\n\n`);
    }
  };

  // Emit citations before the first token so the client can show chips
  // immediately.
  sendEvent("citations", JSON.stringify(citations));

  try {
    let charCount = 0;
    let finishReason: string | null = null;
    for await (const chunk of openaiStream) {
      const c = chunk as { choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }> };
      const choice = c.choices?.[0];
      const delta = choice?.delta?.content ?? "";
      if (delta) {
        // JSON-encode each delta so newlines and special chars survive the wire.
        sendEvent("token", JSON.stringify(delta));
        charCount += delta.length;
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }
    sendEvent("done", "");
    logger.info(
      { query: trimmed, chunks: chunks.length, citations: citations.length, chars: charCount, finishReason },
      "Knowledge search streamed",
    );
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      // Mid-stream failure — partial answer is already on the client.
      // Signal the error so the frontend can stop the cursor / finalize.
      logger.error({ err }, "Knowledge answer synthesis interrupted mid-stream");
      sendEvent("error", JSON.stringify({ message: "Stream interrupted" }));
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});


/** Return the currently stored AI-generated sample questions. */
router.get("/knowledge/questions", async (_req, res) => {
  try {
    const questions = await getStoredQuestions();
    res.json({ questions });
  } catch (err) {
    logger.error({ err }, "Failed to fetch stored questions");
    res.status(500).json({ error: "Failed to fetch questions" });
  }
});

/** Regenerate sample questions from current wiki content (super-auth). */
router.post("/knowledge/regen-questions", requireSuperAuth, async (_req, res) => {
  try {
    const result = await generateAndStoreQuestions();
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Question regeneration failed");
    res.status(500).json({ error: "Question regeneration failed" });
  }
});

router.post("/knowledge/regen-titles", requireSuperAuth, async (_req, res) => {
  try {
    const result = await regenerateWikiTitles();
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Title regeneration failed");
    res.status(500).json({ error: "Title regeneration failed" });
  }
});

router.post("/knowledge/regen-quiz", requireSuperAuth, async (_req, res) => {
  try {
    await generateAndStoreQuiz();
    const entries = await getStoredQuiz();
    res.json({ count: entries.length });
  } catch (err) {
    logger.error({ err }, "Quiz regeneration failed");
    res.status(500).json({ error: "Quiz regeneration failed" });
  }
});

/** Return cached multiple-choice quiz entries. */
router.get("/knowledge/quiz", async (_req, res) => {
  try {
    const entries = await getStoredQuiz();
    res.json({ entries });
  } catch (err) {
    logger.error({ err }, "Failed to fetch quiz entries");
    res.status(500).json({ error: "Failed to fetch quiz" });
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
