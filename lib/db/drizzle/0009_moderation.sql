ALTER TABLE "uploads" ADD COLUMN IF NOT EXISTS "moderation_status" text NOT NULL DEFAULT 'clear';
ALTER TABLE "uploads" ADD COLUMN IF NOT EXISTS "moderation_reason" text;
