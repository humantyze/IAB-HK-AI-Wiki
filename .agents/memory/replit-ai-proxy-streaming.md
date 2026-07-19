---
name: Replit AI proxy requires streaming
description: gpt-5-mini and gpt-5 via the Replit AI Integrations proxy return empty content unless stream:true is set.
---

The Replit AI Integrations proxy (`AI_INTEGRATIONS_OPENAI_BASE_URL`) silently returns
empty `choices[0].message.content` for non-streaming completions.

**Why:** The proxy is optimised for streaming; non-streaming calls succeed (200 OK, no
error, realistic latency ~7 s) but deliver empty content.

**How to apply:** Always pass `stream: true` to `client.chat.completions.create()`.
Collect all deltas into a string before parsing:

```ts
const stream = await client.chat.completions.create({ model: "gpt-5-mini", stream: true, messages });
let text = "";
for await (const chunk of stream) {
  text += chunk.choices?.[0]?.delta?.content ?? "";
}
```

This applies to every model exposed by the proxy (gpt-5, gpt-5-mini, etc.).

## Unsupported parameters for gpt-5 / gpt-5-mini

These models via the proxy reject certain common OpenAI params with a 400 error — the call is caught, falls back silently, and **must not be fail-open** in critical paths:

| ❌ Rejected param | ✅ Use instead |
|---|---|
| `max_tokens` | `max_completion_tokens` |
| `temperature: 0` | omit (only default `1` is supported) |

**How to apply:** Strip `max_tokens` and `temperature` from any call to gpt-5/gpt-5-mini. Use `max_completion_tokens` if you need a cap. Do not set `temperature`.
