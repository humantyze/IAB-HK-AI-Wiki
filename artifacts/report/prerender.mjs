/**
 * Post-build prerender script.
 *
 * After `vite build` produces dist/public/index.html, this script:
 *  1. Connects to Postgres and fetches all wiki pages and sections.
 *  2. For each public route ( /, /wiki/:slug, /sections/:slug ) it
 *     clones index.html and splices route-specific JSON-LD structured
 *     data into <head> before </head>.
 *  3. Writes the resulting HTML to the correct path inside dist/public
 *     so that static file servers and crawlers see JSON-LD in the
 *     initial response without waiting for JavaScript to execute.
 *
 * The SPA shell (React / wouter) continues to work normally after
 * hydration – these are plain clones of the same index.html.
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "dist", "public");
const INDEX_HTML = path.join(DIST, "index.html");

const ORG = {
  "@type": "Organization",
  name: "IAB Hong Kong",
  url: "https://iabhongkong.com/",
};

const SITE_NAME = "Hong Kong Bible of AI Adoption — State of AI in HK Marketing";
const SITE_DESC =
  "A living knowledge base on AI adoption in Hong Kong marketing, curated by the IAB Hong Kong AI and Technology Committee.";

// ── helpers ──────────────────────────────────────────────────────────────────

function injectJsonLd(html, schemas) {
  const tag = schemas
    .map(
      (s) =>
        `<script type="application/ld+json">\n${JSON.stringify(s, null, 2)}\n</script>`
    )
    .join("\n    ");
  return html.replace("</head>", `    ${tag}\n  </head>`);
}

function writeRoute(basePath, routeSegments, html) {
  const dir = path.join(DIST, ...routeSegments);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
}

function excerpt(markdown) {
  return markdown
    .replace(/^#+\s.*/gm, "")
    .replace(/[*_`]/g, "")
    .trim()
    .slice(0, 200);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn("[prerender] DATABASE_URL not set — skipping JSON-LD prerender.");
    return;
  }

  if (!fs.existsSync(INDEX_HTML)) {
    console.error("[prerender] dist/public/index.html not found — run vite build first.");
    process.exit(1);
  }

  const baseIndexHtml = fs.readFileSync(INDEX_HTML, "utf8");

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // ── fetch wiki pages ──────────────────────────────────────────────────
    const wikiRes = await pool.query(`
      SELECT id, slug, title, tags, related_slugs, sources, created_at, updated_at, body_markdown
      FROM wiki_pages
      ORDER BY title ASC
    `);

    const wikiPages = wikiRes.rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      tags: Array.isArray(r.tags) ? r.tags : [],
      relatedSlugs: Array.isArray(r.related_slugs) ? r.related_slugs : [],
      sources: Array.isArray(r.sources) ? r.sources : [],
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
      excerpt: excerpt(r.body_markdown || ""),
    }));

    // ── fetch sections (joined with current version) ───────────────────────
    const sectionsRes = await pool.query(`
      SELECT
        s.id, s.slug, s.title, s.description, s.display_order,
        sv.key_insights, sv.created_at AS version_created_at
      FROM sections s
      LEFT JOIN section_versions sv ON sv.id = s.current_version_id
      ORDER BY s.display_order ASC
    `);

    const sections = sectionsRes.rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      description: r.description || "",
      keyInsights: Array.isArray(r.key_insights) ? r.key_insights : [],
      lastUpdated:
        r.version_created_at instanceof Date
          ? r.version_created_at.toISOString()
          : r.version_created_at ?? new Date().toISOString(),
    }));

    // The canonical origin is not known at build time (the app is served from
    // a proxied domain). We leave origin empty so IDs are site-relative; most
    // validators and crawlers accept this.  If a CANONICAL_ORIGIN env var is
    // provided (e.g. in a CI deploy step) it will be used.
    const origin = process.env.CANONICAL_ORIGIN ?? "";
    const base = process.env.BASE_PATH?.replace(/\/$/, "") ?? "";
    const root = `${origin}${base}`;

    // ── / — CollectionPage + ItemList ─────────────────────────────────────
    const indexSchemas = [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": `${root}/`,
        url: `${root}/`,
        name: SITE_NAME,
        description: SITE_DESC,
        publisher: ORG,
        hasPart: wikiPages.map((p) => ({
          "@type": "WebPage",
          "@id": `${root}/wiki/${p.slug}`,
          url: `${root}/wiki/${p.slug}`,
          name: p.title,
          ...(p.excerpt ? { description: p.excerpt } : {}),
          dateModified: p.updatedAt,
          ...(p.tags.length > 0 ? { keywords: p.tags.join(", ") } : {}),
        })),
      },
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "Knowledge Base Entries",
        itemListElement: wikiPages.map((p, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${root}/wiki/${p.slug}`,
          name: p.title,
        })),
      },
    ];

    // Overwrite the root index.html in-place (it serves `/`)
    fs.writeFileSync(INDEX_HTML, injectJsonLd(baseIndexHtml, indexSchemas), "utf8");
    console.log("[prerender] / → dist/public/index.html");

    // ── /wiki/:slug — Article + BreadcrumbList ────────────────────────────
    for (const p of wikiPages) {
      const urlCitations = p.sources.filter((s) =>
        /^https?:\/\//i.test(s.ref)
      );
      const schemas = [
        {
          "@context": "https://schema.org",
          "@type": "Article",
          "@id": `${root}/wiki/${p.slug}`,
          url: `${root}/wiki/${p.slug}`,
          headline: p.title,
          dateModified: p.updatedAt,
          datePublished: p.createdAt,
          ...(p.tags.length > 0 ? { keywords: p.tags.join(", ") } : {}),
          publisher: ORG,
          isPartOf: {
            "@type": "CollectionPage",
            "@id": `${root}/`,
            url: `${root}/`,
            name: SITE_NAME,
          },
          ...(urlCitations.length > 0
            ? {
                citation: urlCitations.map((s) => ({
                  "@type": "CreativeWork",
                  name: s.label,
                  url: s.ref,
                })),
              }
            : {}),
          ...(p.relatedSlugs.length > 0
            ? {
                relatedLink: p.relatedSlugs.map((sl) => `${root}/wiki/${sl}`),
              }
            : {}),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: "Knowledge Base",
              item: `${root}/`,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: p.title,
              item: `${root}/wiki/${p.slug}`,
            },
          ],
        },
      ];

      writeRoute(base, ["wiki", p.slug], injectJsonLd(baseIndexHtml, schemas));
      console.log(`[prerender] /wiki/${p.slug}`);
    }

    // ── /sections/:slug — Article + BreadcrumbList ────────────────────────
    for (const sec of sections) {
      const schemas = [
        {
          "@context": "https://schema.org",
          "@type": "Article",
          "@id": `${root}/sections/${sec.slug}`,
          url: `${root}/sections/${sec.slug}`,
          headline: sec.title,
          ...(sec.description ? { description: sec.description } : {}),
          dateModified: sec.lastUpdated,
          datePublished: sec.lastUpdated,
          publisher: ORG,
          isPartOf: {
            "@type": "CollectionPage",
            "@id": `${root}/`,
            url: `${root}/`,
            name: SITE_NAME,
          },
          ...(sec.keyInsights.length > 0
            ? { abstract: sec.keyInsights.join(" ") }
            : {}),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: "Knowledge Base",
              item: `${root}/`,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: sec.title,
              item: `${root}/sections/${sec.slug}`,
            },
          ],
        },
      ];

      writeRoute(base, ["sections", sec.slug], injectJsonLd(baseIndexHtml, schemas));
      console.log(`[prerender] /sections/${sec.slug}`);
    }

    console.log(
      `[prerender] Done — ${wikiPages.length} wiki pages, ${sections.length} sections.`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[prerender] Fatal error:", err);
  process.exit(1);
});
