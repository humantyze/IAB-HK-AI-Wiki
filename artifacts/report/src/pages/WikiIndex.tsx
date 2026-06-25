import React, { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Search, BookOpen, Clock, ChevronRight, Lock, Sparkles, LayoutGrid, Network } from "lucide-react";
import WikiGraph from "../components/WikiGraph";
import { useJsonLd } from "@/lib/useJsonLd";
import { usePageMeta } from "@/hooks/usePageMeta";

interface WikiPageSummary {
  id: number;
  slug: string;
  title: string;
  tags: string[];
  relatedSlugs: string[];
  updatedAt: string;
  excerpt: string;
  imageUrl?: string | null;
}

interface KnowledgeCitation {
  index: number;
  sourceType: string;
  sourceSlug: string | null;
  title: string;
  similarity: number;
}

const ALL_TAGS = ["All", "Organizations", "Statistics", "Tools & Platforms", "Regulatory", "Trends", "Case Studies", "Frameworks"];

const TAG_COLORS: Record<string, string> = {
  "Organizations": "bg-blue-50 text-blue-700 border-blue-100",
  "Statistics": "bg-purple-50 text-purple-700 border-purple-100",
  "Tools & Platforms": "bg-green-50 text-green-700 border-green-100",
  "Regulatory": "bg-orange-50 text-orange-700 border-orange-100",
  "Trends": "bg-red-50 text-red-700 border-red-100",
  "Case Studies": "bg-yellow-50 text-yellow-700 border-yellow-100",
  "Frameworks": "bg-gray-100 text-gray-700 border-gray-200",
};

function useWikiPages() {
  const [data, setData] = useState<WikiPageSummary[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const baseUrl = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
    fetch(`${baseUrl}/api/wiki`, { credentials: "include" })
      .then((r) => r.json())
      .then((result: unknown) => {
        setData(Array.isArray(result) ? (result as WikiPageSummary[]) : []);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setIsLoading(false);
      });
  }, []);

  return { data, isLoading, error };
}

function parseSummaryWithLinks(summary: string, knownSlugs: Set<string>): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const markerRegex = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = markerRegex.exec(summary)) !== null) {
    if (match.index > lastIndex) {
      parts.push(summary.slice(lastIndex, match.index));
    }
    const displayText = match[1].trim();
    const slug = match[2].trim();
    if (knownSlugs.has(slug)) {
      parts.push(
        <Link
          key={`${slug}-${match.index}`}
          href={`/wiki/${slug}`}
          className="font-semibold underline underline-offset-2 decoration-[#D63425]/40 hover:decoration-[#D63425] transition-colors"
          style={{ color: "#D63425" }}
        >
          {displayText}
        </Link>
      );
    } else {
      parts.push(displayText);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < summary.length) {
    parts.push(summary.slice(lastIndex));
  }
  return parts;
}

function renderAnswerWithCitations(answer: string, citations: KnowledgeCitation[]): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const markerRegex = /(\[\d+\])+/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = markerRegex.exec(answer)) !== null) {
    if (match.index > lastIndex) parts.push(answer.slice(lastIndex, match.index));
    const nums = [...match[0].matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1]));
    parts.push(
      <sup key={`cite-${match.index}`} className="ml-0.5">
        {nums.map((n, i) => {
          const cit = citations.find((c) => c.index === n);
          return (
            <a
              key={n}
              href={cit?.sourceSlug ? `#citation-${n}` : undefined}
              className="text-[#D63425] font-bold hover:underline"
              style={{ fontSize: "0.68em" }}
            >
              {i > 0 ? "," : ""}[{n}]
            </a>
          );
        })}
      </sup>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < answer.length) parts.push(answer.slice(lastIndex));
  return parts;
}

export default function WikiIndex() {
  const { data: pages, isLoading } = useWikiPages();
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState("All");
  const [activeQuery, setActiveQuery] = useState("");
  const [aiResults, setAiResults] = useState<WikiPageSummary[] | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [searchFallbackPages, setSearchFallbackPages] = useState<WikiPageSummary[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [ragAnswer, setRagAnswer] = useState<string | null>(null);
  const [ragCitations, setRagCitations] = useState<KnowledgeCitation[] | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "graph">("grid");
  const [graphFilteredPages, setGraphFilteredPages] = useState<WikiPageSummary[]>([]);
  const graphDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const baseUrl = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  usePageMeta({
    title: "Knowledge Base",
    description: "Explore the State of AI in HK Marketing knowledge base — the definitive resource on AI adoption, tools, regulations, and trends in Hong Kong's marketing industry.",
    canonical: "/",
    ogType: "website",
  });

  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();

    setAiResults(null);
    setAiSummary(null);
    setSearchFallbackPages(null);
    setRagAnswer(null);
    setRagCitations(null);

    if (activeQuery.trim().length < 3) {
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const fetchOpts = (body: object) => ({
      method: "POST" as const,
      headers: { "Content-Type": "application/json" },
      credentials: "include" as const,
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    (async () => {
      try {
        const [searchSettled, ragSettled] = await Promise.allSettled([
          fetch(`${baseUrl}/api/wiki/search`, fetchOpts({ query: activeQuery.trim() })),
          fetch(`${baseUrl}/api/knowledge/search`, fetchOpts({ query: activeQuery.trim() })),
        ]);

        if (searchSettled.status === "fulfilled" && searchSettled.value.ok) {
          const result = await searchSettled.value.json() as { ranked: boolean; pages: WikiPageSummary[]; summary?: string };
          if (result.ranked && Array.isArray(result.pages)) {
            setAiResults(result.pages);
            setAiSummary(result.summary && result.summary.trim().length > 0 ? result.summary.trim() : null);
            setSearchFallbackPages(null);
          } else {
            setAiResults(null);
            setAiSummary(null);
            setSearchFallbackPages(Array.isArray(result.pages) ? result.pages : null);
          }
        } else if (searchSettled.status === "rejected" && (searchSettled.reason as Error).name !== "AbortError") {
          setAiResults(null);
          setAiSummary(null);
          setSearchFallbackPages(null);
        }

        if (ragSettled.status === "fulfilled" && ragSettled.value.ok) {
          const rag = await ragSettled.value.json() as { answer: string | null; grounded: boolean; citations: KnowledgeCitation[] };
          if (rag.answer && rag.answer.trim().length > 0) {
            setRagAnswer(rag.answer.trim());
            setRagCitations(rag.citations ?? []);
          } else {
            setRagAnswer(null);
            setRagCitations(null);
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setAiResults(null);
          setAiSummary(null);
          setSearchFallbackPages(null);
          setRagAnswer(null);
          setRagCitations(null);
        }
      } finally {
        if (abortRef.current === controller) setIsSearching(false);
      }
    })();

    return () => { abortRef.current?.abort(); };
  }, [activeQuery, baseUrl]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length >= 3) setActiveQuery(trimmed);
  };

  const basePages = aiResults !== null ? aiResults : (searchFallbackPages ?? pages ?? []);


  const filtered = basePages.filter((p) => {
    const matchesTag = activeTag === "All" || p.tags.includes(activeTag);
    if (aiResults !== null) return matchesTag;
    const q = query.toLowerCase();
    const matchesQuery = !q || p.title.toLowerCase().includes(q) || p.excerpt.toLowerCase().includes(q);
    return matchesTag && matchesQuery;
  });

  const filteredSlugsKey = filtered.map((p) => p.slug).sort().join(",");

  const graphFirstPopulated = useRef(false);
  useEffect(() => {
    if (!graphFirstPopulated.current && filtered.length > 0) {
      graphFirstPopulated.current = true;
      setGraphFilteredPages(filtered);
      return;
    }
    if (graphDebounceRef.current) clearTimeout(graphDebounceRef.current);
    graphDebounceRef.current = setTimeout(() => {
      setGraphFilteredPages(filtered);
    }, 400);
    return () => {
      if (graphDebounceRef.current) clearTimeout(graphDebounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSlugsKey]);

  const usingAI = aiResults !== null && activeQuery.trim().length >= 3;

  const canonicalOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const indexSchema = pages && pages.length > 0 ? {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${canonicalOrigin}${baseUrl}/`,
        "url": `${canonicalOrigin}${baseUrl}/`,
        "name": "Hong Kong Bible of AI Adoption — State of AI in HK Marketing",
        "description": "A living knowledge base on AI adoption in Hong Kong marketing, curated by the IAB Hong Kong AI and Technology Committee.",
        "publisher": {
          "@type": "Organization",
          "name": "IAB Hong Kong",
          "url": "https://iabhongkong.com/",
        },
        "hasPart": pages.map((p) => ({
          "@type": "WebPage",
          "@id": `${canonicalOrigin}${baseUrl}/wiki/${p.slug}`,
          "url": `${canonicalOrigin}${baseUrl}/wiki/${p.slug}`,
          "name": p.title,
          ...(p.excerpt ? { "description": p.excerpt } : {}),
          "dateModified": p.updatedAt,
          ...(p.tags.length > 0 ? { "keywords": p.tags.join(", ") } : {}),
        })),
      },
      {
        "@type": "ItemList",
        "name": "Knowledge Base Entries",
        "itemListElement": pages.map((p, i) => ({
          "@type": "ListItem",
          "position": i + 1,
          "url": `${canonicalOrigin}${baseUrl}/wiki/${p.slug}`,
          "name": p.title,
        })),
      },
    ],
  } : null;

  useJsonLd(indexSchema);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  };

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Montserrat', sans-serif" }}>
      <div style={{ backgroundColor: "#D63425" }} className="h-1 w-full" />
      {/* Header */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-4 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <a href="https://iabhongkong.com/" target="_blank" rel="noopener noreferrer">
              <img
                src={`${(import.meta.env.BASE_URL as string)}iabhk-logo.png`}
                alt="IAB Hong Kong"
                style={{ height: "32px", width: "auto" }}
              />
            </a>
          </div>
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-gray-200 text-sm">|</span>
            <span className="text-sm font-semibold text-gray-700">Welcome to the Interactive Advertising Bureau Hong Kong</span>
          </div>
          <nav className="flex gap-5 ml-auto text-xs font-medium text-gray-500">
            <Link href="/admin/login" className="flex items-center gap-1.5 hover:text-gray-800 transition-colors">
              <Lock size={11} />
              <span>Contributor Access</span>
            </Link>
          </nav>
        </div>
      </header>
      {/* Hero */}
      <div className="max-w-6xl mx-auto px-6 lg:px-8 pt-12 pb-8">
        <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#D63425" }}>
          IAB Hong Kong · State of AI in Marketing
        </p>
        <h1 className="text-3xl font-bold text-gray-800 mb-3" style={{ letterSpacing: "-0.5px" }}>HONG KONG BIBLE OF AI ADOPTION</h1>
        <p className="text-sm text-gray-500 max-w-2xl leading-relaxed">Welcome to the iAB Hong Kong State of AI Knowledge Base! An initiative of the 2026 AI and Technology Committee, this platform is designed as a living knowledge resource inspired by the "Second Brain" concept popularized by Andrej Karpathy. As new material is submitted, our language model reviews it in full, identifies key entities and ideas, and creates or updates relevant wiki pages. It also refines topic summaries, builds cross-links across related subjects, and flags inconsistencies, helping each new source strengthen an evolving, interconnected knowledge graph.</p>

        {/* Search */}
        <form onSubmit={handleSubmit} className="mt-6 flex items-center gap-2 max-w-xl">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Ask anything — e.g. 'how are HK marketers using AI?'"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-gray-400 text-gray-700 placeholder-gray-400"
            />
          </div>
          <button
            type="submit"
            disabled={isSearching || query.trim().length < 3}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-lg transition-all shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: "#D63425", color: "#fff" }}
          >
            {isSearching ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Sparkles size={13} />
            )}
            <span>Ask</span>
          </button>
        </form>
      </div>
      {/* Tag filters + count row */}
      <div className="max-w-6xl mx-auto px-6 lg:px-8">
        <div className="flex flex-wrap gap-2 mb-4">
          {ALL_TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(tag)}
              className="text-xs px-3 py-1 rounded-full border font-medium transition-all"
              style={
                activeTag === tag
                  ? { backgroundColor: "#D63425", color: "#fff", borderColor: "#D63425" }
                  : { backgroundColor: "#fff", color: "#6b7280", borderColor: "#e5e7eb" }
              }
            >
              {tag}
            </button>
          ))}
        </div>

        <div className="border-t border-gray-100 pt-4 pb-2 flex items-center justify-between">
          {isLoading ? (
            <span className="text-xs text-gray-400">Loading…</span>
          ) : (
            <span className="text-xs text-gray-400 font-medium">
              {filtered.length} {filtered.length === 1 ? "page" : "pages"}
              {activeTag !== "All" ? ` · ${activeTag}` : ""}
            </span>
          )}
          <div className="flex items-center gap-3">
            {usingAI && !isSearching && (
              <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#D63425" }}>
                <Sparkles size={10} />
                AI ranked
              </span>
            )}
            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors"
                style={viewMode === "grid" ? { backgroundColor: "#D63425", color: "#fff" } : { backgroundColor: "#fff", color: "#6b7280" }}
                title="Grid view"
              >
                <LayoutGrid size={13} />
                <span>Grid</span>
              </button>
              <button
                onClick={() => setViewMode("graph")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors border-l border-gray-200"
                style={viewMode === "graph" ? { backgroundColor: "#D63425", color: "#fff" } : { backgroundColor: "#fff", color: "#6b7280" }}
                title="Graph view"
              >
                <Network size={13} />
                <span>Graph</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* AI answer panel */}
      {activeQuery.trim().length >= 3 && !isSearching && (ragAnswer || aiSummary) && (
        <div className="max-w-6xl mx-auto px-6 lg:px-8 mb-6">
          <div className="rounded-xl border border-[#D63425]/15 bg-[#fff8f7] overflow-hidden">
            {/* Panel header */}
            <div className="px-5 py-2.5 border-b border-[#D63425]/10 flex items-center gap-2 bg-[#D63425]/5">
              <Sparkles size={11} style={{ color: "#D63425" }} />
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#D63425" }}>AI Answer</span>
            </div>

            <div className="px-5 py-4">
              {ragAnswer ? (
                <>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {renderAnswerWithCitations(ragAnswer, ragCitations ?? [])}
                  </p>
                  {ragCitations && ragCitations.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[#D63425]/10 flex flex-wrap gap-2">
                      {ragCitations.map((c) => (
                        <a
                          key={c.index}
                          id={`citation-${c.index}`}
                          href={c.sourceSlug ? `${baseUrl}/wiki/${c.sourceSlug}` : undefined}
                          className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            c.sourceSlug
                              ? "border-[#D63425]/20 bg-white hover:bg-[#D63425]/5 hover:border-[#D63425]/40 cursor-pointer"
                              : "border-gray-200 bg-white cursor-default"
                          }`}
                          style={{ color: c.sourceSlug ? "#D63425" : "#9ca3af" }}
                        >
                          <span className="font-bold text-[10px] opacity-60">[{c.index}]</span>
                          <span className="truncate max-w-[180px]">{c.title}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </>
              ) : aiSummary ? (
                <p className="text-sm text-gray-700 leading-relaxed">
                  {parseSummaryWithLinks(
                    aiSummary,
                    new Set([
                      ...(pages ?? []).map((p) => p.slug),
                      ...(aiResults ?? []).map((p) => p.slug),
                      ...(searchFallbackPages ?? []).map((p) => p.slug),
                    ])
                  )}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}
      {/* Card grid or Graph view */}
      <div className="max-w-6xl mx-auto px-6 lg:px-8 pb-20">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-2 border-[#D63425]/20 border-t-[#D63425] rounded-full animate-spin" />
          </div>
        ) : viewMode === "graph" ? (
          <WikiGraph
            pages={graphFilteredPages}
            allPages={pages ?? []}
          />
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <BookOpen size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {pages?.length === 0
                ? "No wiki pages yet. Use the admin panel to build the wiki from existing sections."
                : "No pages match your search."}
            </p>
          </div>
        ) : (
          <div>
            {ragAnswer && !isSearching && (
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">Related pages</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((page) => {
              const imgSrc = page.imageUrl
                ? `${baseUrl}/api/wiki-image?path=${encodeURIComponent(page.imageUrl)}`
                : null;
              return (
                <Link key={page.slug} href={`/wiki/${page.slug}`}>
                  <div className="group border border-gray-100 rounded-xl bg-white hover:border-gray-300 hover:shadow-sm transition-all flex flex-col cursor-pointer h-full overflow-hidden">
                    {imgSrc && (
                      <div className="w-full h-36 overflow-hidden bg-gray-50 flex-shrink-0">
                        <img
                          src={imgSrc}
                          alt=""
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                          onError={(e) => { (e.currentTarget.parentElement as HTMLElement | null)?.remove(); }}
                        />
                      </div>
                    )}
                    <div className="p-5 flex flex-col gap-3 flex-1">
                      <div className="flex flex-wrap gap-1.5">
                        {page.tags.map((tag) => (
                          <span
                            key={tag}
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${TAG_COLORS[tag] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
                          >
                            {tag}
                          </span>
                        ))}
                        {page.tags.length === 0 && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-gray-100 text-gray-500 border-gray-200">
                            General
                          </span>
                        )}
                      </div>

                      <div>
                        <h3 className="text-sm font-bold text-gray-800 group-hover:text-[#D63425] transition-colors leading-snug mb-1.5">
                          {page.title}
                        </h3>
                        <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">
                          {page.excerpt || "No description available."}
                        </p>
                      </div>

                      <div className="mt-auto flex items-center justify-between pt-2 border-t border-gray-50">
                        <div className="flex items-center gap-1 text-gray-400">
                          <Clock size={10} />
                          <span className="text-[10px]">{formatDate(page.updatedAt)}</span>
                        </div>
                        <ChevronRight size={12} className="text-gray-300 group-hover:text-[#D63425] transition-colors" />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
            </div>
          </div>
        )}
      </div>
      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 px-6 bg-[#fafafa]">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="text-xs text-gray-400 font-medium uppercase tracking-widest">IAB HK · State of AI in Marketing</span>
          <div className="flex items-center gap-5">
            <span className="text-xs text-gray-400">
              Created by{" "}
              <a
                href="https://humantyze.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold hover:text-[#D63425] transition-colors"
              >
                Humantyze
              </a>
            </span>
            <Link href="/admin" className="text-xs text-gray-400 hover:text-[#D63425] transition-colors uppercase tracking-widest font-medium flex items-center gap-1.5">
              <Lock size={10} />
              Contributor Access
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
