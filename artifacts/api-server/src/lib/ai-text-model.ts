/**
 * Text-model configuration for all non-vision AI calls.
 *
 * Text calls (extraction, ranking, RAG answers, moderation, quiz/question
 * generation) run on DeepSeek via the Replit OpenRouter AI integration.
 * Vision calls (image_url content) stay on the OpenAI integration — the
 * OpenRouter proxy only guarantees chat completions.
 *
 * Falls back to the OpenAI integration (with the caller's previous GPT model)
 * when the OpenRouter env vars are not set, so a missing integration never
 * hard-breaks existing features.
 */

export const DEEPSEEK_MODEL = "deepseek/deepseek-v3.2";

export interface TextAIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function getTextAIConfig(fallbackOpenAIModel: string): TextAIConfig | null {
  const orBaseUrl = process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
  const orApiKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  if (orBaseUrl && orApiKey) {
    return { baseUrl: orBaseUrl, apiKey: orApiKey, model: DEEPSEEK_MODEL };
  }

  const oaBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const oaApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (oaBaseUrl && oaApiKey) {
    return { baseUrl: oaBaseUrl, apiKey: oaApiKey, model: fallbackOpenAIModel };
  }

  return null;
}
