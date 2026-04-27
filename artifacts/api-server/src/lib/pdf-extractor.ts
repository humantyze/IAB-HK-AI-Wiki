import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

async function extractText(filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "pdftotext",
      ["-layout", filePath, "-"],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout.trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`pdftotext failed: ${message}`);
  }
}

async function renderPagesToBase64(filePath: string, maxPages = 8): Promise<string[]> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-pages-"));
  try {
    const outputPrefix = path.join(tmpDir, "page");
    await execFileAsync(
      "pdftoppm",
      ["-png", "-r", "100", "-l", String(maxPages), filePath, outputPrefix],
      { maxBuffer: 100 * 1024 * 1024 },
    );

    const files = await fs.readdir(tmpDir);
    const pngFiles = files.filter((f) => f.endsWith(".png")).sort();

    const images: string[] = [];
    for (const pngFile of pngFiles) {
      const buf = await fs.readFile(path.join(tmpDir, pngFile));
      images.push(buf.toString("base64"));
    }
    return images;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`pdftoppm failed: ${message}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function describeVisualContent(
  base64Images: string[],
  openaiBaseUrl: string,
  openaiApiKey: string,
): Promise<string[]> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: openaiApiKey, baseURL: openaiBaseUrl, timeout: 120_000 });

  const descriptions: string[] = [];

  for (let i = 0; i < base64Images.length; i++) {
    try {
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are analysing a page from a research report. " +
              "Describe any charts, graphs, tables, figures, infographics, or images you see, including the data values they show. " +
              "If the page is text-only with no significant visual elements, respond exactly with: NO_VISUAL_CONTENT",
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${base64Images[i]}`, detail: "high" },
              },
            ],
          },
        ],
        max_tokens: 500,
        temperature: 0.1,
      });

      const description = response.choices[0]?.message?.content?.trim() ?? "";
      if (description && description !== "NO_VISUAL_CONTENT") {
        descriptions.push(`[Page ${i + 1} — visual content]: ${description}`);
      }
    } catch {
      // Skip pages that fail — don't abort the whole extraction
    }
  }

  return descriptions;
}

export interface PdfExtractionResult {
  text: string;
  visualDescriptions: string[];
  combinedContent: string;
}

export async function extractPdfContent(
  filePath: string,
  openaiBaseUrl: string | undefined,
  openaiApiKey: string | undefined,
): Promise<PdfExtractionResult> {
  const text = await extractText(filePath);

  let visualDescriptions: string[] = [];
  if (openaiBaseUrl && openaiApiKey) {
    try {
      const pageImages = await renderPagesToBase64(filePath, 8);
      if (pageImages.length > 0) {
        visualDescriptions = await describeVisualContent(pageImages, openaiBaseUrl, openaiApiKey);
      }
    } catch {
      // Image extraction is best-effort — proceed with text only
    }
  }

  const combinedContent = [
    text,
    visualDescriptions.length > 0
      ? "--- VISUAL CONTENT ---\n\n" + visualDescriptions.join("\n\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { text, visualDescriptions, combinedContent };
}

export async function extractTextOnly(filePath: string): Promise<string> {
  return extractText(filePath);
}
