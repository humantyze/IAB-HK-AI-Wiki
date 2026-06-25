---
name: Startup migration anti-pattern
description: Why Drizzle migrate() must not run at server startup in this project, and what to use instead.
---

# Startup Migration Anti-Pattern

## Rule
Do NOT call `drizzle-orm/node-postgres/migrator`'s `migrate()` at server startup (`index.ts` or any entry point).

**Why:** This project deploys to Cloud Run (autoscale). During a rolling deploy, existing instances are still serving traffic with open DB connections when new instances start. Running `ALTER TABLE` / `CREATE TABLE` DDL at startup waits indefinitely for row/table locks held by those live connections. The health check times out (60 s) before the server ever opens its port, the deploy fails, and no app-level logs are emitted (pino never gets to write anything).

**How to apply:** Schema changes go through Replit's Publish flow instead:
1. Update the schema in `lib/db/src/schema/`.
2. Run `pnpm --filter @workspace/db run push-force` to apply to the dev database.
3. Verify the feature works in dev.
4. Ask the user to re-publish — Replit diffs dev vs prod and applies the SQL before any new instances start (no lock conflicts).

For Drizzle migration files (`lib/db/drizzle/`): keep them consistent with the schema but do not run them via `migrate()` at startup.
