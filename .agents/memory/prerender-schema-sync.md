---
name: Prerender script schema sync
description: prerender.mjs runs at build time against the DB — it must stay in sync with the live schema or the production build fails.
---

## Rule
`artifacts/report/scripts/prerender.mjs` connects to Postgres at build time (part of the `vite build && node scripts/prerender.mjs` build command). Any table it queries must exist in both dev and prod databases.

**Why:** The `sections` and `section_versions` tables were removed (Task #51), but `prerender.mjs` still tried to `SELECT` from them. The production build failed with `relation "sections" does not exist`.

**How to apply:** Whenever a DB migration drops or renames a table, grep `scripts/prerender.mjs` for references to that table and remove or update them before publishing.
