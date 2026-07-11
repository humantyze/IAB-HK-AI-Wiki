import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readdir, rm, readFile, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { getBackupBucket } from "./gcsClient";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

const MAX_IMAGES = 10;
const MIN_IMAGE_BYTES = 5 * 1024;

async function extractTextWithMuPDF(filePath: string): Promise<string> {
  const { readFile } = await import("fs/promises");
  const fileData = await readFile(filePath);
  // mupdf WASM — pure WASM, no browser DOM required, works in Cloud Run
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(fileData, "application/pdf");
  const pageCount = doc.countPages();
  const texts: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const sText = page.toStructuredText("preserve-whitespace");
    const text = sText.asText();
    if (text.trim()) texts.push(text.trim());
  }
  return texts.join("\n\n");
}

/**
 * Render up to `maxPages` pages of a PDF in batches of `batchSize`, calling
 * `onBatch` after each batch before rendering the next. Pixmaps are explicitly
 * destroyed after PNG extraction so WASM heap memory is freed between batches
 * rather than accumulating for the full page count.
 *
 * @param filePath  Absolute path to the PDF file
 * @param maxPages  Total page cap (default 6)
 * @param batchSize Pages per batch — each batch is rendered, passed to the
 *                  callback, then freed before the next batch starts (default 2)
 * @param onBatch   Async callback invoked with the PNG buffers for each batch
 *                  and the 0-based index of the first page in that batch
 */
export async function renderPdfPagesBatched(
  filePath: string,
  maxPages: number,
  batchSize: number,
  onBatch: (buffers: Buffer[], startPage: number) => Promise<void>,
): Promise<void> {
  const { readFile } = await import("fs/promises");
  const fileData = await readFile(filePath);
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(fileData, "application/pdf");
  const total = Math.min(doc.countPages(), maxPages);

  for (let start = 0; start < total; start += batchSize) {
    const end = Math.min(start + batchSize, total);
    const batch: Buffer[] = [];

    for (let i = start; i < end; i++) {
      const page = doc.loadPage(i);
      // 1.5× scale ≈ 108 DPI — legible for charts and tables
      const pixmap = page.toPixmap(
        [1.5, 0, 0, 1.5, 0, 0],
        mupdf.ColorSpace.DeviceRGB,
        false,
      );
      batch.push(Buffer.from(pixmap.asPNG()));
      pixmap.destroy(); // free WASM heap immediately — not GC'd otherwise
    }

    await onBatch(batch, start);

    // Yield to the event loop so the batch buffers become GC-eligible
    // before allocating the next batch
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/**
 * @deprecated Use renderPdfPagesBatched for memory-safe rendering.
 * Kept for any callers that need a simple array return.
 */
export async function renderPdfPages(filePath: string, maxPages = 4): Promise<Buffer[]> {
  const results: Buffer[] = [];
  await renderPdfPagesBatched(filePath, maxPages, maxPages, async (batch) => {
    results.push(...batch);
  });
  return results;
}

export async function extractTextOnly(filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "pdftotext",
      ["-layout", filePath, "-"],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout.trim();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      logger.info({ filePath }, "pdftotext not found — falling back to mupdf text extraction");
      return extractTextWithMuPDF(filePath);
    }
    throw err;
  }
}

/**
 * Extract embedded raster images from a PDF using pdfimages (Poppler CLI).
 * Uploads each qualifying image to object storage and returns the stored GCS
 * object paths. Returns an empty array when the PDF contains no extractable
 * images or when extraction fails for any reason.
 *
 * @param filePath  Absolute path to the PDF file on disk
 * @returns         Array of GCS object paths (e.g. "wiki-images/abc.png")
 */
export async function extractImages(filePath: string): Promise<string[]> {
  let tmpDir: string | null = null;
  try {
    tmpDir = await mkdtemp(join(tmpdir(), "pdfimages-"));
    const outputPrefix = join(tmpDir, "img");

    await execFileAsync("pdfimages", ["-png", filePath, outputPrefix], {
      timeout: 60_000,
    });

    const allFiles = await readdir(tmpDir);
    const imageFiles = allFiles
      .filter((f) => f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".ppm"))
      .sort()
      .slice(0, MAX_IMAGES);

    if (imageFiles.length === 0) return [];

    const bucket = getBackupBucket();
    const uploadedPaths: string[] = [];

    for (const file of imageFiles) {
      const fullPath = join(tmpDir, file);
      const info = await stat(fullPath);
      if (info.size < MIN_IMAGE_BYTES) continue;

      const ext = file.endsWith(".jpg") ? "jpg" : "png";
      const objectPath = `wiki-images/${Date.now()}-${randomUUID()}.${ext}`;
      const buffer = await readFile(fullPath);
      const contentType = ext === "jpg" ? "image/jpeg" : "image/png";

      await bucket.file(objectPath).save(buffer, {
        contentType,
        metadata: { cacheControl: "public, max-age=31536000" },
      });

      uploadedPaths.push(objectPath);
    }

    logger.info({ filePath, count: uploadedPaths.length }, "PDF images extracted and uploaded");
    return uploadedPaths;
  } catch (err) {
    logger.warn({ err, filePath }, "PDF image extraction failed or no images found");
    return [];
  } finally {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
