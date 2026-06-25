import { logger } from "./logger";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384;

type FeatureExtractor = (
  input: string | string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

async function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Allow remote model download (HF hub) and cache locally between runs.
      env.allowRemoteModels = true;
      logger.info({ model: MODEL_ID }, "Loading local embedding model");
      const pipe = (await pipeline("feature-extraction", MODEL_ID)) as unknown as FeatureExtractor;
      logger.info({ model: MODEL_ID }, "Embedding model ready");
      return pipe;
    })().catch((err) => {
      extractorPromise = null;
      throw err;
    });
  }
  return extractorPromise;
}

/** Embed a single piece of text into a normalized 384-dim vector. */
export async function embed(text: string): Promise<number[]> {
  const [vec] = await embedBatch([text]);
  return vec;
}

/** Embed many texts. Returns one normalized vector per input. */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const cleaned = texts.map((t) => t.replace(/\s+/g, " ").trim() || " ");
  const output = await extractor(cleaned, { pooling: "mean", normalize: true });
  return output.tolist();
}

/**
 * Split markdown/plain text into overlapping chunks suitable for embedding.
 * Chunks target ~roughly 1200 characters with ~150 char overlap, split on
 * paragraph boundaries where possible.
 */
export function chunkText(text: string, targetChars = 1200, overlapChars = 150): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= targetChars) return [normalized];

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
  };

  for (const para of paragraphs) {
    // A single oversized paragraph: hard-split it.
    if (para.length > targetChars) {
      pushCurrent();
      current = "";
      for (let i = 0; i < para.length; i += targetChars - overlapChars) {
        chunks.push(para.slice(i, i + targetChars).trim());
      }
      continue;
    }

    if (current.length + para.length + 2 > targetChars && current.length > 0) {
      pushCurrent();
      // carry a small overlap from the tail of the previous chunk for context
      const tail = current.slice(-overlapChars);
      current = `${tail}\n\n${para}`;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  pushCurrent();

  return chunks.filter((c) => c.length > 0);
}
