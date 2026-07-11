---
name: pgvector + Jina AI embeddings
description: How semantic RAG works in this repo — switched from local Transformers.js to Jina AI API (July 2026).
---

# Semantic RAG / pgvector in this project

## Current setup (Jina AI, July 2026)

- **Embeddings**: Jina AI API (`jina-embeddings-v3`, 1024-dim) via OpenAI SDK at `https://api.jina.ai/v1/`. Key: `JINA_API_KEY` secret.
- **Reranker**: Removed — replaced with RRF fusion + cosine similarity floor (≥0.3)
- **Schema**: `knowledge_chunks.embedding` is `vector(1024)`, no HNSW index (sequential scan)
- **INDEX_VERSION**: `"jina-embeddings-v3-1024d-v1"` — bump whenever model or chunking strategy changes
- Corpus: ~73 chunks (12 wiki pages + 1 upload)

## Embedding/chunking version → forced one-time reindex

Bump `INDEX_VERSION` in `knowledge-index.ts`; `ensureIndexUpToDate()` (run at startup) compares it against a `knowledge_index_meta` row and rebuilds the whole index ONCE.

## Workflow after schema changes

1. Edit `lib/db/src/schema/knowledgeChunks.ts`
2. `pnpm --filter @workspace/db exec tsc --build`
3. `cd lib/db && pnpm run push-force`
4. Rebuild + restart api-server

## Upload status gating (search must not show in-flight/failed uploads)

Only `processed`/`partial` uploads are eligible. Enforce at both layers: index lifecycle AND query time.

## pgvector extension

`CREATE EXTENSION IF NOT EXISTS vector;` must be run manually before `push-force` on a fresh DB.

## Composite db build gotcha

`lib/db` is a TS composite project — after any schema change, always rebuild declarations (`pnpm --filter @workspace/db exec tsc --build`) or api-server typecheck will fail with `has no exported member`.

## Previous setup (removed July 2026)

Used `@huggingface/transformers` + `onnxruntime-node` + cross-encoder reranker locally. All removed to free ~600 MB RAM. Had a native-dep packaging requirement: externalized modules needed to be DIRECT deps of api-server.
