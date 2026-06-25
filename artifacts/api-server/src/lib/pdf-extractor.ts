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

async function extractTextWithPdfParse(filePath: string): Promise<string> {
  const { readFile } = await import("fs/promises");
  const buffer = await readFile(filePath);
  // pdf-parse is a pure Node.js library — no browser DOM required
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);
  return data.text.trim();
}

/**
 * Render up to `maxPages` pages of a PDF as PNG image buffers using MuPDF WASM.
 * Works in Cloud Run with no system dependencies.
 * Returns an empty array if rendering fails for any reason.
 */
export async function renderPdfPages(filePath: string, maxPages = 4): Promise<Buffer[]> {
  const { readFile } = await import("fs/promises");
  const fileData = await readFile(filePath);
  // Dynamic import keeps the WASM module out of the esbuild bundle
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(fileData, "application/pdf");
  const count = Math.min(doc.countPages(), maxPages);
  const results: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const page = doc.loadPage(i);
    // 1.5× scale ≈ 108 DPI — legible for charts and tables
    const pixmap = page.toPixmap(
      [1.5, 0, 0, 1.5, 0, 0],
      mupdf.ColorSpace.DeviceRGB,
      false,
    );
    results.push(Buffer.from(pixmap.asPNG()));
  }
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
      logger.info({ filePath }, "pdftotext not found — falling back to pdf-parse");
      return extractTextWithPdfParse(filePath);
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
