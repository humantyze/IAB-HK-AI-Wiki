import { db, quizQuestionsTable } from "@workspace/db";
import type { QuizEntry, QuizCitation } from "@workspace/db";
import { desc } from "drizzle-orm";
import { retrieve } from "./knowledge-index";
import { getStoredQuestions } from "./question-generator";
import { logger } from "./logger";
import { getTextAIConfig } from "./ai-text-model";

/**
 * Bump this date whenever the quiz prompt or distractor schema changes.
 * Any cache row generated before this cutoff will be purged at startup so
 * a fresh generation picks up the new prompt.
 */
const QUIZ_CACHE_CUTOFF = new Date("2026-07-13T00:00:00Z");

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

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
  const aiConfig = getTextAIConfig("gpt-5-mini");
  if (!aiConfig) {
    logger.warn("Quiz generation skipped — AI integration not configured");
    return;
  }

  const questions = await getStoredQuestions();
  if (questions.length === 0) {
    logger.warn("Quiz generation skipped — no stored questions found");
    return;
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: aiConfig.apiKey, baseURL: aiConfig.baseUrl, timeout: 60_000 });

  const entries: QuizEntry[] = [];

  for (const question of questions) {
    try {
      const chunks = await retrieve(question, { limit: 8, sourceTypes: ["wiki"] });
      if (chunks.length === 0) continue;

      const context = chunks
        .slice(0, 6)
        .map((c, i) => `[${i + 1}] ${c.title}: ${c.content.slice(0, 300).replace(/\n/g, " ")}`)
        .join("\n");

      // Replit AI proxy requires stream:true — collect all deltas
      const stream = await client.chat.completions.create({
        model: aiConfig.model,
        stream: true,
        messages: [
          {
            role: "system",
            content:
              "You generate multiple-choice quiz entries for a knowledge base about AI in Hong Kong marketing. " +
              "Given a question and context excerpts, return ONLY valid JSON with no preamble, no markdown, no code fences. " +
              'Exact shape: {"choices":["option A","option B","option C","option D"],"correctIndex":0,"answer":"2-4 sentence explanation grounded in context"} ' +
              "Rules: exactly 4 choices, correctIndex is 0-3, choices[correctIndex] is the factually correct answer. " +
              "The three wrong answers MUST each represent a DIFFERENT type of error — use exactly these three types, one wrong answer per type:\n" +
              "• Overreach — states the rule applies more broadly or strictly than it actually does. Must NOT simply add 'always', 'never', or 'any' to the correct answer; it must change the scope, entity, or threshold in a substantive way.\n" +
              "• Reversal — directly contradicts the correct answer (e.g. 'the Act does NOT apply to…', 'this is NOT required…', 'there is no obligation to…').\n" +
              "• Wrong mechanism — reaches a plausible-sounding conclusion but via an entirely incorrect entity, body, causal chain, or legal instrument.\n" +
              "No two options — including the correct answer — may share the same logical structure or error type. " +
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

      // Shuffle choices so the correct answer isn't always in the same position
      const correctText = (choices as string[])[correctIndex as number];
      const shuffledChoices = shuffleArray(choices as string[]);
      const shuffledCorrectIndex = shuffledChoices.indexOf(correctText);

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
        choices: shuffledChoices,
        correctIndex: shuffledCorrectIndex,
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

/**
 * Clear the quiz cache if any stored entry contains upload-derived citations.
 * Called once on startup so that pre-fix rows (generated when retrieve() still
 * included upload chunks) are purged immediately. The existing "empty →
 * regenerate" startup path then schedules a fresh wiki-only generation.
 */
export async function invalidateStaleQuizCache(): Promise<void> {
  const [row] = await db
    .select()
    .from(quizQuestionsTable)
    .orderBy(desc(quizQuestionsTable.generatedAt))
    .limit(1);

  if (!row) return;

  const entries: QuizEntry[] = row.entries ?? [];
  const hasUploadContent = entries.some((entry) =>
    entry.citations.some((c) => c.sourceType !== "wiki"),
  );

  if (hasUploadContent) {
    await db.delete(quizQuestionsTable);
    logger.warn(
      "Quiz cache contained upload-derived entries — purged. A fresh wiki-only generation will be scheduled.",
    );
    return;
  }

  if (row.generatedAt < QUIZ_CACHE_CUTOFF) {
    await db.delete(quizQuestionsTable);
    logger.warn(
      { generatedAt: row.generatedAt, cutoff: QUIZ_CACHE_CUTOFF },
      "Quiz cache predates current prompt version — purged. A fresh generation will be scheduled.",
    );
  }
}

export async function getStoredQuiz(): Promise<QuizEntry[]> {
  const [row] = await db
    .select()
    .from(quizQuestionsTable)
    .orderBy(desc(quizQuestionsTable.generatedAt))
    .limit(1);

  const entries: QuizEntry[] = row?.entries ?? [];

  // Defence-in-depth: strip upload-derived citations and drop any entry that
  // has no wiki citations left (guards against cache rows that slipped through
  // the startup purge or were inserted by a concurrent write).
  return entries
    .map((entry) => ({
      ...entry,
      citations: entry.citations.filter((c) => c.sourceType === "wiki"),
    }))
    .filter((entry) => entry.citations.length > 0);
}
