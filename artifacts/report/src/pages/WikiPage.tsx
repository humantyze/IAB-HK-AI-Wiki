import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "wouter";
import { BookOpen, ArrowLeft, Clock, FileText, ChevronRight, ExternalLink, Lock, AlignLeft, Share2 } from "lucide-react";
import { ShareInsightDialog } from "@/components/ShareInsightDialog";
import { extractInsights, fallbackInsight, type Insight } from "@/lib/insights";
import { useJsonLd } from "@/lib/useJsonLd";
import { usePageMeta, markdownToPlainText } from "@/hooks/usePageMeta";

interface WikiPageData {
  id: number;
  slug: string;
  title: string;
  bodyMarkdown: string;
  tags: string[];
  relatedSlugs: string[];
  sources: Array<{ label: string; ref: string }>;
  imageUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RelatedPage {
  slug: string;
  title: string;
  tags: string[];
  excerpt: string;
}

const TAG_COLORS: Record<string, string> = {
  "Organizations": "bg-blue-50 text-blue-700 border-blue-100",
  "Statistics": "bg-purple-50 text-purple-700 border-purple-100",
  "Tools & Platforms": "bg-green-50 text-green-700 border-green-100",
  "Regulatory": "bg-orange-50 text-orange-700 border-orange-100",
  "Trends": "bg-red-50 text-red-700 border-red-100",
  "Case Studies": "bg-yellow-50 text-yellow-700 border-yellow-100",
  "Frameworks": "bg-gray-100 text-gray-700 border-gray-200",
};

function extractHeadings(markdown: string): Array<{ id: string; text: string; level: 2 | 3 }> {
  const lines = markdown.split("\n");
  const headings: Array<{ id: string; text: string; level: 2 | 3 }> = [];
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)/);
    const h3 = line.match(/^###\s+(.+)/);
    if (h2) {
      const text = h2[1].trim();
      headings.push({ id: text.toLowerCase().replace(/[^a-z0-9]+/g, "-"), text, level: 2 });
    } else if (h3) {
      const text = h3[1].trim();
      headings.push({ id: text.toLowerCase().replace(/[^a-z0-9]+/g, "-"), text, level: 3 });
    }
  }
  return headings;
}

function renderMarkdown(markdown: string): React.ReactNode[] {
  const lines = markdown.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const inlineRender = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[([^\]]+)\]\(([^)]+)\))/g);
    return parts.filter((part): part is string => part != null).map((part, j) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={j} className="font-semibold text-gray-800">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={j} className="bg-gray-100 text-gray-700 px-1 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
      }
      const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const href = /^https?:\/\//i.test(linkMatch[2]) ? linkMatch[2] : null;
        if (!href) return <span key={j} className="underline underline-offset-2" style={{ color: "#D63425" }}>{linkMatch[1]}</span>;
        return <a key={j} href={href} className="underline underline-offset-2" style={{ color: "#D63425" }} rel="noopener noreferrer">{linkMatch[1]}</a>;
      }
      return part;
    });
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      const text = line.slice(4);
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      nodes.push(
        <h3 key={key++} id={id} className="text-sm font-bold text-gray-800 mt-6 mb-2 scroll-mt-20" style={{ letterSpacing: "-0.1px" }}>
          {inlineRender(text)}
        </h3>
      );
    } else if (line.startsWith("## ")) {
      const text = line.slice(3);
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      nodes.push(
        <h2 key={key++} id={id} className="text-base font-bold text-gray-800 mt-8 mb-3 scroll-mt-20" style={{ letterSpacing: "-0.2px" }}>
          {inlineRender(text)}
        </h2>
      );
    } else if (line.startsWith("# ")) {
      const text = line.slice(2);
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      nodes.push(
        <h1 key={key++} id={id} className="text-xl font-bold text-gray-800 mt-8 mb-4 scroll-mt-20">
          {inlineRender(text)}
        </h1>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      const listItems: string[] = [];
      while (i < lines.length && (lines[i].startsWith("- ") || lines[i].startsWith("* "))) {
        listItems.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <ul key={key++} className="space-y-1.5 mb-4 pl-1">
          {listItems.map((item, j) => (
            <li key={j} className="flex items-start gap-2 text-sm text-gray-600 leading-relaxed">
              <span className="mt-2 w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: "#D63425" }} />
              <span>{inlineRender(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    } else if (line.match(/^\d+\.\s/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        listItems.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      nodes.push(
        <ol key={key++} className="list-decimal list-inside space-y-2 mb-4">
          {listItems.map((item, j) => (
            <li key={j} className="text-sm text-gray-600 leading-relaxed">
              {inlineRender(item)}
            </li>
          ))}
        </ol>
      );
      continue;
    } else if (line.startsWith("> ")) {
      nodes.push(
        <blockquote key={key++} className="border-l-4 pl-4 py-1 mb-4 italic text-sm text-gray-500" style={{ borderColor: "#D63425" }}>
          {inlineRender(line.slice(2))}
        </blockquote>
      );
    } else if (line.startsWith("---")) {
      nodes.push(<hr key={key++} className="border-gray-100 my-6" />);
    } else if (line.trim() !== "") {
      nodes.push(
        <p key={key++} className="text-sm text-gray-600 leading-relaxed mb-4">
          {inlineRender(line)}
        </p>
      );
    }

    i++;
  }

  return nodes;
}


function useWikiPage(slug: string) {
  const [page, setPage] = useState<WikiPageData | null>(null);
  const [related, setRelated] = useState<RelatedPage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    const baseUrl = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
    setIsLoading(true);
    setNotFound(false);
    setIsError(false);

    const pagePromise = fetch(`${baseUrl}/api/wiki/${slug}`, { credentials: "include" })
      .then((r) => {
        if (r.status === 404) { setNotFound(true); setIsLoading(false); return null; }
        return r.json() as Promise<WikiPageData>;
      })
      .catch(() => { setIsError(true); setIsLoading(false); return null; });

    const embeddingRelatedPromise = fetch(`${baseUrl}/api/wiki/${slug}/related`, { credentials: "include" })
      .then((r) => r.ok ? r.json() as Promise<RelatedPage[]> : [])
      .catch(() => [] as RelatedPage[]);

    Promise.all([pagePromise, embeddingRelatedPromise])
      .then(([data, embeddingRelated]) => {
        if (!data) return;
        setPage(data);

        if (embeddingRelated.length > 0) {
          setRelated(embeddingRelated);
          return;
        }

        // Fallback: filter by relatedSlugs from the same upload batch
        if (data.relatedSlugs?.length > 0) {
          return fetch(`${baseUrl}/api/wiki`, { credentials: "include" })
            .then((r) => r.json() as Promise<RelatedPage[]>)
            .then((all) => {
              const related = all.filter((p) => data.relatedSlugs.includes(p.slug)).slice(0, 5);
              setRelated(related);
            });
        }
      })
      .finally(() => setIsLoading(false));
  }, [slug]);

  return { page, related, isLoading, notFound, isError };
}

interface WikiPageProps {
  params: { slug: string };
}

export default function WikiPage({ params }: WikiPageProps) {
  const { slug } = params;
  const { page, related, isLoading, notFound, isError } = useWikiPage(slug);
  const [activeHeading, setActiveHeading] = useState<string>("");
  const [shareOpen, setShareOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const headings = page ? extractHeadings(page.bodyMarkdown) : [];
  const extracted = page ? extractInsights(page.bodyMarkdown) : [];
  const insights: Insight[] = page
    ? extracted.length
      ? extracted
      : [fallbackInsight(page.title, page.bodyMarkdown)]
    : [];
  const baseUrl = (import.meta.env.BASE_URL as string);

  const canonicalOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const baseNoSlash = baseUrl.replace(/\/$/, "");
  const wikiPageSchema = page ? {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${canonicalOrigin}${baseNoSlash}/wiki/${page.slug}`,
        "url": `${canonicalOrigin}${baseNoSlash}/wiki/${page.slug}`,
        "headline": page.title,
        "dateModified": page.updatedAt,
        "datePublished": page.createdAt,
        ...(page.tags.length > 0 ? { "keywords": page.tags.join(", ") } : {}),
        "publisher": {
          "@type": "Organization",
          "name": "IAB Hong Kong",
          "url": "https://iabhongkong.com/",
        },
        "isPartOf": {
          "@type": "CollectionPage",
          "@id": `${canonicalOrigin}${baseNoSlash}/`,
          "url": `${canonicalOrigin}${baseNoSlash}/`,
          "name": "Hong Kong Bible of AI Adoption — HK AI Marketing Playbook",
        },
        ...(page.sources.some((s) => /^https?:\/\//i.test(s.ref)) ? {
          "citation": page.sources
            .filter((s) => /^https?:\/\//i.test(s.ref))
            .map((s) => ({ "@type": "CreativeWork", "name": s.label, "url": s.ref })),
        } : {}),
        ...(related.length > 0 ? {
          "relatedLink": related.map((r) => `${canonicalOrigin}${baseNoSlash}/wiki/${r.slug}`),
        } : {}),
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          {
            "@type": "ListItem",
            "position": 1,
            "name": "Knowledge Base",
            "item": `${canonicalOrigin}${baseNoSlash}/`,
          },
          {
            "@type": "ListItem",
            "position": 2,
            "name": page.title,
            "item": `${canonicalOrigin}${baseNoSlash}/wiki/${page.slug}`,
          },
        ],
      },
    ],
  } : null;

  useJsonLd(wikiPageSchema);

  const pageMeta = useMemo(() => {
    if (!page) return null;
    return {
      title: page.title,
      description: markdownToPlainText(page.bodyMarkdown, 155),
      canonical: `/wiki/${page.slug}`,
    };
  }, [page?.title, page?.slug, page?.bodyMarkdown]);

  usePageMeta(pageMeta);

  useEffect(() => {
    if (!headings.length) return;

    const handleScroll = () => {
      let current = headings[0]?.id ?? "";
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top <= 120) {
          current = h.id;
        }
      }
      setActiveHeading(current);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [headings]);

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center" style={{ fontFamily: "'Montserrat', sans-serif" }}>
        <div className="w-8 h-8 border-2 border-[#D63425]/20 border-t-[#D63425] rounded-full animate-spin" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center" style={{ fontFamily: "'Montserrat', sans-serif" }}>
        <div className="text-center">
          <p className="text-gray-400 text-sm mb-4">Something went wrong — try refreshing the page.</p>
          <Link href="/" className="text-xs font-semibold" style={{ color: "#D63425" }}>← Back to Knowledge Base</Link>
        </div>
      </div>
    );
  }

  if (notFound || !page) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center" style={{ fontFamily: "'Montserrat', sans-serif" }}>
        <div className="text-center">
          <p className="text-gray-400 text-sm mb-4">Page not found.</p>
          <Link href="/" className="text-xs font-semibold" style={{ color: "#D63425" }}>← Back to Knowledge Base</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Montserrat', sans-serif" }}>
      <div style={{ backgroundColor: "#D63425" }} className="h-1 w-full" />

      {/* Header */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-4 flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 group">
            <img
              src={`${(import.meta.env.BASE_URL as string)}iabhk-logo.png`}
              alt="IAB Hong Kong"
              style={{ height: "32px", width: "auto" }}
            />
          </Link>
          <Link href="/" className="flex items-center gap-1.5 ml-2 group">
            <span className="text-gray-200 text-sm">|</span>
            <BookOpen size={14} style={{ color: "#D63425" }} />
            <span className="text-sm font-semibold text-gray-700 group-hover:text-[#D63425] transition-colors">Knowledge Base</span>
          </Link>
          <nav className="flex gap-5 ml-auto text-xs font-medium text-gray-500">
            <Link href="/admin/login" className="flex items-center gap-1.5 hover:text-gray-800 transition-colors">
              <Lock size={11} />
              <span>Admin</span>
            </Link>
          </nav>
        </div>
      </header>

      {/* Breadcrumb */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={12} />
          <span>All Pages</span>
        </Link>
      </div>

      {/* Layout */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col lg:flex-row gap-6 lg:gap-10">
        {/* Main content */}
        <main ref={contentRef} className="flex-1 min-w-0 w-full">
          {/* Page header */}
          <div className="mb-6">
            <div className="flex flex-wrap gap-1.5 mb-3">
              {page.tags.map((tag) => (
                <span
                  key={tag}
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${TAG_COLORS[tag] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
                >
                  {tag}
                </span>
              ))}
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2" style={{ letterSpacing: "-0.5px" }}>
              {page.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Clock size={11} />
                Updated {formatDate(page.updatedAt)}
              </span>
              {page.sources.length > 0 && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <FileText size={11} />
                    {page.sources.length} {page.sources.length === 1 ? "source" : "sources"}
                  </span>
                </>
              )}
              {insights.length > 0 && (
                <>
                  <span>·</span>
                  <button
                    onClick={() => setShareOpen(true)}
                    className="flex items-center gap-1.5 font-semibold transition-colors hover:opacity-80"
                    style={{ color: "#D63425" }}
                  >
                    <Share2 size={11} />
                    Share insight
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="h-px bg-gray-100 mb-6" />

          {/* Header image — only shown when the wiki page has an associated graphic */}
          {page.imageUrl && (
            <div className="mb-6 rounded-xl overflow-hidden border border-gray-100 bg-gray-50">
              <img
                src={`${(import.meta.env.BASE_URL as string).replace(/\/$/, "")}/api/wiki-image?path=${encodeURIComponent(page.imageUrl)}`}
                alt={page.title}
                className="w-full max-h-72 object-contain"
                loading="lazy"
                onError={(e) => { (e.currentTarget.parentElement as HTMLElement | null)?.remove(); }}
              />
            </div>
          )}

          {/* Body */}
          <div className="max-w-none">
            {renderMarkdown(page.bodyMarkdown)}
          </div>
        </main>

        {/* Sidebar */}
        <aside className="w-full lg:w-56 lg:flex-shrink-0">
          <div className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto space-y-0">

          {/* On this page — TOC (hidden on mobile since it's not sticky there) */}
          {headings.length > 0 && (
            <div className="hidden lg:block mb-8">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
                <AlignLeft size={10} />
                On This Page
              </h3>
              <nav className="space-y-0.5">
                {headings.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="block w-full text-left py-1 transition-colors"
                    style={{
                      color: activeHeading === h.id ? "#D63425" : "#9ca3af",
                      fontSize: "11px",
                      fontWeight: activeHeading === h.id ? 600 : 400,
                      borderLeft: activeHeading === h.id ? "2px solid #D63425" : "2px solid transparent",
                      paddingLeft: h.level === 3 ? "14px" : "8px",
                      paddingTop: "4px",
                      paddingBottom: "4px",
                    }}
                  >
                    {h.text}
                  </button>
                ))}
              </nav>
            </div>
          )}

          {/* Related pages */}
          {related.length > 0 && (
            <div className="mb-8">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
                <BookOpen size={10} />
                Related Pages
              </h3>
              <div className="space-y-2">
                {related.map((rel) => (
                  <Link key={rel.slug} href={`/wiki/${rel.slug}`}>
                    <div className="group flex items-start gap-2 p-2.5 rounded-lg border border-gray-100 hover:border-gray-200 bg-white hover:bg-gray-50 transition-all cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-700 group-hover:text-[#D63425] transition-colors leading-snug">
                          {rel.title}
                        </p>
                        {rel.tags?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {rel.tags.slice(0, 2).map((t) => (
                              <span key={t} className="text-[9px] text-gray-400 font-medium">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <ChevronRight size={11} className="text-gray-300 group-hover:text-[#D63425] flex-shrink-0 mt-0.5 transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Sources */}
          {page.sources.length > 0 && (
            <div className="mb-8">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
                <FileText size={10} />
                Sources
              </h3>
              <div className="space-y-2">
                {page.sources.map((src, i) => {
                  const isUrl = /^https?:\/\//i.test(src.ref);

                  if (isUrl) {
                    return (
                      <div key={i} className="p-2.5 rounded-lg border border-gray-100 bg-gray-50">
                        <p className="text-xs font-semibold text-gray-700 leading-snug mb-0.5">{src.label}</p>
                        <a
                          href={src.ref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] break-all hover:underline"
                          style={{ color: "#D63425" }}
                        >
                          {src.ref}
                        </a>
                      </div>
                    );
                  }

                  return (
                    <div key={i}>
                      <p className="text-xs font-semibold text-gray-700 leading-snug">{src.label}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{src.ref}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Back link */}
          <div className="pt-4 border-t border-gray-100">
            <Link href="/">
              <span
                className="flex items-center gap-2 text-xs font-semibold transition-colors cursor-pointer"
                style={{ color: "#D63425" }}
              >
                <ExternalLink size={12} />
                <span>All Wiki Pages</span>
              </span>
            </Link>
          </div>

          </div>
        </aside>
      </div>

      <ShareInsightDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        title={page.title}
        tag={page.tags[0] ?? "Insight"}
        source={page.sources[0]?.label}
        insights={insights}
        logoSrc={`${baseUrl}iabhk-logo.png`}
      />
    </div>
  );
}
