import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const uploadsTable = pgTable("uploads", {
  id: serial("id").primaryKey(),
  contributorName: text("contributor_name"),
  contentType: text("content_type").notNull(),
  targetSections: jsonb("target_sections").notNull().$type<string[]>().default([]),
  rawText: text("raw_text").notNull(),
  filePath: text("file_path"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
});

export const insertUploadSchema = createInsertSchema(uploadsTable).omit({ id: true });
export type InsertUpload = z.infer<typeof insertUploadSchema>;
export type Upload = typeof uploadsTable.$inferSelect;
