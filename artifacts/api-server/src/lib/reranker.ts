import { logger } from "./logger";

// Multilingual cross-encoder reranker. Scores each (query, passage) pair so the
// most relevant candidates rise to the top, giving a calibrated relevance signal
// instead of relying on a raw cosine-similarity cutoff. Loads locally on CPU via
// Transformers.js (same runtime as embeddings) — no API key, cached after first
// load. Quantized (q8) to keep per-pair scoring fast enough for interactive use.
const RERANKER_MODEL = "Xenova/bge-reranker-base";

interface RerankerPipeline {
  tokenizer: (
    texts: string[],
    opts: { text_pair: string[]; padding: boolean; truncation: boolean },
  ) => unknown;
  model: (inputs: unknown) => Promise<{ logits: { sigmoid: () => { tolist: () => number[][] } } }>;
}

let rerankerPromise: Promise<RerankerPipeline> | null = null;

async function getReranker(): Promise<RerankerPipeline> {
  if (!rerankerPromise) {
    rerankerPromise = (async () => {
      const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import("@huggingface/transformers");
      env.allowRemoteModels = true;
      logger.info({ model: RERANKER_MODEL }, "Loading local reranker model");
      const tokenizer = (await AutoTokenizer.from_pretrained(RERANKER_MODEL)) as unknown as RerankerPipeline["tokenizer"];
      const model = (await AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL, {
        dtype: "q8",
      })) as unknown as RerankerPipeline["model"];
      logger.info({ model: RERANKER_MODEL }, "Reranker model ready");
      return { tokenizer, model };
    })().catch((err) => {
      rerankerPromise = null;
      throw err;
    });
  }
  return rerankerPromise;
}

/**
 * Score each passage's relevance to the query. Returns one score per passage in
 * [0, 1] (higher = more relevant), aligned to the input order.
 */
export async function rerank(query: string, passages: string[]): Promise<number[]> {
  if (passages.length === 0) return [];
  const { tokenizer, model } = await getReranker();
  const inputs = tokenizer(new Array(passages.length).fill(query), {
    text_pair: passages,
    padding: true,
    truncation: true,
  });
  const output = await model(inputs);
  const scores = output.logits.sigmoid().tolist();
  return scores.map((row) => row[0]);
}
