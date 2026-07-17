ALTER TABLE "wiki_pages" ADD COLUMN IF NOT EXISTS "responsible_ai" boolean NOT NULL DEFAULT false;
ALTER TABLE "uploads" ADD COLUMN IF NOT EXISTS "responsible_ai" boolean NOT NULL DEFAULT false;
