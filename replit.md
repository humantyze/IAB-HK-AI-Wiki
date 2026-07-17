# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM + pgvector
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (ESM bundle via `build.mjs`)
- **Frontend**: React 19 + Vite 7, wouter routing, Framer Motion, Tailwind CSS v4

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   └── report/             # React + Vite frontend
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck` (`tsc --build --emitDeclarationOnly`).
- **`emitDeclarationOnly`** — only `.d.ts` files emitted; actual JS bundling handled by esbuild/vite.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array.

## Root Scripts

- `pnpm run build` — typecheck then recursively build all packages
- `pnpm run typecheck` — `tsc --build --emitDeclarationOnly`

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes in `src/routes/`, AI logic in `src/lib/`.

- Entry: `src/index.ts` — reads `PORT`, runs startup migrations, starts Express
- App setup: `src/app.ts` — CORS, JSON/multipart parsing, routes at `/api`
- Build: esbuild ESM bundle via `build.mjs` → `dist/index.mjs`
- Depends on: `@workspace/db`

### `lib/db` (`@workspace/db`)

Drizzle ORM + PostgreSQL. Exports `db`, `pool`, and all schema tables.

- `src/schema/uploads.ts` — contributor uploads
- `src/schema/wikiPages.ts` — AI-generated wiki pages
- `src/schema/knowledgeChunks.ts` — embedding chunks for semantic search
- `src/schema/knowledgeIndexMeta.ts` — index version tracking
- `drizzle.config.ts` — requires `DATABASE_URL` (auto-provided by Replit)
- Migrations in `drizzle/` — applied automatically by Replit on publish

In development: `pnpm --filter @workspace/db run push` (or `push-force`).
**Never run `drizzle-kit push` in production** — it will try to drop `knowledge_index_meta`.

### `artifacts/report` (`@workspace/report`)

React + Vite frontend. Dark-mode editorial UI with neon accents.

- Routes: `/` (knowledge base), `/wiki/:slug` (wiki page), `/admin/login`, `/admin` (contributor portal), `/super-admin/login`, `/super-admin`
- Custom hooks: `useAuth`, `useUploads`, `useSubmitUpload`, `useWikiPage`
- Key pages: `WikiIndex.tsx` (knowledge base + filters), `AdminDashboard.tsx` (two-column: form + history), `SuperAdminDashboard.tsx`

### `scripts` (`@workspace/scripts`)

Utility scripts. Run via `pnpm --filter @workspace/scripts run <script>`.

---

## Application: HK AI Marketing Playbook

A living wiki knowledge base for IAB Hong Kong's AI & Tech Committee. Contributors upload source material; the AI automatically extracts and maintains wiki pages.

### Database Schema

| Table | Purpose |
|---|---|
| `uploads` | Contributor submissions (name, email, content type, file path, status, errors, `responsible_ai` flag) |
| `wiki_pages` | AI-generated wiki pages (slug, title, tags, sources[], body_segments jsonb, excerpt, `responsible_ai` flag) |
| `knowledge_chunks` | Embedding chunks for semantic RAG search (content, embedding vector 1024-dim, source ref) |
| `knowledge_index_meta` | Tracks current embedding model version for reindex detection |

### Responsible AI Flag

- Both `uploads` and `wiki_pages` have a `responsible_ai boolean NOT NULL DEFAULT false` column.
- Contributors check a "Responsible AI" checkbox in the upload form; the flag flows from upload → all wiki pages extracted from that upload.
- On wiki page update, the flag is OR-merged: once `true`, it stays `true` even if a later upload is unflagged.
- A startup migration in `src/index.ts` back-fills all wiki pages created before 2026-07-18 to `responsible_ai = true`.
- The knowledge base has a "Responsible AI" filter button (light blue) positioned right after "All".

### Auth

- Admin area (`/admin`): password-protected via `ADMIN_PASSWORD` env var
- Super-admin area (`/super-admin`): separate `SUPER_ADMIN_PASSWORD`
- Session tokens: cryptographically random, HMAC-SHA256 signed with `SESSION_SECRET`
- httpOnly cookies, sameSite=lax, secure in production
- File uploads: multer, accepts PDF/TXT/CSV/DOCX/XLSX, 10 MB limit

### API Routes

**Public:**
- `GET /api/wiki` — list all wiki page summaries (id, slug, title, tags, excerpt, responsibleAi, …)
- `GET /api/wiki/:slug` — full wiki page (body markdown, sources, related slugs)
- `GET /api/knowledge/search?q=` — hybrid RAG search (semantic + keyword)
- `GET /api/knowledge/questions` — AI-generated sample questions

**Auth required:**
- `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/me`
- `GET /api/uploads` — list uploads for current session
- `POST /api/uploads` — submit content (multipart: name, email, contentType, rawText, file, responsibleAi)
- `GET /api/uploads/:id/status` — poll processing status

**Super-admin:**
- `GET /api/wiki` (admin view with all fields), `DELETE /api/wiki/:slug`
- `GET /api/uploads` (all uploads), `POST /api/regress/:uploadId`
- `POST /api/backup`, `GET /api/backup`

**MCP:**
- `POST /api/mcp` — Streamable HTTP MCP endpoint (no auth)

### AI Service (`src/lib/ai-service.ts`)

- `extractWikiPages(text, sourceLabel, sourceRef, responsibleAi)` — uses GPT (via Replit AI proxy, stream mode required) to extract structured wiki pages from uploaded content
- Pages are upserted by slug; body is stored as per-source segments (idempotent, supports deletion)
- On upsert, `responsible_ai` is OR-merged so the flag is monotonically promoted

### Semantic Search (`src/lib/knowledge-index.ts`)

- Embeddings: **Jina AI** (`jina-embeddings-v3`, 1024-dim) via `JINA_API_KEY`
- Stored in `knowledge_chunks` using `pgvector` (`embedding vector(1024)`)
- Index versioned via `knowledge_index_meta`; version bump triggers full reindex on next startup
- Hybrid search: cosine similarity (vector) + keyword fallback

### MCP Server

Endpoint: `POST /api/mcp` (Streamable HTTP, stateless, no auth)

| Tool | Description |
|---|---|
| `search_knowledge(query)` | Hybrid RAG search — returns top-6 passages with titles |
| `list_wiki_pages()` | All wiki slugs and titles |
| `get_wiki_page(slug)` | Full markdown + tags for one page |
| `get_sample_questions()` | AI-generated question list |

**Claude Desktop config:**
```json
{
  "mcpServers": {
    "hk-ai-playbook": {
      "url": "https://<your-deployed-app>.replit.app/api/mcp"
    }
  }
}
```

### OpenAI / Replit AI Proxy

- Uses Replit AI Integrations proxy (`AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`)
- **Stream mode is required** — `gpt-5`/`gpt-5-mini` return empty content unless `stream: true`

---

## User Preferences

- Keep cards/layout changes consistent with the two-column admin dashboard pattern (form left, history right).
