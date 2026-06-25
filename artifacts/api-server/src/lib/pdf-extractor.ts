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

async function extractTextWithPdfjs(filePath: string): Promise<string> {
  const { readFile: readFilePdfjs } = await import("fs/promises");
  const buffer = await readFilePdfjs(filePath);
  const uint8 = new Uint8Array(buffer);

  // pdfjs-dist legacy build works in Node without a canvas dependency
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
  const pdf = await pdfjs.getDocument({ data: uint8, useSystemFonts: true }).promise;

  const lines: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = (content.items as Array<{ str?: string }>)
      .map((item) => item.str ?? "")
      .join(" ")
      .trim();
    if (pageText) lines.push(pageText);
  }
  return lines.join("\n");
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
      logger.info({ filePath }, "pdftotext not found — falling back to pdfjs-dist");
      return extractTextWithPdfjs(filePath);
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
