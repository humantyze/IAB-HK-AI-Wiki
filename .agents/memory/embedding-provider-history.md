---
name: Embedding provider history
description: Which embedding providers were tried and why Jina AI was chosen for this repo.
---

# Embedding Provider History

**Settled on**: Jina AI — `jina-embeddings-v3`, 1024 dimensions, `JINA_API_KEY` secret.

## Providers that don't work here

- **Replit AI proxy** — explicitly blocks `/embeddings` endpoint (returns 400 INVALID_ENDPOINT)
- **OpenRouter proxy** — embeddings explicitly unsupported
- **Zhipu AI** (`ZHIPU_API_KEY`) — key only grants chat models (glm-4.5 through glm-5.2); embedding models (embedding-2, embedding-3) return error 1211 "model does not exist" — separate subscription required
- **DeepSeek** — no embeddings API

## Why Jina AI

Free tier: 1M tokens/month. OpenAI-SDK-compatible (`baseURL: "https://api.jina.ai/v1/"`). 1024-dim fits HNSW index limit (max 2000).

## Schema notes

- `EMBEDDING_DIMENSIONS = 1024` in `lib/db/src/schema/knowledgeChunks.ts`
- `INDEX_VERSION = "jina-embeddings-v3-1024d-v1"` in `knowledge-index.ts`
- After any dimension change: truncate `knowledge_chunks`, rebuild db lib (`pnpm --filter @workspace/db exec tsc --build`), then `push-force`
