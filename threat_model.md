# Threat Model

## Project Overview

This project is a publicly deployed pnpm monorepo with an Express 5 API (`artifacts/api-server`) and a React + Vite frontend (`artifacts/report`). It publishes a public knowledge base and quiz about AI adoption in Hong Kong marketing, while password-protected admin and super-admin interfaces let trusted operators upload source material, trigger AI-assisted wiki extraction, rebuild embeddings, and manage backups.

Production scope for this scan is limited to internet-reachable frontend pages and API routes on the public deployment. Per platform assumptions, TLS is handled by the platform. Dev-only assets, local scripts, build artifacts, and non-production helper files are out of scope unless there is evidence they are reachable in production.

## Assets

- **Admin and super-admin access** — the shared admin password, super-admin password, session cookies, and `SESSION_SECRET` protect write access, destructive actions, and backup access.
- **Contributor uploads and derived knowledge** — uploaded documents, extracted raw text, wiki pages, quiz content, embeddings, and related metadata represent the app's primary business data. Some of this content is intentionally public only after curation.
- **Uploader identity data** — contributor names and work email addresses are sensitive operational data that should remain limited to authorized operators.
- **Backups and object storage contents** — database backups, uploaded files, and generated wiki images in object storage can expose the full corpus if misrouted or leaked.
- **Application secrets and service credentials** — database credentials, Replit sidecar object-storage access, and AI integration credentials enable broad access to storage and downstream services.

## Trust Boundaries

- **Browser to API boundary** — all client input reaches the Express API over public internet routes; the browser must be treated as untrusted.
- **Public to admin/super-admin boundary** — public wiki and knowledge search are unauthenticated, while uploads, destructive actions, and backup access require server-side cookie checks.
- **API to database boundary** — the API stores uploads, wiki pages, embeddings, and backup metadata in PostgreSQL; query scoping and route design determine what becomes public.
- **API to AI integrations boundary** — uploaded and indexed content is sent to model endpoints for extraction, ranking, and answer generation; model output is untrusted until validated or sanitized.
- **API to object storage boundary** — the server writes uploads, images, and backups into object storage and generates signed download URLs via the Replit sidecar.
- **Production vs dev-only boundary** — `scripts/`, local helper assets, generated dist output, and other development-only files should generally be ignored unless a production route or build path consumes them.

## Scan Anchors

- Production entry points: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/*.ts`, `artifacts/report/src/App.tsx`.
- Highest-risk code areas: auth/session handling in `src/middlewares/auth.ts` and `src/routes/auth.ts` / `src/routes/super-auth.ts`; public knowledge and wiki search in `src/routes/knowledge.ts` and `src/routes/wiki.ts`; upload and extraction pipeline in `src/routes/uploads.ts`, `src/lib/doc-extractor.ts`, `src/lib/ai-service.ts`, and `src/lib/gcsClient.ts`.
- Public surfaces: `/api/wiki*`, `/api/knowledge/*`, `/api/auth/me`, `/api/super-auth/me`, and public frontend routes `/`, `/wiki/:slug`, `/quiz`.
- Authenticated surfaces: `/api/uploads` (POST, status), super-admin `/api/uploads` reads/deletes, `/api/admin/*`, `/api/super-admin/backup/*`, `/api/wiki/backfill-images`, `/api/knowledge/reindex`, `/api/knowledge/regen-questions`.
- Usually dev-only / lower-priority: `scripts/`, generated `dist/`, local `attached_assets/`, and root metadata files unless explicitly consumed by production paths.

## Threat Categories

### Spoofing

The application relies on shared-password admin and super-admin logins that mint bearer-style encrypted cookies. Public login endpoints must resist brute-force guessing, and every privileged API route must continue enforcing role checks server-side rather than relying on frontend redirects.

### Tampering

Admins can upload arbitrary files and text that feed document extraction, wiki generation, and object storage writes. The server must ensure uploaded content cannot tamper with stored records, cause unauthorized file/path access, or coerce the system into fetching or serving unintended resources.

### Information Disclosure

The public wiki and knowledge-search surfaces must expose only content intended for public consumption. Raw uploads, uploader metadata, backup artifacts, signed object URLs, secrets, stack traces, and internal-only source material must never become queryable or downloadable by unauthenticated users.

### Denial of Service

Public search and login routes can trigger database, embedding, or model work. These endpoints must bound request size and frequency so unauthenticated attackers cannot cheaply exhaust model quotas, CPU, or database capacity.

### Elevation of Privilege

Super-admin routes perform destructive operations and provide access to backups and all uploads. The API must prevent privilege escalation from public or basic admin surfaces, and untrusted model output or user-controlled content must not become a code-execution or stored-script vector in privileged browsers.
