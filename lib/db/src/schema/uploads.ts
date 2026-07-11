import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface ProcessingError {
  step: string;
  message: string;
  ts: string;
}

export const uploadsTable = pgTable("uploads", {
  id: serial("id").primaryKey(),
  uploaderName: text("uploader_name"),
  uploaderEmail: text("uploader_email"),
  contributorName: text("contributor_name"),
  contentType: text("content_type").notNull(),
  targetSections: jsonb("target_sections").notNull().$type<string[]>().default([]),
  rawText: text("raw_text").notNull(),
  filePath: text("file_path"),
  contentHash: text("content_hash"),
  status: text("status").notNull().default("pending"),
  processingErrors: jsonb("processing_errors").$type<ProcessingError[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
});

export const insertUploadSchema = createInsertSchema(uploadsTable).omit({ id: true });
export type InsertUpload = z.infer<typeof insertUploadSchema>;
export type Upload = typeof uploadsTable.$inferSelect;
