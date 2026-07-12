import { db, quizQuestionsTable } from "@workspace/db";
import type { QuizEntry, QuizCitation } from "@workspace/db";
import { desc } from "drizzle-orm";
import { retrieve } from "./knowledge-index";
import { getStoredQuestions } from "./question-generator";
import { logger } from "./logger";

let quizGenRunning = false;

export async function generateAndStoreQuiz(): Promise<void> {
  if (quizGenRunning) {
    logger.info("Quiz generation already in progress — skipping");
    return;
  }
  quizGenRunning = true;
  try {
    await _generateQuiz();
  } catch (err) {
    logger.error({ err }, "Quiz generation failed");
  } finally {
    quizGenRunning = false;
  }
}

async function _generateQuiz(): Promise<void> {
  const aiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!aiBaseUrl || !apiKey) {
    logger.warn("Quiz generation skipped — AI integration not configured");
    return;
  }

  const questions = await getStoredQuestions();
  if (questions.length === 0) {
    logger.warn("Quiz generation skipped — no stored questions found");
    return;
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey, baseURL: aiBaseUrl, timeout: 60_000 });

  const entries: QuizEntry[] = [];

  for (const question of questions) {
    try {
      const chunks = await retrieve(question, { limit: 8 });
      if (chunks.length === 0) continue;

      const context = chunks
        .slice(0, 6)
        .map((c, i) => `[${i + 1}] ${c.title}: ${c.content.slice(0, 300).replace(/\n/g, " ")}`)
        .join("\n");

      // Replit AI proxy requires stream:true — collect all deltas
      const stream = await client.chat.completions.create({
        model: "gpt-5-mini",
        stream: true,
        messages: [
          {
            role: "system",
            content:
              "You generate multiple-choice quiz entries for a knowledge base about AI in Hong Kong marketing. " +
              "Given a question and context excerpts, return ONLY valid JSON with no preamble, no markdown, no code fences. " +
              'Exact shape: {"choices":["option A","option B","option C","option D"],"correctIndex":0,"answer":"2-4 sentence explanation grounded in context"} ' +
              "Rules: exactly 4 choices, correctIndex is 0-3, choices[correctIndex] is the factually correct answer, " +
              "the other three are plausible but wrong distractors from the same domain. " +
              "Answer must be 2-4 sentences, grounded in the provided context, written for a marketing professional.",
          },
          {
            role: "user",
            content: `Question: ${question}\n\nContext:\n${context}`,
          },
        ],
      });

      let raw = "";
      for await (const chunk of stream) {
        const delta =
          (
            chunk as {
              choices?: Array<{ delta?: { content?: string | null } }>;
            }
          ).choices?.[0]?.delta?.content ?? "";
        if (delta) raw += delta;
      }
      raw = raw.trim();

      // Extract JSON object — strip any markdown code fences
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn({ question, raw }, "Quiz LLM returned no JSON object — skipping");
        continue;
      }

      let parsed: { choices?: unknown; correctIndex?: unknown; answer?: unknown };
      try {
        parsed = JSON.parse(jsonMatch[0]) as typeof parsed;
      } catch {
        logger.warn({ question, raw }, "Quiz LLM JSON parse failed — skipping");
        continue;
      }

      const { choices, correctIndex, answer } = parsed;
      if (
        !Array.isArray(choices) ||
        choices.length !== 4 ||
        typeof correctIndex !== "number" ||
        correctIndex < 0 ||
        correctIndex > 3 ||
        typeof answer !== "string" ||
        answer.trim().length === 0
      ) {
        logger.warn({ question, parsed }, "Quiz LLM returned malformed entry — skipping");
        continue;
      }

      // Build deduplicated citations from retrieved chunks
      const seen = new Set<string>();
      const citations: QuizCitation[] = [];
      let citIdx = 1;
      for (const chunk of chunks) {
        const key = chunk.sourceSlug ?? `${chunk.sourceType}:${chunk.sourceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        citations.push({
          index: citIdx++,
          sourceType: chunk.sourceType,
          sourceSlug: chunk.sourceSlug,
          title: chunk.title,
          similarity: chunk.similarity,
        });
      }

      entries.push({
        question,
        choices: choices as string[],
        correctIndex,
        answer: answer.trim(),
        citations,
      });

      logger.info({ question }, "Quiz entry generated");
    } catch (err) {
      logger.warn({ err, question }, "Failed to generate quiz entry for question — skipping");
    }
  }

  if (entries.length === 0) {
    logger.warn("Quiz generation produced 0 entries — not overwriting cache");
    return;
  }

  await db.delete(quizQuestionsTable);
  await db.insert(quizQuestionsTable).values({ entries, generatedAt: new Date() });
  logger.info({ count: entries.length }, "Quiz entries stored");
}

export async function getStoredQuiz(): Promise<QuizEntry[]> {
  const [row] = await db
    .select()
    .from(quizQuestionsTable)
    .orderBy(desc(quizQuestionsTable.generatedAt))
    .limit(1);
  return row?.entries ?? [];
}
