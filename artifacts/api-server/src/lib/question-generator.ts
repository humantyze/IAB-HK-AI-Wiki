import { db, wikiPagesTable, knowledgeQuestionsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { retrieve } from "./knowledge-index";
import { logger } from "./logger";

let regenRunning = false;

/**
 * Generate 10 sample questions from current wiki content, verify each has rich
 * RAG retrieval (non-zero reranker score sum), and persist to DB.
 * Fire-and-forget safe: guards against concurrent runs.
 */
export async function generateAndStoreQuestions(): Promise<{ questions: string[] }> {
  if (regenRunning) {
    logger.info("Question regeneration already in progress — skipping");
    return { questions: [] };
  }
  regenRunning = true;
  try {
    return await _generate();
  } catch (err) {
    logger.error({ err }, "Question generation failed");
    return { questions: [] };
  } finally {
    regenRunning = false;
  }
}

async function _generate(): Promise<{ questions: string[] }> {
  const aiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!aiBaseUrl || !apiKey) {
    logger.warn("Question generation skipped — AI integration not configured");
    return { questions: [] };
  }

  const pages = await db
    .select({ title: wikiPagesTable.title, body: wikiPagesTable.bodyMarkdown })
    .from(wikiPagesTable)
    .limit(30);

  if (pages.length === 0) {
    logger.warn("Question generation skipped — no wiki pages found");
    return { questions: [] };
  }

  const context = pages
    .map((p) => `- ${p.title}: ${p.body.slice(0, 250).replace(/\n/g, " ")}`)
    .join("\n");

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey, baseURL: aiBaseUrl, timeout: 45_000 });

  // The Replit AI proxy only delivers content via streaming — non-streaming
  // completions return empty content. Collect all deltas into a single string.
  const stream = await client.chat.completions.create({
    model: "gpt-5-mini",
    stream: true,
    messages: [
      {
        role: "system",
        content:
          "You are generating questions for a knowledge base about AI in Hong Kong's marketing industry. " +
          "Generate exactly 15 specific, interesting questions a marketing professional would want answered. " +
          "Each question MUST be answerable from the topics listed — ask about specific protocols, organizations, " +
          "statistics, forecasts, or technology named in the content. " +
          "Do NOT ask vague general questions. Do NOT ask 'How are HK marketers using AI in general?' — " +
          "ask about specific named entities or data points instead. " +
          "Each question must be 10 words or fewer. " +
          "Return ONLY a valid JSON array of 15 question strings, no preamble or explanation.",
      },
      {
        role: "user",
        content: `Knowledge base topics:\n${context}`,
      },
    ],
  });

  let raw = "";
  for await (const chunk of stream) {
    const delta = (chunk as { choices?: Array<{ delta?: { content?: string | null } }> })
      .choices?.[0]?.delta?.content ?? "";
    if (delta) raw += delta;
  }
  raw = raw.trim();
  let candidates: string[] = [];
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    candidates = JSON.parse(match ? match[0] : raw) as string[];
  } catch {
    logger.error({ raw }, "Failed to parse question candidates from AI response");
    return { questions: [] };
  }

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { questions: [] };
  }

  // Score each candidate by RAG richness: sum of reranker scores across top chunks.
  const scored: Array<{ question: string; score: number }> = [];
  for (const question of candidates.slice(0, 15)) {
    if (typeof question !== "string" || question.trim().length < 5) continue;
    try {
      const chunks = await retrieve(question.trim(), { limit: 8 });
      const score = chunks.reduce((sum, c) => sum + c.similarity, 0);
      if (score > 0) {
        scored.push({ question: question.trim(), score });
      }
    } catch (err) {
      logger.warn({ err, question }, "Retrieve failed for question candidate — skipping");
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const questions = scored.slice(0, 10).map((s) => s.question);

  if (questions.length === 0) {
    logger.warn("Question generation produced 0 RAG-verified questions");
    return { questions: [] };
  }

  await db.delete(knowledgeQuestionsTable);
  await db.insert(knowledgeQuestionsTable).values({ questions, generatedAt: new Date() });

  logger.info({ count: questions.length, topScore: scored[0]?.score }, "Sample questions regenerated and stored");
  return { questions };
}

export async function getStoredQuestions(): Promise<string[]> {
  const [row] = await db
    .select()
    .from(knowledgeQuestionsTable)
    .orderBy(desc(knowledgeQuestionsTable.generatedAt))
    .limit(1);
  return row?.questions ?? [];
}
