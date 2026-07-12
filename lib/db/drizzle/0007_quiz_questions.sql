CREATE TABLE IF NOT EXISTS "quiz_questions" (
  "id" serial PRIMARY KEY NOT NULL,
  "entries" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "generated_at" timestamp NOT NULL DEFAULT now()
);
