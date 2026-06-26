import { pgTable, serial, jsonb, timestamp } from "drizzle-orm/pg-core";

export const knowledgeQuestionsTable = pgTable("knowledge_questions", {
  id: serial("id").primaryKey(),
  questions: jsonb("questions").notNull().$type<string[]>().default([]),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export type KnowledgeQuestions = typeof knowledgeQuestionsTable.$inferSelect;
