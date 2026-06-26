import { logger } from "./logger";

// Multilingual model so English + Chinese/Cantonese content embed into the same
// space. multilingual-e5-small is 384-dim (same as the previous MiniLM model),
// so the existing pgvector column stays compatible — but every stored vector
// must be regenerated because vectors from different models are not comparable.
const MODEL_ID = "Xenova/multilingual-e5-small";
export const EMBEDDING_DIM = 384;

// e5 models are trained with instruction prefixes and REQUIRE them at inference:
// passages are stored with "passage: " and search queries with "query: ".
// Omitting these significantly degrades retrieval quality.
const QUERY_PREFIX = "query: ";
const PASSAGE_PREFIX = "passage: ";

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

async function embedRaw(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const cleaned = texts.map((t) => t.replace(/\s+/g, " ").trim() || " ");
  const output = await extractor(cleaned, { pooling: "mean", normalize: true });
  return output.tolist();
}

/** Embed a search query into a normalized 384-dim vector (e5 "query:" prefix). */
export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedRaw([`${QUERY_PREFIX}${text}`]);
  return vec;
}

/** Embed many passages for storage. Returns one normalized vector per input. */
export async function embedPassages(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  return embedRaw(texts.map((t) => `${PASSAGE_PREFIX}${t}`));
}

type Block = { type: "heading" | "table" | "para"; text: string };

/** Break markdown into ordered semantic blocks: headings, tables, paragraphs. */
function splitIntoBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    const t = para.join("\n").trim();
    if (t) blocks.push({ type: "para", text: t });
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushPara();
      i++;
      continue;
    }

    // Markdown heading — its own block; becomes context for following content.
    if (/^#{1,6}\s/.test(trimmed)) {
      flushPara();
      blocks.push({ type: "heading", text: trimmed });
      i++;
      continue;
    }

    // Table — keep all consecutive pipe rows together so rows aren't cut.
    if (trimmed.startsWith("|")) {
      flushPara();
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "table", text: tableLines.join("\n").trim() });
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}

/** Hard-split an oversized plain block on character boundaries with overlap. */
function hardSplit(text: string, targetChars: number, overlapChars: number): string[] {
  const out: string[] = [];
  const step = Math.max(1, targetChars - overlapChars);
  for (let i = 0; i < text.length; i += step) {
    const part = text.slice(i, i + targetChars).trim();
    if (part) out.push(part);
  }
  return out;
}

/** Split an oversized table by rows, repeating the header on every part. */
function splitTable(table: string, targetChars: number): string[] {
  const rows = table.split("\n");
  if (rows.length <= 2) return [table];
  const header = rows.slice(0, 2).join("\n"); // header row + separator row
  const bodyRows = rows.slice(2);
  const parts: string[] = [];
  let current = header;
  for (const row of bodyRows) {
    if (`${current}\n${row}`.length > targetChars && current !== header) {
      parts.push(current);
      current = `${header}\n${row}`;
    } else {
      current = `${current}\n${row}`;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * Split markdown/plain text into chunks suitable for embedding, respecting
 * document structure: paragraphs, markdown headings, and tables. Headings carry
 * forward as context for the chunks beneath them, and tables are never cut
 * mid-row, so chart captions and table rows keep their meaning. Chunks target
 * ~1200 characters with ~150 char overlap.
 */
export function chunkText(text: string, targetChars = 1200, overlapChars = 150): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= targetChars) return [normalized];

  const blocks = splitIntoBlocks(normalized);
  if (blocks.length === 0) return [];

  const chunks: string[] = [];
  let current = "";
  let currentHeading = "";

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
  };

  for (const block of blocks) {
    if (block.type === "heading") {
      currentHeading = block.text;
    }
    const piece = block.text;

    // A single block bigger than the target: flush, then hard-split it,
    // keeping the section heading on each resulting part for context.
    if (piece.length > targetChars) {
      pushCurrent();
      current = "";
      const parts = block.type === "table"
        ? splitTable(piece, targetChars)
        : hardSplit(piece, targetChars, overlapChars);
      for (const part of parts) {
        const needsHeading = currentHeading && block.type !== "heading" && !part.startsWith("#");
        chunks.push((needsHeading ? `${currentHeading}\n\n${part}` : part).trim());
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length > targetChars && current.length > 0) {
      pushCurrent();
      // Start a new chunk: re-establish heading context plus a small overlap
      // tail from the previous chunk so the boundary keeps continuity.
      const tail = current.slice(-overlapChars).trim();
      const headerPrefix = currentHeading && !piece.startsWith("#") ? `${currentHeading}\n\n` : "";
      const overlapPrefix = tail && headerPrefix === "" ? `${tail}\n\n` : "";
      current = `${headerPrefix}${overlapPrefix}${piece}`;
    } else {
      current = candidate;
    }
  }
  pushCurrent();

  return chunks.filter((c) => c.length > 0);
}
