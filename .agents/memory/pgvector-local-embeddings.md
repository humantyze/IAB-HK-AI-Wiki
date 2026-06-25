---
name: pgvector + local embeddings RAG
description: How vector retrieval over the corpus is built in the api-server (embeddings provider, native-dep packaging, composite db build gotcha).
---

# Semantic RAG / pgvector in this project

The api-server has a vector knowledge index (`knowledge_chunks` table, 384-dim
cosine HNSW) covering sections + wiki pages + uploads, with `/api/knowledge/search`
(corpus RAG) and `/api/knowledge/reindex` (super-auth), plus a vector pre-filter
on `/api/wiki/search`.

## Embeddings provider = LOCAL, on purpose
- Neither the Replit OpenAI integration NOR the Gemini integration exposes an
  embeddings endpoint. Do NOT try to call `/embeddings` through
  `AI_INTEGRATIONS_OPENAI_BASE_URL` — it isn't there.
- We use `@huggingface/transformers` (Transformers.js) with model
  `Xenova/all-MiniLM-L6-v2` (384 dims), mean-pooled + normalized. No API key,
  self-contained. Model loads lazily on first embed (~3s) and is cached.
- **Why:** keeps retrieval free and key-less; chat/answer synthesis still uses
  the OpenAI integration (gpt-4o-mini).

## Native-dep packaging gotcha (caused a startup crash)
- `build.mjs` externalizes `onnxruntime-node`, `sharp`, `protobufjs`, `*.node`.
  Externalized bare imports are resolved from the api-server package's own
  `node_modules` at runtime.
- Transformers pulls these in only as TRANSITIVE deps (nested), so the bundle's
  `import "onnxruntime-node"` throws `ERR_MODULE_NOT_FOUND` at startup.
- **Fix / rule:** any externalized native module that transformers needs must be
  added as a DIRECT dependency of `@workspace/api-server` so pnpm links it at the
  package's top level. Currently: `onnxruntime-node`, `sharp`, `protobufjs`.
- Also add those to `onlyBuiltDependencies` in `pnpm-workspace.yaml` and reinstall
  so their native build/install scripts actually run (otherwise the `.node` binary
  is missing).

## pgvector extension
- `CREATE EXTENSION IF NOT EXISTS vector;` must be run manually (drizzle-kit push
  does NOT create it). Run it before `pnpm --filter @workspace/db run push-force`.

## Composite db build gotcha
- `lib/db` is a TS composite project; `artifacts/api-server` typechecks against
  `lib/db/dist/*.d.ts`, NOT the source. After adding/changing a schema file you
  must rebuild declarations (`npx tsc -b lib/db`) or api-server typecheck reports
  `has no exported member` for the new table even though dev/runtime (esbuild
  bundles from source) works fine.
- Pre-existing baseline: `artifacts/api-server` typecheck already fails on
  `parseInt(req.params.id)` (`string | string[]`) in uploads.ts — unrelated to
  this feature; dev uses esbuild (no typecheck) so the app runs regardless.
