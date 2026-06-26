-- Migration: add processing_errors column to uploads table
-- Applied via drizzle-kit push on 2026-06-26

ALTER TABLE "uploads" ADD COLUMN IF NOT EXISTS "processing_errors" jsonb;
