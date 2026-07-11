import { pgTable, serial, integer, text, timestamp, vector, index } from "drizzle-orm/pg-core";

export type KnowledgeSourceType = "wiki" | "upload";

export const EMBEDDING_DIMENSIONS = 2048;

export const knowledgeChunksTable = pgTable(
  "knowledge_chunks",
  {
    id: serial("id").primaryKey(),
    sourceType: text("source_type").notNull().$type<KnowledgeSourceType>(),
    sourceId: integer("source_id").notNull(),
    sourceSlug: text("source_slug"),
    title: text("title").notNull().default(""),
    chunkIndex: integer("chunk_index").notNull().default(0),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_chunks_source_idx").on(table.sourceType, table.sourceId),
  ],
);

export type KnowledgeChunk = typeof knowledgeChunksTable.$inferSelect;
export type InsertKnowledgeChunk = typeof knowledgeChunksTable.$inferInsert;
