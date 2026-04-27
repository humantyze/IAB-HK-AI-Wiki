import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const wikiPagesTable = pgTable("wiki_pages", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  bodyMarkdown: text("body_markdown").notNull().default(""),
  tags: jsonb("tags").notNull().$type<string[]>().default([]),
  relatedSlugs: jsonb("related_slugs").notNull().$type<string[]>().default([]),
  sources: jsonb("sources").notNull().$type<Array<{ label: string; ref: string }>>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WikiPage = typeof wikiPagesTable.$inferSelect;
export type InsertWikiPage = typeof wikiPagesTable.$inferInsert;
