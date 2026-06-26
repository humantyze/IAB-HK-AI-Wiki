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
  `Xenova/multilingual-e5-small` (384 dims), mean-pooled + normalized. No API
  key, self-contained, loads lazily + cached. **Multilingual** so EN + Chinese
  queries hit the same English corpus (proven: ZH queries retrieve EN pages).
- **e5 prefixes are mandatory:** passages stored as `passage: …`, queries as
  `query: …` (handled inside `embedPassages`/`embedQuery`). Omitting them tanks
  recall. Swapping the embedding model requires a FULL reindex — vectors from
  different models are not comparable (same 384-dim column, incompatible space).
- **Why:** keeps retrieval free and key-less; chat/answer synthesis still uses
  the OpenAI integration.

## Hybrid retrieval + cross-encoder reranker
- `retrieve()` fuses dense vector search with Postgres full-text keyword search
  via Reciprocal Rank Fusion (RRF, k=60), then reranks the fused top-K with a
  cross-encoder (`Xenova/bge-reranker-base`, q8, sigmoid → 0-1 score) and drops
  anything below ~0.25. `similarity` on results now holds the reranker score.
- Keyword score is computed INLINE: `to_tsvector('simple', title||' '||content)`
  + `ts_rank_cd` at query time — **no tsvector column, no migration**. Corpus is
  tiny (~70 chunks) so the seq-scan cost is negligible. This was a deliberate
  data-safety choice (additive-only, schema untouched). `'simple'` config means
  Chinese keyword matching is weak — multilingual recall comes from the vector
  side, not FTS.
- Reranker is best-effort: on load/run failure it falls back to RRF order. Pass
  `{ rerank: false }` when an LLM ranks afterwards (e.g. wiki pre-filter) to
  skip the latency.
- Both embedding + reranker models are pre-warmed at startup in `index.ts`.

## Upload status gating (search must not show in-flight/failed uploads)
- Only uploads with status `processed` or `partial` are eligible. `retrieve()`
  LEFT JOINs `uploads` and filters `sourceType<>'upload' OR status IN (...)`, so
  status changes take effect at query time without reindexing. `reindexAll` also
  filters uploads by status, and a run that ends `failed` calls
  `removeSource('upload', id)`.

## retrieve() limit vs rerankTopK
- `rerankTopK` (default 16) caps ONLY the rerank candidate slice. With
  `rerank:false`, results are capped by `limit` against the full fused pool
  (`candidatePool`=40 each side → up to 80 unique). Callers like the wiki
  pre-filter (`limit:24, rerank:false`) depend on this — don't reintroduce a
  blanket `rerankTopK` truncation before the final `slice(0, limit)`.

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
