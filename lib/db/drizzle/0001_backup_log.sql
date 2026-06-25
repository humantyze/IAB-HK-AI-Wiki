CREATE TABLE IF NOT EXISTS "backup_log" (
"id" serial PRIMARY KEY NOT NULL,
"created_at" timestamp DEFAULT now() NOT NULL,
"backed_up_at" timestamp NOT NULL,
"drive_file_id" text,
"file_name" text NOT NULL
);
