import fs from "fs";
import path from "path";
import type { ChartDataPoint } from "@workspace/db";
import { logger } from "./logger";

export interface SectionSuggestion {
  slug: string;
  title: string;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export interface AnalysisResult {
  summary: string;
  suggestions: SectionSuggestion[];
  taskList: string[];
}

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

function buildImagePrompt(sectionSlug: string, keyInsights: string[], promptExtra?: string): string {
  const insightSummary = keyInsights.slice(0, 3).join(". ");
  const topic = sectionSlug.replace(/-/g, " ");
  const extra = promptExtra?.trim() ? ` ${promptExtra.trim()}.` : "";
  return (
    `Flat vector illustration in a futuristic neon-on-dark style. Topic: ${topic} in Hong Kong's AI marketing landscape. ` +
    `Key themes: ${insightSummary}.${extra} ` +
    `Style: minimal geometric shapes, cyan and violet neon accents on deep dark background, abstract data visualization motifs, ` +
    `no text, no people, no faces. Clean, modern, report-ready.`
  );
}

export async function generateSectionImage(
  sectionSlug: string,
  keyInsights: string[],
  promptExtra?: string,
): Promise<string | null> {
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  if (!baseUrl || !apiKey) {
    logger.warn({ sectionSlug }, "OpenAI env vars not set; skipping image generation");
    return null;
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 30_000 });

    const prompt = buildImagePrompt(sectionSlug, keyInsights, promptExtra);
    const response = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });

    const base64 = response.data?.[0]?.b64_json ?? "";
    if (!base64) {
      logger.warn({ sectionSlug }, "Image generation returned empty data");
      return null;
    }

    const buffer = Buffer.from(base64, "base64");
    const imagesDir = path.join(process.cwd(), "public", "section-images");
    await fs.promises.mkdir(imagesDir, { recursive: true });

    const filename = `${sectionSlug}-${Date.now()}.png`;
    const filePath = path.join(imagesDir, filename);
    await fs.promises.writeFile(filePath, buffer);

    return `/api/section-images/${filename}`;
  } catch (err) {
    logger.error({ err, sectionSlug }, "Failed to generate section image");
    return null;
  }
}

export async function analyzeSections(
  rawText: string,
  contentType: string,
  availableSections: { slug: string; title: string }[],
): Promise<AnalysisResult> {
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  if (!baseUrl || !apiKey) {
    logger.warn("OpenAI env vars not set; skipping section analysis");
    return { summary: "", suggestions: [], taskList: ["OpenAI not configured — analysis unavailable"] };
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 30_000 });

    const sectionList = availableSections.map((s) => `  - slug: "${s.slug}" → ${s.title}`).join("\n");
    const isWhitepaper = contentType === "whitepaper";

    const systemPrompt = `You are an AI content analyst for a report called "State of AI in Hong Kong's Marketing Industry".
Your task: analyse submitted content and decide which existing report sections it should update.

Available sections:
${sectionList}

Rules:
- ${isWhitepaper ? "For whitepapers, map EVERY relevant chapter/topic to the best matching section — you may suggest many sections." : "For this content type, suggest the 1–3 most relevant sections only."}
- Only recommend a section when the content clearly relates to its topic.
- "confidence" is "high" when the section topic is the primary focus of the submitted content, "medium" when related, "low" when tangential.
- Return ONLY valid JSON (no markdown fences, no explanation text).

JSON schema:
{
  "summary": "1–2 sentence description of the submitted content",
  "suggestions": [
    { "slug": "<slug>", "title": "<title>", "reason": "<why this content belongs here>", "confidence": "high"|"medium"|"low" }
  ],
  "taskList": [
    "<action string, e.g. 'Update AI Adoption Rates section with new survey data showing 67% adoption'>"
  ]
}`;

    const userPrompt = `Content type: ${contentType.replace(/_/g, " ")}\n\nContent:\n${rawText.substring(0, 4000)}`;

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as {
      summary?: string;
      suggestions?: SectionSuggestion[];
      taskList?: string[];
    };

    const validSlugs = new Set(availableSections.map((s) => s.slug));
    const suggestions = (parsed.suggestions ?? []).filter((s) => validSlugs.has(s.slug));

    return {
      summary: parsed.summary ?? "",
      suggestions,
      taskList: parsed.taskList ?? suggestions.map((s) => `Update "${s.title}" with new ${contentType.replace(/_/g, " ")} content`),
    };
  } catch (err) {
    logger.error({ err }, "Failed to analyse sections");
    return { summary: "", suggestions: [], taskList: [] };
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
