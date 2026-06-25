export interface Insight {
  id: string;
  /** The highlighted statistic phrase (e.g. "88% of employees"), if the sentence contains one. */
  stat: string | null;
  /** The full, markdown-stripped sentence shown on the card. */
  sentence: string;
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Flatten markdown body into a single stream of sentences, preserving bold markers. */
function toSentences(markdown: string): string[] {
  const cleanedLines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("---") && !/^#{1,6}\s/.test(line))
    // drop the "Additional content from ..." seed separators
    .filter((line) => !/^\*?additional content from/i.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""));

  const text = cleanedLines.join(" ");
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z“"])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const STAT_IN_BOLD = /\*\*([^*]*\d[^*]*)\*\*/;

/**
 * Extract shareable insights from a markdown body. Sentences containing a bold
 * statistic (a number, %, or currency figure) are surfaced first, since they
 * make the most compelling cards.
 */
export function extractInsights(markdown: string, max = 8): Insight[] {
  const sentences = toSentences(markdown);
  const seen = new Set<string>();
  const withStat: Insight[] = [];
  const withoutStat: Insight[] = [];

  sentences.forEach((raw, idx) => {
    const clean = stripMarkdown(raw);
    if (clean.length < 24 || clean.length > 260) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const boldStat = raw.match(STAT_IN_BOLD);
    const insight: Insight = {
      id: `s-${idx}`,
      stat: boldStat ? stripMarkdown(boldStat[1]) : null,
      sentence: clean,
    };
    (insight.stat ? withStat : withoutStat).push(insight);
  });

  return [...withStat, ...withoutStat].slice(0, max);
}

/**
 * A deterministic fallback insight so the Share entry point is always available,
 * even when automatic extraction finds nothing (short or irregular markdown).
 * Prefers the first meaningful sentence, falling back to the page title.
 */
export function fallbackInsight(title: string, markdown?: string): Insight {
  const first = markdown
    ? toSentences(markdown)
        .map((s) => stripMarkdown(s))
        .find((s) => s.length >= 24 && s.length <= 260)
    : undefined;
  return { id: "fallback", stat: null, sentence: first ?? title };
}

/** Build an insight from a pre-cleaned key-insight string (e.g. section keyInsights). */
export function insightFromText(text: string, id: string): Insight {
  const clean = stripMarkdown(text);
  const statMatch = clean.match(
    /((?:US?D?\$?\s?)?\d[\d,.]*\s?(?:%|percent|billion|million|trillion|bn|m\b|x\b)?[^.,;]{0,40})/i,
  );
  return {
    id,
    stat: statMatch && /\d/.test(statMatch[1]) ? statMatch[1].trim() : null,
    sentence: clean,
  };
}
