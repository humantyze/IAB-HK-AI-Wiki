CREATE TABLE IF NOT EXISTS "sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"current_version_id" integer,
	CONSTRAINT "sections_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "section_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"section_id" integer NOT NULL,
	"body_markdown" text NOT NULL,
	"key_insights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chart_data" jsonb DEFAULT '[]'::jsonb,
	"image_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by_upload_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"uploader_name" text,
	"contributor_name" text,
	"content_type" text NOT NULL,
	"target_sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_text" text NOT NULL,
	"file_path" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wiki_pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body_markdown" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related_slugs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_pages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "section_versions" ADD CONSTRAINT "section_versions_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
