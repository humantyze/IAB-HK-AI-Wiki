import { pgTable, serial, jsonb, timestamp } from "drizzle-orm/pg-core";

export interface QuizCitation {
  index: number;
  sourceType: string;
  sourceSlug: string | null;
  title: string;
  similarity: number;
}

export interface QuizEntry {
  question: string;
  choices: string[];
  correctIndex: number;
  answer: string;
  citations: QuizCitation[];
}

export const quizQuestionsTable = pgTable("quiz_questions", {
  id: serial("id").primaryKey(),
  entries: jsonb("entries").notNull().$type<QuizEntry[]>().default([]),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});
