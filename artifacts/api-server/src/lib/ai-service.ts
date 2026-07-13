import { db, wikiPagesTable } from "@workspace/db";
import { indexWikiPage } from "./knowledge-index";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

export interface WikiPageExtract {
  slug: string;
  title: string;
  body_markdown: string;
  tags: string[];
  related_slugs: string[];
  image_url: string | null;
}

export interface BodySegment {
  ref: string;
  label: string;
  markdown: string;
}

interface WikiSource {
  label: string;
  ref: string;
}

const LEGACY_APPEND_DELIM = "\n\n---\n\n*Additional content from ";

/** Render a page body deterministically from its per-source segments. */
export function renderBodyFromSegments(segments: BodySegment[]): string {
  return segments
    .map((s, i) =>
      i === 0
        ? s.markdown
        : `\n\n---\n\n*Additional content from ${s.label}:*\n\n${s.markdown}`,
    )
    .join("");
}

/**
 * Reconstruct per-source segments for a legacy page that predates segment
 * tracking. Splits on the delimiter the old merge used and maps each part to a
 * source by position, falling back to a single segment attributed to the first
 * source when the body can't be split.
 */
export function deriveLegacySegments(bodyMarkdown: string, sources: WikiSource[]): BodySegment[] {
  if (!bodyMarkdown.trim()) return [];
  if (sources.length === 0) {
    return [{ ref: "legacy", label: "Original", markdown: bodyMarkdown }];
  }
  const parts = bodyMarkdown.split(LEGACY_APPEND_DELIM);
  const segments: BodySegment[] = [
    { ref: sources[0].ref, label: sources[0].label, markdown: parts[0] },
  ];
  for (let i = 1; i < parts.length; i++) {
    const src = sources[i] ?? sources[sources.length - 1];
    const m = parts[i].match(/^(.*?):\*\n\n([\s\S]*)$/);
    segments.push({ ref: src.ref, label: src.label, markdown: m ? m[2] : parts[i] });
  }
  return segments;
}

/**
 * Remove every source matching `shouldRemove` from a page — both its citation
 * and its body segment(s) — and re-derive the body so the removed upload's prose
 * actually leaves the page (not just the citation). Returns the reconciled
 * fields plus whether the page has any sources left.
 */
export function removeRefFromPage(
  page: { sources: unknown; bodySegments: unknown; bodyMarkdown: string },
  shouldRemove: (ref: string) => boolean,
): { sources: WikiSource[]; bodySegments: BodySegment[]; bodyMarkdown: string; isEmpty: boolean } {
  const sources = (page.sources as WikiSource[]) ?? [];
  const existingSegments = (page.bodySegments as BodySegment[]) ?? [];
  const segments = existingSegments.length > 0
    ? existingSegments
    : deriveLegacySegments(page.bodyMarkdown, sources);

  const newSources = sources.filter((s) => !shouldRemove(s.ref));
  const newSegments = segments.filter((s) => !shouldRemove(s.ref));
  return {
    sources: newSources,
    bodySegments: newSegments,
    bodyMarkdown: renderBodyFromSegments(newSegments),
    isEmpty: newSources.length === 0,
  };
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
- body_markdown: Write like a sharp industry analyst briefing a busy marketing executive — direct, concrete, and clear about why each point matters. Prefer specific numbers, named examples, and short paragraphs over general statements. Avoid academic hedging and filler. Structure every body_markdown exactly as follows:
  1. ## TL;DR — 2–3 bullet points summarising the page
  2. **Why it matters for HK marketers:** — one direct sentence
  3. Main content using ## and ### headings, bullet points, and bold for key terms
  4. Any notable statistics from the source as bold standalone callout lines (e.g. **67% of HK brands reported X in 2024.**)
  5. ## So what for marketers — 1–2 sentences of direct, actionable takeaway
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
    const slug = page.slug;

    // Serialize per-slug read-merge-write behind a transaction-scoped advisory
    // lock keyed on the slug. Without this, two concurrent uploads that extract
    // the SAME new slug both read "not found", both INSERT, and the second hits
    // the UNIQUE(slug) constraint — which previously surfaced as "Wiki
    // extraction failed" and silently dropped the losing upload's content.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${slug}))`);

      const [existing] = await tx
        .select()
        .from(wikiPagesTable)
        .where(eq(wikiPagesTable.slug, slug))
        .limit(1);

      if (existing) {
        const existingSources = (existing.sources as WikiSource[]) ?? [];
        const alreadyCited = existingSources.some((s) => s.ref === sourceRef);
        const newSources = alreadyCited
          ? existingSources
          : [...existingSources, { label: sourceLabel, ref: sourceRef }];

        // Store this source's prose as its OWN segment (replace in place when it
        // already exists). This makes re-running extraction idempotent and lets
        // a later delete of this source remove exactly its contribution while
        // the body is always re-derived from the surviving segments.
        const existingSegments = (existing.bodySegments as BodySegment[]) ?? [];
        const baseSegments = existingSegments.length > 0
          ? existingSegments
          : deriveLegacySegments(existing.bodyMarkdown, existingSources);
        const thisSegment: BodySegment = { ref: sourceRef, label: sourceLabel, markdown: page.body_markdown };
        const idx = baseSegments.findIndex((s) => s.ref === sourceRef);
        const mergedSegments = idx >= 0
          ? baseSegments.map((s, i) => (i === idx ? thisSegment : s))
          : [...baseSegments, thisSegment];

        const mergedTags = [...new Set([...((existing.tags as string[]) ?? []), ...page.tags])];
        const mergedRelated = [...new Set([...((existing.relatedSlugs as string[]) ?? []), ...page.related_slugs])];

        await tx
          .update(wikiPagesTable)
          .set({
            bodyMarkdown: renderBodyFromSegments(mergedSegments),
            bodySegments: mergedSegments,
            tags: mergedTags,
            relatedSlugs: mergedRelated,
            sources: newSources,
            imageUrl: existing.imageUrl ?? page.image_url ?? null,
            updatedAt: new Date(),
          })
          .where(eq(wikiPagesTable.slug, slug));

        updated++;
      } else {
        const segments: BodySegment[] = [{ ref: sourceRef, label: sourceLabel, markdown: page.body_markdown }];
        await tx.insert(wikiPagesTable).values({
          slug,
          title: page.title,
          bodyMarkdown: renderBodyFromSegments(segments),
          bodySegments: segments,
          tags: page.tags,
          relatedSlugs: page.related_slugs,
          sources: [{ label: sourceLabel, ref: sourceRef }],
          imageUrl: page.image_url ?? null,
        });
        created++;
      }
    });

    try {
      await indexWikiPage(slug);
    } catch (err) {
      logger.warn({ err, slug }, "Failed to index wiki page into knowledge store");
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
    max_completion_tokens: 8000,
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
- body_markdown: Write like a sharp industry analyst briefing a busy marketing executive — direct, concrete, and clear about why each point matters. Prefer specific numbers, named examples, and short paragraphs over general statements. Avoid academic hedging and filler. Structure every body_markdown exactly as follows:
  1. ## TL;DR — then on the very next line the plain text "🔗 Synthesized insight", then 2–3 bullet points summarising the page
  2. **Why it matters for HK marketers:** — one direct sentence
  3. Main content using ## and ### headings, bullet points, and bold for key terms
  4. Any notable statistics from the source as bold standalone callout lines (e.g. **67% of HK brands reported X in 2024.**)
  5. ## So what for marketers — 1–2 sentences of direct, actionable takeaway
  6. A horizontal rule (---) followed by this exact paragraph in italics: *This page was synthesized by AI from themes across multiple member contributions, rather than extracted from a single source document. It may contain interpretive connections or inaccuracies; verify key claims against the source pages before citing.*
- tags: 1-3 tags from: ["Organizations", "Statistics", "Tools & Platforms", "Regulatory", "Trends", "Case Studies", "Frameworks"]
- related_slugs: slugs of the pages from the "Already extracted" list that this synthesis directly draws from (derive the slug from the title by converting to kebab-case — lowercase, spaces to hyphens, remove punctuation; include only pages that genuinely informed this synthesis)

Rules:
- Do NOT duplicate any page from the "Already extracted" list
- Synthesise only topics that genuinely emerge from the provided content
- Do not hallucinate statistics or claims not supported by the provided text
- Return ONLY valid JSON with no markdown fences

JSON schema:
{ "wikiPages": [ { "slug": "...", "title": "...", "body_markdown": "...", "tags": [...], "related_slugs": ["..."] } ] }`;

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
      const slug = page.slug;

      // Lock per-slug so a concurrent upload extracting the same slug can't
      // collide with the synthesis insert on the UNIQUE(slug) constraint.
      let didCreate = false;
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${slug}))`);

        const [existing] = await tx
          .select({ id: wikiPagesTable.id })
          .from(wikiPagesTable)
          .where(eq(wikiPagesTable.slug, slug))
          .limit(1);

        if (!existing) {
          const segments: BodySegment[] = [
            { ref: "wiki-seed-synthesis", label: "Synthesis — cross-content analysis", markdown: page.body_markdown },
          ];
          await tx.insert(wikiPagesTable).values({
            slug,
            title: page.title,
            bodyMarkdown: renderBodyFromSegments(segments),
            bodySegments: segments,
            tags: page.tags,
            relatedSlugs: [],
            sources: [{ label: "Synthesis — cross-content analysis", ref: "wiki-seed-synthesis" }],
          });
          didCreate = true;
        }
      });

      if (didCreate) {
        created++;
        try {
          await indexWikiPage(slug);
        } catch (err) {
          logger.warn({ err, slug }, "Failed to index synthesized wiki page into knowledge store");
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
