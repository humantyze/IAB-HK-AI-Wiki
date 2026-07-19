---
name: Text vs vision AI provider split
description: Text AI runs on DeepSeek via Replit OpenRouter integration; vision must stay on the OpenAI integration.
---

All text-only LLM calls in the API server go through `getTextAIConfig()` (shared helper), which prefers the Replit OpenRouter AI integration (`AI_INTEGRATIONS_OPENROUTER_*` env vars) with model `deepseek/deepseek-v4-pro`, and falls back to the OpenAI integration with the caller's previous GPT model if OpenRouter env vars are missing.

**Why:** The Replit OpenRouter proxy supports chat completions ONLY — no embeddings, no guaranteed vision. Vision calls (`image_url` content: PDF page analysis, image uploads) must remain on the OpenAI integration. Embeddings remain on Jina AI.

**How to apply:** When adding a new AI call, use `getTextAIConfig()` for text; use the OpenAI env vars directly only for vision. Never guess OpenRouter model IDs — list them via `curl -s https://openrouter.ai/api/v1/models | grep deepseek`. DeepSeek works with both non-streaming + `response_format: json_object` and SSE streaming through the proxy (verified live). Keep max token caps at 8192 per OpenRouter skill guidance.
