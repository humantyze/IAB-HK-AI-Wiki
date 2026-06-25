/**
 * Build-time prerender script.
 *
 * After `vite build` has written dist/public/, this script:
 *  1. Connects to PostgreSQL (DATABASE_URL env var — required; build fails without it).
 *  2. Fetches every wiki page and report section.
 *  3. Enhances dist/public/index.html (the home route) with the full link
 *     graph and a <noscript> index so crawlers discover all internal URLs.
 *  4. Writes a dedicated index.html for each slug under:
 *       dist/public/wiki/<slug>/index.html
 *       dist/public/sections/<slug>/index.html
 *  Each file has route-specific <head> metadata (title, description,
 *  canonical, Open Graph, Twitter Card) and a <noscript> block with
 *  the full article body so non-JS crawlers see real content.
 *
 * Run via: node scripts/prerender.mjs
 */

import pg from "pg";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist", "public");
const SITE_NAME = "State of AI in HK Marketing";
const BASE_ORIGIN = "https://state-of-ai-in-hk-marketing.replit.app";
const OG_IMAGE = `${BASE_ORIGIN}/opengraph.jpg`;

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function fetchAllWikiPages(client) {
  const { rows } = await client.query(
    `SELECT id, slug, title, body_markdown, tags, related_slugs, sources, updated_at
     FROM wiki_pages
     ORDER BY title ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    bodyMarkdown: r.body_markdown ?? "",
    tags: Array.isArray(r.tags) ? r.tags : [],
    relatedSlugs: Array.isArray(r.related_slugs) ? r.related_slugs : [],
    sources: Array.isArray(r.sources) ? r.sources : [],
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
  }));
}

async function fetchAllSections(client) {
  const { rows } = await client.query(
    `SELECT s.id, s.slug, s.title, s.description, s.display_order,
            sv.body_markdown, sv.key_insights, sv.created_at AS version_created_at
     FROM sections s
     LEFT JOIN section_versions sv ON s.current_version_id = sv.id
     ORDER BY s.display_order ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description ?? "",
    bodyMarkdown: r.body_markdown ?? "",
    keyInsights: Array.isArray(r.key_insights) ? r.key_insights : [],
    lastUpdated: r.version_created_at ? new Date(r.version_created_at).toISOString() : new Date().toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Markdown / text helpers
// ---------------------------------------------------------------------------

function markdownToPlainText(md, max = 160) {
  const plain = md
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*>]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\n+/g, " ")
    .trim();
  const clipped = plain.slice(0, max);
  return clipped.length < plain.length
    ? clipped.replace(/\s+\S*$/, "") + "…"
    : clipped;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToHtml(md) {
  const lines = md.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      out.push(`<h3>${inlineHtml(line.slice(4))}</h3>`);
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      out.push(`<h2>${inlineHtml(line.slice(3))}</h2>`);
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      out.push(`<h1>${inlineHtml(line.slice(2))}</h1>`);
      i++;
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const items = [];
      while (i < lines.length && (lines[i].startsWith("- ") || lines[i].startsWith("* "))) {
        items.push(`<li>${inlineHtml(lines[i].slice(2))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(`<li>${inlineHtml(lines[i].replace(/^\d+\.\s/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (line.startsWith("> ")) {
      out.push(`<blockquote>${inlineHtml(line.slice(2))}</blockquote>`);
      i++;
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    out.push(`<p>${inlineHtml(line)}</p>`);
    i++;
  }
  return out.join("\n");
}

function inlineHtml(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

function patchHead(html, { title, description, canonical, ogImage }) {
  const fullTitle = `${escapeHtml(title)} — ${SITE_NAME}`;
  const desc = escapeHtml(description);
  const absCanonical = canonical.startsWith("http")
    ? canonical
    : `${BASE_ORIGIN}${canonical}`;
  const img = ogImage ?? OG_IMAGE;

  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${fullTitle}</title>`)
    .replace(
      /<meta name="description"[^>]*>/,
      `<meta name="description" content="${desc}" />`
    )
    .replace(
      /<link rel="canonical"[^>]*>/,
      `<link rel="canonical" href="${escapeHtml(absCanonical)}" />`
    )
    .replace(
      /<meta property="og:title"[^>]*>/,
      `<meta property="og:title" content="${fullTitle}" />`
    )
    .replace(
      /<meta property="og:description"[^>]*>/,
      `<meta property="og:description" content="${desc}" />`
    )
    .replace(
      /<meta property="og:url"[^>]*>/,
      `<meta property="og:url" content="${escapeHtml(absCanonical)}" />`
    )
    .replace(
      /<meta property="og:image"[^>]*>/,
      `<meta property="og:image" content="${escapeHtml(img)}" />`
    )
    .replace(
      /<meta name="twitter:title"[^>]*>/,
      `<meta name="twitter:title" content="${fullTitle}" />`
    )
    .replace(
      /<meta name="twitter:description"[^>]*>/,
      `<meta name="twitter:description" content="${desc}" />`
    )
    .replace(
      /<meta name="twitter:image"[^>]*>/,
      `<meta name="twitter:image" content="${escapeHtml(img)}" />`
    );
}

/**
 * Prerender the home route — inject the full knowledge-base link graph so
 * crawlers can discover every wiki page and section from the root URL.
 */
function buildHomeHtml(baseHtml, wikiPages, sections) {
  const wikiLinksHtml = wikiPages
    .map((p) => {
      const tagsStr = p.tags.length ? ` (${p.tags.map(escapeHtml).join(", ")})` : "";
      const excerpt = markdownToPlainText(p.bodyMarkdown, 120);
      return `<li><a href="/wiki/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a>${tagsStr} — ${escapeHtml(excerpt)}</li>`;
    })
    .join("\n");

  const sectionLinksHtml = sections
    .map((s) => {
      const desc = s.description ? ` — ${escapeHtml(s.description.slice(0, 100))}` : "";
      return `<li><a href="/sections/${escapeHtml(s.slug)}">${escapeHtml(s.title)}</a>${desc}</li>`;
    })
    .join("\n");

  const noscript = `<noscript>
  <main>
    <h1>${SITE_NAME}</h1>
    <p>The definitive knowledge base on AI adoption, tools, regulations, and trends in Hong Kong's marketing industry.</p>
    <section>
      <h2>Report Sections</h2>
      <ul>
        ${sectionLinksHtml}
      </ul>
    </section>
    <section>
      <h2>Knowledge Base (${wikiPages.length} pages)</h2>
      <ul>
        ${wikiLinksHtml}
      </ul>
    </section>
  </main>
</noscript>`;

  return baseHtml.replace("</body>", `${noscript}\n</body>`);
}

function buildWikiHtml(baseHtml, page) {
  const description = markdownToPlainText(page.bodyMarkdown, 155);
  const canonical = `/wiki/${page.slug}`;

  let html = patchHead(baseHtml, { title: page.title, description, canonical });

  const tagsHtml = page.tags.length
    ? `<p><strong>Tags:</strong> ${page.tags.map(escapeHtml).join(", ")}</p>`
    : "";

  const relatedHtml = page.relatedSlugs.length
    ? `<nav><strong>Related pages:</strong><ul>${page.relatedSlugs
        .map((s) => `<li><a href="/wiki/${escapeHtml(s)}">${escapeHtml(s)}</a></li>`)
        .join("")}</ul></nav>`
    : "";

  const sourcesHtml = page.sources.length
    ? `<section><strong>Sources:</strong><ul>${page.sources
        .map((src) => `<li>${escapeHtml(src.label)}</li>`)
        .join("")}</ul></section>`
    : "";

  const noscript = `<noscript>
  <article>
    <h1>${escapeHtml(page.title)}</h1>
    ${tagsHtml}
    ${markdownToHtml(page.bodyMarkdown)}
    ${relatedHtml}
    ${sourcesHtml}
    <p><a href="/">← Back to Knowledge Base</a></p>
  </article>
</noscript>`;

  return html.replace("</body>", `${noscript}\n</body>`);
}

function buildSectionHtml(baseHtml, section) {
  const description = section.description
    ? section.description.slice(0, 160)
    : (section.keyInsights[0] ?? markdownToPlainText(section.bodyMarkdown, 155));
  const canonical = `/sections/${section.slug}`;

  let html = patchHead(baseHtml, { title: section.title, description, canonical });

  const insightsHtml = section.keyInsights.length
    ? `<section><strong>Key Insights:</strong><ul>${section.keyInsights
        .map((ins) => `<li>${escapeHtml(ins)}</li>`)
        .join("")}</ul></section>`
    : "";

  const noscript = `<noscript>
  <article>
    <h1>${escapeHtml(section.title)}</h1>
    ${section.description ? `<p>${escapeHtml(section.description)}</p>` : ""}
    ${insightsHtml}
    ${markdownToHtml(section.bodyMarkdown)}
    <p><a href="/">← Back to Knowledge Base</a></p>
  </article>
</noscript>`;

  return html.replace("</body>", `${noscript}\n</body>`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error(
      "[prerender] DATABASE_URL is not set. Prerender requires database access to generate " +
        "static HTML for public routes. Set DATABASE_URL and re-run the build."
    );
  }

  const baseHtml = readFileSync(join(distDir, "index.html"), "utf8");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const [wikiPages, sections] = await Promise.all([
      fetchAllWikiPages(client),
      fetchAllSections(client),
    ]);

    console.log(`[prerender] Found ${wikiPages.length} wiki pages, ${sections.length} sections.`);

    // ---- Home route --------------------------------------------------------
    const homeHtml = buildHomeHtml(baseHtml, wikiPages, sections);
    writeFileSync(join(distDir, "index.html"), homeHtml, "utf8");
    console.log("[prerender] Updated home index.html with full link graph.");

    // ---- Wiki pages --------------------------------------------------------
    for (const page of wikiPages) {
      const dir = join(distDir, "wiki", page.slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.html"), buildWikiHtml(baseHtml, page), "utf8");
    }
    console.log(`[prerender] Wrote ${wikiPages.length} wiki HTML files.`);

    // ---- Sections ----------------------------------------------------------
    for (const section of sections) {
      const dir = join(distDir, "sections", section.slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.html"), buildSectionHtml(baseHtml, section), "utf8");
    }
    console.log(`[prerender] Wrote ${sections.length} section HTML files.`);

    // ---- Validation: spot-check output exists ------------------------------
    const checks = [
      join(distDir, "index.html"),
      ...(wikiPages.length > 0 ? [join(distDir, "wiki", wikiPages[0].slug, "index.html")] : []),
      ...(sections.length > 0 ? [join(distDir, "sections", sections[0].slug, "index.html")] : []),
    ];
    for (const f of checks) {
      readFileSync(f); // throws if missing
    }
    console.log("[prerender] Spot-check passed — key output files verified.");

  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[prerender] Fatal error:", err.message ?? err);
  process.exit(1);
});
