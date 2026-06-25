/**
 * Multi-format document and image extraction.
 * Every extractor returns { text, imageUrls } — same shape as PDF extraction —
 * so the upload handler can feed any format into the wiki/index pipeline.
 */

import { readFile, mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { getBackupBucket } from "./gcsClient";
import { logger } from "./logger";

const MIN_IMAGE_BYTES = 5 * 1024;
const MAX_IMAGES = 10;

export interface ExtractResult {
  text: string;
  imageUrls: string[];
}

// ─── DOCX ────────────────────────────────────────────────────────────────────

export async function extractDocx(filePath: string): Promise<ExtractResult> {
  const mammoth = await import("mammoth");
  const buffer = await readFile(filePath);

  const extractedImages: Buffer[] = [];

  // Use convertToHtml so that the convertImage callback is reliably invoked for
  // every embedded image in the document. extractRawText does NOT call convertImage.
  const htmlResult = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        try {
          // image.read() returns a Buffer when no encoding is passed
          const buf = (await image.read()) as unknown as Buffer;
          const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer);
          if (raw.length >= MIN_IMAGE_BYTES) {
            extractedImages.push(raw);
          }
        } catch {
          // ignore bad images
        }
        return { src: "" };
      }),
    },
  );

  // Derive plain text by stripping HTML tags from the converted output.
  const text = htmlResult.value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const imageUrls = await uploadBuffersToGcs(extractedImages, "png", "image/png");
  logger.info({ filePath, chars: text.length, images: imageUrls.length }, "DOCX extraction complete");
  return { text, imageUrls };
}

// ─── DOC (legacy binary) ─────────────────────────────────────────────────────

export async function extractDoc(filePath: string): Promise<ExtractResult> {
  // LibreOffice headless converts .doc → .docx in a temp dir, then we run mammoth.
  // Falls back to a best-effort mammoth read if soffice is not available.
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);
  const { existsSync } = await import("fs");

  const sofficeBin = ["/usr/bin/soffice", "/usr/lib/libreoffice/program/soffice"].find((p) => existsSync(p));
  if (!sofficeBin) {
    logger.warn({ filePath }, "LibreOffice not found — attempting mammoth directly on .doc (may be partial)");
    return extractDocx(filePath);
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "doc-conv-"));
  try {
    await execFileAsync(sofficeBin, ["--headless", "--convert-to", "docx", "--outdir", tmpDir, filePath], {
      timeout: 60_000,
    });
    const base = filePath.split("/").pop()!.replace(/\.doc$/i, ".docx");
    const converted = join(tmpDir, base);
    return extractDocx(converted);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

export async function extractMarkdown(filePath: string): Promise<ExtractResult> {
  const raw = await readFile(filePath, "utf8");

  // Pull out image URLs from ![alt](url) syntax before stripping
  // Only https:// URLs are collected; http is excluded to reduce risk.
  const imgRegex = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  const remoteImageUrls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(raw)) !== null) {
    const url = match[1];
    if (url.startsWith("https://")) {
      remoteImageUrls.push(url);
    }
  }

  // Strip markdown syntax to plain text
  const text = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")   // remove image tags
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // link text only
    .replace(/^#{1,6}\s+/gm, "")             // headings
    .replace(/(\*\*|__)(.*?)\1/g, "$2")      // bold
    .replace(/(\*|_)(.*?)\1/g, "$2")         // italic
    .replace(/`{3}[\s\S]*?`{3}/g, "")        // fenced code blocks
    .replace(/`[^`]+`/g, "")                 // inline code
    .replace(/^\s*[-*+]\s+/gm, "")           // unordered lists
    .replace(/^\s*\d+\.\s+/gm, "")           // ordered lists
    .replace(/^\s*>\s+/gm, "")               // blockquotes
    .replace(/---+/g, "")                     // horizontal rules
    .replace(/\n{3,}/g, "\n\n")              // collapse blank lines
    .trim();

  // Fetch remote images and upload to GCS (best-effort, limit to MAX_IMAGES).
  // Each URL is SSRF-checked before the fetch — private/loopback IPs are blocked.
  const imageUrls: string[] = [];
  for (const url of remoteImageUrls.slice(0, MAX_IMAGES)) {
    try {
      const safe = await isSsrfSafe(url);
      if (!safe) {
        logger.warn({ url }, "Markdown image URL blocked by SSRF check — skipping");
        continue;
      }
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        redirect: "follow",
      });
      if (!resp.ok) continue;
      const contentType = resp.headers.get("content-type") ?? "image/jpeg";
      if (!contentType.startsWith("image/")) continue;
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < MIN_IMAGE_BYTES || buf.length > 5 * 1024 * 1024) continue;
      const ext = contentType.includes("png") ? "png" : "jpg";
      const uploaded = await uploadBuffersToGcs([buf], ext, contentType);
      imageUrls.push(...uploaded);
    } catch (err) {
      logger.warn({ err, url }, "Failed to fetch markdown image — skipping");
    }
  }

  logger.info({ filePath, chars: text.length, images: imageUrls.length }, "Markdown extraction complete");
  return { text, imageUrls };
}

// ─── Plain text ───────────────────────────────────────────────────────────────

export async function extractPlainText(filePath: string): Promise<ExtractResult> {
  const text = (await readFile(filePath, "utf8")).trim();
  logger.info({ filePath, chars: text.length }, "Plain-text extraction complete");
  return { text, imageUrls: [] };
}

// ─── PPTX ─────────────────────────────────────────────────────────────────────

export async function extractPptx(filePath: string): Promise<ExtractResult> {
  const JSZip = (await import("jszip")).default;
  const buf = await readFile(filePath);
  const zip = await JSZip.loadAsync(buf);

  // Collect slide text from ppt/slides/slide*.xml
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort();

  const textParts: string[] = [];
  for (const slideName of slideFiles) {
    const xml = await zip.files[slideName].async("string");
    // Extract text from <a:t> tags
    const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) ?? [];
    const slideText = matches
      .map((m) => m.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean)
      .join(" ");
    if (slideText) textParts.push(slideText);
  }

  // Collect embedded images from ppt/media/
  const mediaFiles = Object.keys(zip.files).filter(
    (name) => /^ppt\/media\//i.test(name) && /\.(png|jpg|jpeg|gif|webp)$/i.test(name),
  );

  const imageBuffers: Buffer[] = [];
  for (const media of mediaFiles.slice(0, MAX_IMAGES)) {
    const imgBuf = Buffer.from(await zip.files[media].async("arraybuffer"));
    if (imgBuf.length >= MIN_IMAGE_BYTES) {
      imageBuffers.push(imgBuf);
    }
  }

  const text = textParts.join("\n\n").trim();
  const imageUrls = await uploadBuffersToGcs(imageBuffers, "png", "image/png");

  logger.info({ filePath, slides: slideFiles.length, chars: text.length, images: imageUrls.length }, "PPTX extraction complete");
  return { text, imageUrls };
}

// ─── Image files (AI vision) ──────────────────────────────────────────────────

export async function extractImage(filePath: string, mimeType: string, originalName: string): Promise<ExtractResult> {
  const buf = await readFile(filePath);

  // Upload the image itself to GCS as the wiki illustration
  const ext = mimeType.includes("png") ? "png" : mimeType.includes("gif") ? "gif" : mimeType.includes("webp") ? "webp" : "jpg";
  const objectPath = `wiki-images/${Date.now()}-${randomUUID()}.${ext}`;
  try {
    const bucket = getBackupBucket();
    await bucket.file(objectPath).save(buf, {
      contentType: mimeType,
      metadata: { cacheControl: "public, max-age=31536000" },
    });
  } catch (err) {
    logger.warn({ err, filePath }, "Failed to upload image to GCS");
    return { text: "", imageUrls: [] };
  }

  // Call OpenAI vision to generate a structured description
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseUrl || !apiKey) {
    logger.warn({ filePath }, "OpenAI env vars not set; skipping vision description for image");
    return { text: "", imageUrls: [objectPath] };
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 60_000 });

    const b64 = buf.toString("base64");
    const response = await client.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content:
            "You are a document analyst for a knowledge base about AI adoption in Hong Kong's marketing industry. " +
            "Describe this image in detail: what type of visual it is (chart, photo, infographic, diagram, screenshot, etc.), " +
            "the key information it conveys, any visible text, labels, statistics, or data points, and the overall context. " +
            "Be specific and factual. Output plain text with no markdown formatting.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Analyze and describe this image from "${originalName}":` },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${b64}`, detail: "low" as const },
            },
          ],
        },
      ],
      max_completion_tokens: 800,
    });

    const text = response.choices[0]?.message?.content?.trim() ?? "";
    logger.info({ filePath, chars: text.length, gcsPath: objectPath }, "Image vision extraction complete");
    return { text, imageUrls: [objectPath] };
  } catch (err) {
    logger.warn({ err, filePath }, "Image vision analysis failed — storing image without text");
    return { text: "", imageUrls: [objectPath] };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * SSRF guard: resolves the hostname to an IP address and rejects any URL that
 * points to a loopback, link-local, or private (RFC-1918 / RFC-4193) network.
 * Returns true when the URL is safe to fetch, false otherwise.
 */
async function isSsrfSafe(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  // Only https is allowed — no http, no ftp, no file, etc.
  if (parsed.protocol !== "https:") return false;

  // Reject numeric IP literals in the hostname (IPv4 and bracketed IPv6)
  // by checking after DNS resolution below; also catch obvious literals early.
  const hostname = parsed.hostname;

  const dns = await import("dns");
  const { lookup } = dns.promises;

  let address: string;
  try {
    const result = await lookup(hostname, { family: 4 });
    address = result.address;
  } catch {
    // DNS failure — treat as unsafe
    return false;
  }

  // Parse and validate the resolved IPv4 address
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;

  // Block loopback (127.0.0.0/8)
  if (a === 127) return false;
  // Block link-local (169.254.0.0/16) — includes AWS/GCP instance metadata
  if (a === 169 && b === 254) return false;
  // Block private RFC-1918 ranges
  if (a === 10) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  // Block CGNAT (100.64.0.0/10)
  if (a === 100 && b >= 64 && b <= 127) return false;
  // Block multicast and reserved
  if (a >= 224) return false;

  return true;
}

async function uploadBuffersToGcs(buffers: Buffer[], ext: string, contentType: string): Promise<string[]> {
  if (buffers.length === 0) return [];
  try {
    const bucket = getBackupBucket();
    const paths: string[] = [];
    for (const buf of buffers.slice(0, MAX_IMAGES)) {
      const objectPath = `wiki-images/${Date.now()}-${randomUUID()}.${ext}`;
      await bucket.file(objectPath).save(buf, {
        contentType,
        metadata: { cacheControl: "public, max-age=31536000" },
      });
      paths.push(objectPath);
    }
    return paths;
  } catch (err) {
    logger.warn({ err }, "GCS image upload failed — continuing without images");
    return [];
  }
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/tiff",
] as const;

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

export function isSupportedMimeType(mime: string): mime is SupportedMimeType {
  return (SUPPORTED_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * Route a file to the correct extractor based on MIME type.
 * Always returns { text, imageUrls } — the PDF-specific steps in the upload
 * handler have been replaced with this single call.
 */
export async function dispatchExtraction(
  filePath: string,
  mimeType: string,
  originalName: string,
): Promise<ExtractResult> {
  switch (mimeType) {
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return extractDocx(filePath);

    case "application/msword":
      return extractDoc(filePath);

    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return extractPptx(filePath);

    case "text/markdown":
    case "text/x-markdown":
      return extractMarkdown(filePath);

    case "text/plain":
      return extractPlainText(filePath);

    case "image/jpeg":
    case "image/png":
    case "image/webp":
    case "image/gif":
    case "image/tiff":
      return extractImage(filePath, mimeType, originalName);

    default:
      logger.warn({ mimeType, filePath }, "No extractor for MIME type — returning empty");
      return { text: "", imageUrls: [] };
  }
}
