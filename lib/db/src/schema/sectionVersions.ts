import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sectionsTable } from "./sections";

export const sectionVersionsTable = pgTable("section_versions", {
  id: serial("id").primaryKey(),
  sectionId: integer("section_id").notNull().references(() => sectionsTable.id),
  bodyMarkdown: text("body_markdown").notNull(),
  keyInsights: jsonb("key_insights").notNull().$type<string[]>().default([]),
  chartData: jsonb("chart_data").$type<ChartDataPoint[]>().default([]),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdByUploadId: integer("created_by_upload_id"),
});

export interface ChartDataPoint {
  label: string;
  value: number;
  unit: string;
}

export const insertSectionVersionSchema = createInsertSchema(sectionVersionsTable).omit({ id: true });
export type InsertSectionVersion = z.infer<typeof insertSectionVersionSchema>;
export type SectionVersion = typeof sectionVersionsTable.$inferSelect;
