import { db, wikiPagesTable } from "@workspace/db";
import { indexWikiPage } from "./knowledge-index";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export interface WikiPageExtract {
  slug: string;
  title: string;
  body_markdown: string;
  tags: string[];
  related_slugs: string[];
  image_url: string | null;
}

export async function extractWikiPages(
  sourceLabel: string,
  rawText: string,
  sourceRef: string,
  candidateImageUrls: string[] = [],
): Promise<{ created: number; updated: number }> {
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("OpenAI env vars (AI_INTEGRATIONS_OPENAI_BASE_URL / AI_INTEGRATIONS_OPENAI_API_KEY) are not set — cannot run wiki extraction");
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 600_000 });

  // Cap input to avoid extremely slow / timing-out completions
  const MAX_TEXT_CHARS = 80_000;
  const truncatedText = rawText.length > MAX_TEXT_CHARS
    ? rawText.slice(0, MAX_TEXT_CHARS) + "\n\n[...truncated for length]"
    : rawText;

  const imageInstructions = candidateImageUrls.length > 0
    ? `\n\nThis source also contains extracted images. For each wiki page, pick the single most relevant image from the list below (or null if none fits the page content). Use the exact path string.\nCandidate image paths:\n${candidateImageUrls.map((u, i) => `${i + 1}. ${u}`).join("\n")}\nAdd to each wiki page:\n- image_url: exact path string chosen, or null`
    : "";

  const jsonSchema = candidateImageUrls.length > 0
    ? `{ "wikiPages": [ { "slug": "...", "title": "...", "body_markdown": "...", "tags": [...], "related_slugs": [...], "image_url": "path-or-null" } ] }`
    : `{ "wikiPages": [ { "slug": "...", "title": "...", "body_markdown": "...", "tags": [...], "related_slugs": [...] } ] }`;

  const systemPrompt = `You are a knowledge extraction assistant for a report called "State of AI in Hong Kong's Marketing Industry".

Your task: read the provided text and extract distinct named entities, concepts, statistics, tools, organisations, regulations, and trends that deserve their own wiki page. Each wiki page should be focused and atomic — one clear concept per page.

For each entity/concept return:
- slug: kebab-case unique identifier (e.g. "ai-expectation-gap", "hkpc-survey-2025")
- title: human-readable title
- body_markdown: 200-600 words of concise, factual markdown content about this entity. Use ## and ### headings, bullet points, and bold for key terms.
- tags: 1-3 tags from this list only: ["Organizations", "Statistics", "Tools & Platforms", "Regulatory", "Trends", "Case Studies", "Frameworks"]
- related_slugs: slugs of other wiki pages in this same batch that are clearly related (can be empty array)${imageInstructions}

Rules:
- Extract 3-12 wiki pages per source — focus on the most significant and distinct entities
- Do NOT extract generic concepts (e.g. "artificial intelligence", "marketing") — only specific named entities, studies, tools, statistics, or frameworks referenced in the text
- body_markdown must be factual and grounded in the provided text; do not hallucinate
- Return ONLY valid JSON with no markdown fences

JSON schema:
${jsonSchema}`;

  const userPrompt = `Source: ${sourceLabel}\n\nText:\n${truncatedText}`;

  const response = await client.chat.completions.create({
    model: "gpt-5",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { wikiPages?: WikiPageExtract[] };
  const pages = parsed.wikiPages ?? [];

  let created = 0;
  let updated = 0;

  for (const page of pages) {
    if (!page.slug || !page.title) continue;

    const [existing] = await db
      .select()
      .from(wikiPagesTable)
      .where(eq(wikiPagesTable.slug, page.slug))
      .limit(1);

    if (existing) {
      const existingSources = (existing.sources as Array<{ label: string; ref: string }>) ?? [];
      const alreadyCited = existingSources.some((s) => s.ref === sourceRef);
      const newSources = alreadyCited
        ? existingSources
        : [...existingSources, { label: sourceLabel, ref: sourceRef }];

      const mergedBody = existing.bodyMarkdown.includes(page.body_markdown.slice(0, 50))
        ? existing.bodyMarkdown
        : `${existing.bodyMarkdown}\n\n---\n\n*Additional content from ${sourceLabel}:*\n\n${page.body_markdown}`;

      const existingTags = (existing.tags as string[]) ?? [];
      const mergedTags = [...new Set([...existingTags, ...page.tags])];

      const existingRelated = (existing.relatedSlugs as string[]) ?? [];
      const mergedRelated = [...new Set([...existingRelated, ...page.related_slugs])];

      await db
        .update(wikiPagesTable)
        .set({
          bodyMarkdown: mergedBody,
          tags: mergedTags,
          relatedSlugs: mergedRelated,
          sources: newSources,
          imageUrl: existing.imageUrl ?? page.image_url ?? null,
          updatedAt: new Date(),
        })
        .where(eq(wikiPagesTable.slug, page.slug));

      updated++;
    } else {
      await db.insert(wikiPagesTable).values({
        slug: page.slug,
        title: page.title,
        bodyMarkdown: page.body_markdown,
        tags: page.tags,
        relatedSlugs: page.related_slugs,
        sources: [{ label: sourceLabel, ref: sourceRef }],
        imageUrl: page.image_url ?? null,
      });
      created++;
    }

    try {
      await indexWikiPage(page.slug);
    } catch (err) {
      logger.warn({ err, slug: page.slug }, "Failed to index wiki page into knowledge store");
    }
  }

  logger.info({ sourceLabel, created, updated }, "Wiki extraction complete");
  return { created, updated };
}

/**
 * Ask the AI to choose the single best image path from a candidate list for a
 * given wiki page. Returns the chosen path string or null if none fits.
 */
export async function assignImageToWikiPage(
  pageTitle: string,
  pageBody: string,
  candidateImageUrls: string[],
): Promise<string | null> {
  if (candidateImageUrls.length === 0) return null;

  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseUrl || !apiKey) return null;

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 30_000 });

    const response = await client.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an image selection assistant. Given a wiki page title, body, and a numbered list of image paths extracted from a PDF, pick the single most relevant image for the page. " +
            'Return ONLY valid JSON in this exact shape: {"image_url": "chosen-path-or-null"}. ' +
            "Use null if no image is a good match. Use the exact path string from the list.",
        },
        {
          role: "user",
          content:
            `Wiki page title: ${pageTitle}\n\nBody (excerpt):\n${pageBody.slice(0, 800)}\n\n` +
            `Candidate image paths:\n${candidateImageUrls.map((u, i) => `${i + 1}. ${u}`).join("\n")}\n\n` +
            'Return {"image_url": "chosen-path-or-null"}',
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 64,
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { image_url?: string | null };
    const chosen = parsed.image_url;
    if (typeof chosen === "string" && candidateImageUrls.includes(chosen)) {
      return chosen;
    }
    return null;
  } catch (err) {
    logger.warn({ err, pageTitle }, "assignImageToWikiPage AI call failed");
    return null;
  }
}

/**
 * Send rendered PDF page images to GPT Vision and return a plain-text
 * description of every chart, table, diagram, statistic, and infographic
 * found. Returns an empty string when no useful visual content is detected
 * or when the AI call fails.
 */
export async function describeDocumentVisuals(
  pageBuffers: Buffer[],
  filename: string,
): Promise<string> {
  if (pageBuffers.length === 0) return "";

  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseUrl || !apiKey) {
    logger.warn({ filename }, "OpenAI env vars not set — skipping visual analysis");
    return "";
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 90_000 });

  const imageContent = pageBuffers.map((buf) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:image/png;base64,${buf.toString("base64")}`,
      detail: "high" as const,
    },
  }));

  const response = await client.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content:
          "You are a document analyst for a knowledge base about AI adoption in Hong Kong's marketing industry. " +
          "Examine the provided PDF page images and extract every meaningful visual element: " +
          "charts, graphs, tables, statistics callouts, frameworks, diagrams, and infographics. " +
          "For each visual element describe: what type it is, the key data or information it conveys, " +
          "and any important labels, axes, percentages, or numbers visible. " +
          "Be specific and factual. Output plain text with no markdown.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze the visual content across these ${pageBuffers.length} page(s) from "${filename}":`,
          },
          ...imageContent,
        ],
      },
    ],
    max_completion_tokens: 4000,
  });

  const raw = response.choices[0]?.message?.content;
  const text = raw?.trim() ?? "";
  if (!text) {
    logger.warn({ filename, pages: pageBuffers.length, finishReason: response.choices[0]?.finish_reason }, "PDF visual analysis returned empty content");
  } else {
    logger.info({ filename, pages: pageBuffers.length, chars: text.length }, "PDF visual analysis complete");
  }
  return text;
}

export async function synthesizeWikiGaps(
  sectionSummaries: Array<{ title: string; bodyMarkdown: string }>,
  existingPageTitles: string[],
): Promise<{ created: number }> {
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  if (!baseUrl || !apiKey) return { created: 0 };

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 120_000 });

    const sectionOverview = sectionSummaries
      .map((s) => `### ${s.title}\n${s.bodyMarkdown.slice(0, 1500)}`)
      .join("\n\n---\n\n");

    const alreadyExtracted = existingPageTitles.map((t) => `- ${t}`).join("\n");

    const systemPrompt = `You are a knowledge synthesis assistant for a report called "State of AI in Hong Kong's Marketing Industry".

You have been given:
1. Summaries of content
2. A list of wiki pages already extracted

Your task: identify 3-8 important cross-cutting topics, themes, comparisons, or frameworks that are implied or discussed across multiple sources but are NOT yet represented as dedicated wiki pages. Synthesise new wiki pages for these gaps.

For each new page return:
- slug: kebab-case unique identifier
- title: human-readable title
- body_markdown: 200-600 words of factual, synthesised markdown content. Use ## and ### headings and bullet points.
- tags: 1-3 tags from: ["Organizations", "Statistics", "Tools & Platforms", "Regulatory", "Trends", "Case Studies", "Frameworks"]
- related_slugs: empty array

Rules:
- Do NOT duplicate any page from the "Already extracted" list
- Synthesise only topics that genuinely emerge from the provided content
- Do not hallucinate statistics or claims not supported by the provided text
- Return ONLY valid JSON with no markdown fences

JSON schema:
{ "wikiPages": [ { "slug": "...", "title": "...", "body_markdown": "...", "tags": [...], "related_slugs": [] } ] }`;

    const userPrompt = `Already extracted wiki pages:\n${alreadyExtracted}\n\n---\n\nContent:\n${sectionOverview}`;

    const response = await client.chat.completions.create({
      model: "gpt-5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { wikiPages?: WikiPageExtract[] };
    const pages = parsed.wikiPages ?? [];

    let created = 0;
    for (const page of pages) {
      if (!page.slug || !page.title) continue;

      const [existing] = await db
        .select({ id: wikiPagesTable.id })
        .from(wikiPagesTable)
        .where(eq(wikiPagesTable.slug, page.slug))
        .limit(1);

      if (!existing) {
        await db.insert(wikiPagesTable).values({
          slug: page.slug,
          title: page.title,
          bodyMarkdown: page.body_markdown,
          tags: page.tags,
          relatedSlugs: [],
          sources: [{ label: "Synthesis — cross-content analysis", ref: "wiki-seed-synthesis" }],
        });
        created++;

        try {
          await indexWikiPage(page.slug);
        } catch (err) {
          logger.warn({ err, slug: page.slug }, "Failed to index synthesized wiki page into knowledge store");
        }
      }
    }

    logger.info({ created }, "Wiki gap synthesis complete");
    return { created };
  } catch (err) {
    logger.error({ err }, "Wiki gap synthesis failed");
    return { created: 0 };
  }
}
