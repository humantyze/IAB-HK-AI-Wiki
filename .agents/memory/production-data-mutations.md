---
name: Production data mutations
description: How to change data in the deployed production app for this project (and the read-only constraint that forces it).
---

# Production data mutations

The production Postgres DB is **read-only** through `executeSql({environment:"production"})`.
You can query prod to diagnose, but you cannot INSERT/UPDATE/DELETE that way.

**Rule:** The only way to mutate production data is through the **deployed app's API**.
So any destructive prod change must follow this flow:
1. Build + test the mutating endpoint on dev.
2. Get the user to **publish** (the new endpoint is not live until the deployed build includes it).
3. Authenticate to the production API and call the endpoint.
4. Verify with a read-only prod query.

**Why:** Replit's prod DB access for the agent is intentionally read-only; mutations must go
through the running deployed service so they respect the app's auth and business logic.

**How to apply:** For this project, super-admin endpoints authenticate via the
`SUPER_ADMIN_PASSWORD` secret -> `POST /api/super-auth/login` (sets an AES-256-GCM cookie),
then call the protected route (e.g. `DELETE /api/admin/sections/:id`, `POST /api/wiki/seed`).
Production URL comes from `getDeploymentInfo().primaryUrl`, never from `$REPLIT_DOMAINS`
(that is the dev domain). Wiki pages are independent of sections — after deleting sections,
rebuild the wiki so pages sourced from them are dropped.
