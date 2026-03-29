import fs from "fs";
import path from "path";
import type { ChartDataPoint } from "@workspace/db";
import { logger } from "./logger";

export interface AiProcessingResult {
  sectionSlug: string;
  bodyMarkdown: string;
  keyInsights: string[];
  chartData: ChartDataPoint[];
  imageUrl: string | null;
}

function extractChartData(text: string): ChartDataPoint[] {
  const points: ChartDataPoint[] = [];
  const seen = new Set<string>();

  const patterns: Array<{ re: RegExp; handler: (m: RegExpExecArray) => ChartDataPoint | null }> = [
    {
      re: /(\d+(?:\.\d+)?)\s*%\s+(?:of\s+)?([a-zA-Z][a-zA-Z0-9 ]{2,40}?)(?=[,.\s]|$)/gi,
      handler: (m) => ({ label: m[2].trim(), value: parseFloat(m[1]), unit: "%" }),
    },
    {
      re: /([a-zA-Z][a-zA-Z0-9 ]{2,40}?)\s+(?:rate|adoption|usage|penetration|share|growth|increase|decrease)\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*%/gi,
      handler: (m) => ({ label: m[1].trim(), value: parseFloat(m[2]), unit: "%" }),
    },
    {
      re: /(\d+(?:\.\d+)?)\s*%\s+(?:adoption|usage|penetration|growth|increase|decline|rate)/gi,
      handler: (m) => ({ label: m[0].replace(/\d+(?:\.\d+)?%\s+/, "").trim() || "rate", value: parseFloat(m[1]), unit: "%" }),
    },
    {
      re: /(\d+(?:\.\d+)?)\s*([Kk])\b(?:\s+([a-zA-Z][a-zA-Z0-9 ]{2,30}?))?/g,
      handler: (m) => ({ label: (m[3] ?? "volume").trim() || "volume", value: parseFloat(m[1]), unit: "K" }),
    },
    {
      re: /(\d+(?:\.\d+)?)\s*([Mm])\b(?:\s+([a-zA-Z][a-zA-Z0-9 ]{2,30}?))?/g,
      handler: (m) => ({ label: (m[3] ?? "value").trim() || "value", value: parseFloat(m[1]), unit: "M" }),
    },
    {
      re: /(\d{2,})\s+(companies|brands|businesses|organizations|respondents|professionals|marketers)/gi,
      handler: (m) => ({ label: m[2].trim(), value: parseInt(m[1], 10), unit: "" }),
    },
  ];

  for (const { re, handler } of patterns) {
    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(text)) !== null) {
      const point = handler(match);
      if (point && point.value > 0 && point.value < 1_000_000) {
        const key = `${point.label.toLowerCase()}|${point.unit}`;
        if (!seen.has(key)) {
          seen.add(key);
          points.push(point);
        }
      }
      if (points.length >= 6) break;
    }
    if (points.length >= 6) break;
  }

  return points.slice(0, 6);
}

function buildImagePrompt(sectionSlug: string, keyInsights: string[]): string {
  const insightSummary = keyInsights.slice(0, 3).join(". ");
  const topic = sectionSlug.replace(/-/g, " ");
  return (
    `Flat vector illustration in a futuristic neon-on-dark style. Topic: ${topic} in Hong Kong's AI marketing landscape. ` +
    `Key themes: ${insightSummary}. ` +
    `Style: minimal geometric shapes, cyan and violet neon accents on deep dark background, abstract data visualization motifs, ` +
    `no text, no people, no faces. Clean, modern, report-ready.`
  );
}

async function generateSectionImage(
  sectionSlug: string,
  keyInsights: string[],
): Promise<string | null> {
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  if (!baseUrl || !apiKey) {
    logger.warn({ sectionSlug }, "OpenAI env vars not set; skipping image generation");
    return null;
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey, baseURL: baseUrl });

    const prompt = buildImagePrompt(sectionSlug, keyInsights);
    const response = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });

    const base64 = response.data[0]?.b64_json ?? "";
    if (!base64) {
      logger.warn({ sectionSlug }, "Image generation returned empty data");
      return null;
    }

    const buffer = Buffer.from(base64, "base64");
    const imagesDir = path.join(process.cwd(), "public", "section-images");
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    const filename = `${sectionSlug}-${Date.now()}.png`;
    const filePath = path.join(imagesDir, filename);
    fs.writeFileSync(filePath, buffer);

    return `/api/section-images/${filename}`;
  } catch (err) {
    logger.error({ err, sectionSlug }, "Failed to generate section image");
    return null;
  }
}

export async function processUpload(
  rawText: string,
  targetSections: string[],
  contentType: string,
): Promise<AiProcessingResult[]> {
  const results: AiProcessingResult[] = [];

  const chartData = extractChartData(rawText);

  for (const slug of targetSections) {
    const sentences = rawText.split(/[.!?]+/).filter((s) => s.trim().length > 20);
    const insights = sentences.slice(0, 3).map((s) => s.trim());

    const processedBody = `## Updated Content\n\n${rawText}\n\n*This section was updated with new ${contentType.replace(/_/g, " ")} content.*`;

    const keyInsights = insights.length > 0 ? insights : ["New content has been integrated into this section."];

    const imageUrl = await generateSectionImage(slug, keyInsights);

    results.push({
      sectionSlug: slug,
      bodyMarkdown: processedBody,
      keyInsights,
      chartData,
      imageUrl,
    });
  }

  return results;
}
