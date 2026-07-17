import React, { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Search, BookOpen, Clock, ChevronRight, Lock, Sparkles, LayoutGrid, Network, X, Lightbulb } from "lucide-react";
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
  synthesized?: boolean;
  responsibleAi?: boolean;
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

function renderInlineWithCitations(text: string, citations: KnowledgeCitation[], keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const markerRegex = /(\[\d+\])+/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = markerRegex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const nums = [...match[0].matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1]));
    parts.push(
      <sup key={`${keyPrefix}-cite-${match.index}`} className="ml-0.5">
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
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function renderAnswerWithCitations(answer: string, citations: KnowledgeCitation[]): React.ReactNode[] {
  // Split on blank lines into paragraphs; render each as its own <p> so the
  // prose reads naturally even if the model emits multiple sentences.
  const paragraphs = answer.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length <= 1) {
    return renderInlineWithCitations(answer, citations, "p0");
  }
  return paragraphs.map((para, i) => (
    <p key={i} className={i > 0 ? "mt-3" : undefined}>
      {renderInlineWithCitations(para, citations, `p${i}`)}
    </p>
  ));
}

// 10 questions verified to have rich RAG answers (ranked by token depth).
const FALLBACK_QUESTIONS = [
  "How does the Ad Context Protocol work?",
  "What is the Agentic Real-Time Framework?",
  "What problem does the Prebid Sales Agent solve?",
  "How do AI agents negotiate media deals?",
  "What is the Agentic Advertising Organization?",
  "How are walled gardens affecting programmatic advertising?",
  "What is NBCUniversal doing with agentic automation?",
  "What did the PubMatic–Butler/Till–Geloso PoC show?",
  "What is PubMatic forecasting for agentic execution?",
  "How many marketers want agentic media buying?",
];

function pickThree(pool: string[], exclude: string[] = []): string[] {
  const available = pool.filter((q) => !exclude.includes(q));
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(3, shuffled.length));
}

function useQuestionPool(): string[] {
  const [pool, setPool] = React.useState<string[]>(FALLBACK_QUESTIONS);
  React.useEffect(() => {
    const baseUrl = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
    fetch(`${baseUrl}/api/knowledge/questions`, { credentials: "include" })
      .then((r) => r.json())
      .then((data: unknown) => {
        const qs = (data as { questions?: string[] }).questions;
        if (Array.isArray(qs) && qs.length >= 3) {
          setPool(qs);
        }
      })
      .catch(() => { /* stay on fallback */ });
  }, []);
  return pool;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface SearchCacheEntry {
  ragAnswer: string | null;
  ragCitations: KnowledgeCitation[] | null;
  ragGrounded: boolean;
  aiResults: WikiPageSummary[] | null;
  aiSummary: string | null;
  searchFallbackPages: WikiPageSummary[] | null;
  cachedAt: number;
}
const searchCache = new Map<string, SearchCacheEntry>();

export default function WikiIndex() {
  const { data: pages, isLoading } = useWikiPages();
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const [activeTag, setActiveTag] = useState("All");
  const [activeQuery, setActiveQuery] = useState(() => {
    const q = new URLSearchParams(window.location.search).get("q") ?? "";
    return q.length >= 3 ? q : "";
  });
  const [aiResults, setAiResults] = useState<WikiPageSummary[] | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [searchFallbackPages, setSearchFallbackPages] = useState<WikiPageSummary[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [ragAnswer, setRagAnswer] = useState<string | null>(null);
  const [ragCitations, setRagCitations] = useState<KnowledgeCitation[] | null>(null);
  const [ragGrounded, setRagGrounded] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const questionPool = useQuestionPool();
  const [shownQuestions, setShownQuestions] = useState<string[]>(() => pickThree(FALLBACK_QUESTIONS));
  const [suggestedFollowUps, setSuggestedFollowUps] = useState<string[]>([]);
  const [isRagStreaming, setIsRagStreaming] = useState(false);
  const [searchError, setSearchError] = useState(false);
  // citationAnimGen[n]: 0 = not yet seen, 1 = first reveal (pop-in), 2+ = re-referenced (pulse)
  const [citationAnimGen, setCitationAnimGen] = useState<Record<number, number>>({});
  const [responsibleAiOnly, setResponsibleAiOnly] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "graph">("grid");
  const [graphFilteredPages, setGraphFilteredPages] = useState<WikiPageSummary[]>([]);
  const graphDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Refs for animation tracking (synchronous, no stale-closure risk)
  const streamedTextRef = useRef("");
  const knownCitCountRef = useRef<Record<number, number>>({});
  const citationAnimGenRef = useRef<Record<number, number>>({});
  // RAF drip — decouple token arrival rate from React render rate
  const pendingTokensRef = useRef<string[]>([]);
  const rafRef = useRef<number | null>(null);
  const streamEndedRef = useRef(false);

  const baseUrl = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  usePageMeta({
    title: "Knowledge Base",
    description: "Explore the HK AI Marketing Playbook — the definitive resource on AI adoption, tools, regulations, and trends in Hong Kong's marketing industry.",
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
    setRagGrounded(false);
    setSearchDone(false);
    setIsRagStreaming(false);
    setSearchError(false);
    setCitationAnimGen({});
    streamedTextRef.current = "";
    knownCitCountRef.current = {};
    citationAnimGenRef.current = {};
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    pendingTokensRef.current = [];
    streamEndedRef.current = false;

    if (activeQuery.trim().length < 3) {
      setIsSearching(false);
      return;
    }

    const cacheKey = activeQuery.trim().toLowerCase();
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      setRagAnswer(cached.ragAnswer);
      setRagCitations(cached.ragCitations);
      setRagGrounded(cached.ragGrounded);
      setAiResults(cached.aiResults);
      setAiSummary(cached.aiSummary);
      setSearchFallbackPages(cached.searchFallbackPages);
      setIsSearching(false);
      setSearchDone(true);
      return;
    }

    setIsSearching(true);
    const controller = new AbortController();
    abortRef.current = controller;

    let finalRagAnswer: string | null = null;
    let finalRagCitations: KnowledgeCitation[] | null = null;
    let finalRagGrounded = false;
    let finalAiResults: WikiPageSummary[] | null = null;
    let finalAiSummary: string | null = null;
    let finalSearchFallbackPages: WikiPageSummary[] | null = null;
    let hadError = false;

    const fetchOpts = (body: object) => ({
      method: "POST" as const,
      headers: { "Content-Type": "application/json" },
      credentials: "include" as const,
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    const handleToken = (token: string) => {
      // Push to drip buffer — the RAF loop flushes into React state
      // so each animation frame gets its own render (no batching surprise).
      pendingTokensRef.current.push(token);

      // Start the RAF drain loop only if it isn't already running.
      if (rafRef.current === null) {
        const drain = () => {
          if (pendingTokensRef.current.length > 0) {
            const batch = pendingTokensRef.current.splice(0, 3);
            setRagAnswer((prev) => (prev ?? "") + batch.join(""));
            rafRef.current = requestAnimationFrame(drain);
          } else if (streamEndedRef.current) {
            // Buffer empty + stream closed → drop the cursor
            setIsRagStreaming(false);
            streamEndedRef.current = false;
            rafRef.current = null;
          } else {
            // Buffer momentarily empty but stream still open → pause RAF;
            // next token arrival will restart it.
            rafRef.current = null;
          }
        };
        rafRef.current = requestAnimationFrame(drain);
      }

      // Citation tracking stays synchronous (refs, no stale-closure risk).
      streamedTextRef.current += token;
      const counts: Record<number, number> = {};
      for (const m of streamedTextRef.current.matchAll(/\[(\d+)\]/g)) {
        const n = parseInt(m[1]);
        counts[n] = (counts[n] ?? 0) + 1;
      }
      const genUpdates: Record<number, number> = {};
      let hasUpdates = false;
      for (const [nStr, count] of Object.entries(counts)) {
        const n = parseInt(nStr);
        const prevCount = knownCitCountRef.current[n] ?? 0;
        if (count > prevCount) {
          const currentGen = citationAnimGenRef.current[n] ?? 0;
          const newGen = currentGen === 0 ? 1 : currentGen + 1;
          genUpdates[n] = newGen;
          citationAnimGenRef.current[n] = newGen;
          hasUpdates = true;
        }
      }
      knownCitCountRef.current = counts;
      if (hasUpdates) setCitationAnimGen((prev) => ({ ...prev, ...genUpdates }));
    };

    const handleRag = async () => {
      let r: Response;
      try {
        r = await fetch(`${baseUrl}/api/knowledge/search`, fetchOpts({ query: activeQuery.trim() }));
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setRagAnswer(null);
          setRagCitations(null);
          hadError = true;
          setSearchError(true);
        }
        return;
      }
      if (!r.ok) { hadError = true; setSearchError(true); return; }

      const ct = r.headers.get("content-type") ?? "";

      if (ct.includes("text/event-stream") && r.body) {
        // Streaming SSE path
        finalRagGrounded = true;
        setRagGrounded(true);
        setIsRagStreaming(true);
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // SSE events are separated by \n\n
            const events = buffer.split("\n\n");
            buffer = events.pop() ?? "";

            for (const block of events) {
              if (!block.trim()) continue;
              let eventType = "";
              const dataLines: string[] = [];
              for (const line of block.split("\n")) {
                if (line.startsWith("event: ")) eventType = line.slice(7).trim();
                else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
                else if (line === "data:") dataLines.push("");
              }
              const data = dataLines.join("\n");

              if (eventType === "citations") {
                try { const c = JSON.parse(data) as KnowledgeCitation[]; finalRagCitations = c; setRagCitations(c); } catch { /* ignore parse errors */ }
              } else if (eventType === "token") {
                try { handleToken(JSON.parse(data) as string); } catch { /* ignore parse errors */ }
              } else if (eventType === "error") {
                // Mid-stream failure — partial answer already shown.
                // The stream closes after this, so the finally block
                // will call setIsRagStreaming(false) and stop the cursor.
              }
              // "done": the stream closes naturally after this event
            }
          }
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            // Partial answer is fine — keep whatever streamed
          }
        } finally {
          // Capture full streamed text for cache before releasing the cursor.
          finalRagAnswer = streamedTextRef.current.trim() || null;
          streamEndedRef.current = true;
          if (rafRef.current === null) {
            setIsRagStreaming(false);
            streamEndedRef.current = false;
          }
        }
      } else {
        // JSON fallback (no model configured, passages-only response)
        try {
          const rag = await r.json() as { answer: string | null; grounded: boolean; citations: KnowledgeCitation[] };
          finalRagGrounded = rag.grounded;
          setRagGrounded(rag.grounded);
          if (rag.grounded && rag.answer && rag.answer.trim().length > 0) {
            finalRagAnswer = rag.answer.trim();
            finalRagCitations = rag.citations ?? [];
            setRagAnswer(rag.answer.trim());
            setRagCitations(rag.citations ?? []);
          } else {
            finalRagAnswer = null;
            finalRagCitations = rag.citations ?? [];
            setRagAnswer(null);
            setRagCitations(rag.citations ?? []);
          }
        } catch { /* ignore */ }
      }
    };

    const handleWikiSearch = async () => {
      let r: Response;
      try {
        r = await fetch(`${baseUrl}/api/wiki/search`, fetchOpts({ query: activeQuery.trim() }));
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setAiResults(null);
          setAiSummary(null);
          setSearchFallbackPages(null);
          hadError = true;
          setSearchError(true);
        }
        return;
      }
      if (!r.ok) { hadError = true; setSearchError(true); return; }
      try {
        const result = await r.json() as { ranked: boolean; pages: WikiPageSummary[]; summary?: string };
        if (result.ranked && Array.isArray(result.pages)) {
          finalAiResults = result.pages;
          finalAiSummary = result.summary && result.summary.trim().length > 0 ? result.summary.trim() : null;
          finalSearchFallbackPages = null;
          setAiResults(finalAiResults);
          setAiSummary(finalAiSummary);
          setSearchFallbackPages(null);
        } else {
          finalAiResults = null;
          finalAiSummary = null;
          finalSearchFallbackPages = Array.isArray(result.pages) ? result.pages : null;
          setAiResults(null);
          setAiSummary(null);
          setSearchFallbackPages(finalSearchFallbackPages);
        }
      } catch { /* ignore */ }
    };

    (async () => {
      try {
        await Promise.all([handleWikiSearch(), handleRag()]);
      } finally {
        if (abortRef.current === controller) {
          setIsSearching(false);
          setSearchDone(true);
          if (!hadError) {
            searchCache.set(cacheKey, {
              ragAnswer: finalRagAnswer,
              ragCitations: finalRagCitations,
              ragGrounded: finalRagGrounded,
              aiResults: finalAiResults,
              aiSummary: finalAiSummary,
              searchFallbackPages: finalSearchFallbackPages,
              cachedAt: Date.now(),
            });
          }
        }
      }
    })();

    return () => { abortRef.current?.abort(); };
  }, [activeQuery, baseUrl]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (activeQuery.trim().length >= 3) {
      params.set("q", activeQuery.trim());
    } else {
      params.delete("q");
    }
    const newSearch = params.toString();
    window.history.replaceState(null, "", newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname);
  }, [activeQuery]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length >= 3) setActiveQuery(trimmed);
  };

  const clearSearch = () => {
    setQuery("");
    setActiveQuery("");
    setAiResults(null);
    setAiSummary(null);
    setSearchFallbackPages(null);
    setRagAnswer(null);
    setRagCitations(null);
    setRagGrounded(false);
    setSearchDone(false);
    setIsSearching(false);
    setIsRagStreaming(false);
    setSearchError(false);
    setCitationAnimGen({});
    streamedTextRef.current = "";
    knownCitCountRef.current = {};
    citationAnimGenRef.current = {};
    if (abortRef.current) abortRef.current.abort();
  };

  const basePages = aiResults !== null ? aiResults : (searchFallbackPages ?? pages ?? []);


  const filtered = basePages.filter((p) => {
    const matchesTag = activeTag === "All" || p.tags.includes(activeTag);
    const matchesResponsibleAi = !responsibleAiOnly || p.responsibleAi === true;
    if (aiResults !== null) return matchesTag && matchesResponsibleAi;
    const q = query.toLowerCase();
    const matchesQuery = !q || p.title.toLowerCase().includes(q) || p.excerpt.toLowerCase().includes(q);
    return matchesTag && matchesQuery && matchesResponsibleAi;
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

  // Populate follow-up chips once streaming finishes; clear on new search.
  useEffect(() => {
    if (searchDone && !isRagStreaming && ragAnswer !== null) {
      setSuggestedFollowUps(pickThree(questionPool, [activeQuery]));
    } else {
      setSuggestedFollowUps([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDone, isRagStreaming, ragAnswer, activeQuery, questionPool]);

  // When the API pool loads (replaces the fallback), refresh shown questions.
  const prevPoolRef = useRef(FALLBACK_QUESTIONS);
  useEffect(() => {
    if (questionPool !== prevPoolRef.current) {
      prevPoolRef.current = questionPool;
      setShownQuestions(pickThree(questionPool));
    }
  }, [questionPool]);

  // Rotate one suggested question every 12 s while idle (no active search).
  useEffect(() => {
    const id = setInterval(() => {
      setShownQuestions((prev) => {
        // Pick one replacement from questions not currently shown.
        const replacements = pickThree(questionPool, prev);
        if (replacements.length === 0) return prev;
        const next = [...prev];
        const swapIdx = Math.floor(Math.random() * next.length);
        next[swapIdx] = replacements[0];
        return next;
      });
    }, 12_000);
    return () => clearInterval(id);
  }, [questionPool]);

  const usingAI = aiResults !== null && activeQuery.trim().length >= 3;

  const canonicalOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const indexSchema = pages && pages.length > 0 ? {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${canonicalOrigin}${baseUrl}/`,
        "url": `${canonicalOrigin}${baseUrl}/`,
        "name": "Hong Kong Bible of AI Adoption — HK AI Marketing Playbook",
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

  // Show the AI panel as soon as citations arrive, when the search is done, or when there was an error.
  const showRagPanel = activeQuery.trim().length >= 3 && (searchDone || ragCitations !== null || (searchError && !isSearching));

  const hasRagContent = ragAnswer !== null || ragCitations !== null;
  const panelHasColor = hasRagContent || !!aiSummary;

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
        <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#D63425" }}>IAB Hong Kong · AI & TECH COMMITTEE</p>
        <h1 className="text-3xl font-bold text-gray-800 mb-3" style={{ letterSpacing: "-0.5px" }}>HONG KONG AI MARKETING PLAYBOOK</h1>
        <p className="text-sm text-gray-500 max-w-2xl leading-relaxed">Welcome to the HK AI Marketing Playbook! An initiative of the 2026 AI and Technology Committee, this web app is a living knowledge resource inspired by the "Second Brain" concept popularized by Andrej Karpathy. As new material is submitted, our language model reviews it in full, identifies key entities and ideas, and creates or updates relevant wiki pages. It also refines topic summaries, builds cross-links across related subjects, and flags inconsistencies, helping each new source strengthen an evolving, interconnected knowledge graph. </p>

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
            disabled={isSearching}
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

        {/* Sample questions — rotate every 12 s */}
        <div className="flex flex-wrap gap-2 mt-3 max-w-xl">
          {shownQuestions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => { setQuery(q); setActiveQuery(q); }}
              className="text-xs px-3 py-1.5 rounded-full border border-gray-200 bg-white text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
      {/* Quiz CTA */}
      <div className="max-w-6xl mx-auto px-6 lg:px-8 pb-6">
        <Link href="/quiz">
          <div
            className="inline-flex items-center gap-4 rounded-xl border px-5 py-3.5 cursor-pointer transition-all hover:shadow-md group"
            style={{ borderColor: "#D63425", backgroundColor: "#fff5f5" }}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: "#D63425" }}
            >
              <Lightbulb size={16} color="#fff" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800 group-hover:text-[#D63425] transition-colors">
                Test your AI marketing knowledge
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Take the interactive quiz — questions drawn from the full knowledge base
              </p>
            </div>
            <ChevronRight size={16} className="text-gray-400 group-hover:text-[#D63425] ml-auto shrink-0 transition-colors" />
          </div>
        </Link>
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
          <button
            onClick={() => setResponsibleAiOnly((prev) => !prev)}
            className="text-xs px-3 py-1 rounded-full border font-medium transition-all"
            style={
              responsibleAiOnly
                ? { backgroundColor: "#dbeafe", color: "#1d4ed8", borderColor: "#93c5fd" }
                : { backgroundColor: "#fff", color: "#6b7280", borderColor: "#e5e7eb" }
            }
          >
            Responsible AI
          </button>
        </div>

        <div className="border-t border-gray-100 pt-4 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {activeQuery.trim().length >= 3 && (
              <button
                onClick={clearSearch}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800 transition-colors"
              >
                <X size={12} />
                Back to all pages
              </button>
            )}
            {isLoading ? (
              <span className="text-xs text-gray-400">Loading…</span>
            ) : filtered.length > 0 ? (
              <span className="text-xs text-gray-400 font-medium">
                {filtered.length} {filtered.length === 1 ? "page" : "pages"}
                {activeTag !== "All" ? ` · ${activeTag}` : ""}
              </span>
            ) : null}
          </div>
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
      {/* AI answer panel — visible as soon as citations arrive (before full stream) */}
      {showRagPanel && (
        <div className="max-w-6xl mx-auto px-6 lg:px-8 mb-6">
          <div className={`rounded-xl border overflow-hidden ${panelHasColor ? "border-[#D63425]/15 bg-[#fff8f7]" : "border-gray-100 bg-gray-50"}`}>
            <div className={`px-5 py-2.5 border-b flex items-center gap-2 ${panelHasColor ? "border-[#D63425]/10 bg-[#D63425]/5" : "border-gray-100 bg-white"}`}>
              {isRagStreaming ? (
                <div className="w-2.5 h-2.5 rounded-full border-2 border-[#D63425]/30 border-t-[#D63425] animate-spin" />
              ) : (
                <Sparkles size={11} style={{ color: panelHasColor ? "#D63425" : "#9ca3af" }} />
              )}
              <span className={`text-[10px] font-bold uppercase tracking-widest ${panelHasColor ? "" : "text-gray-400"}`} style={panelHasColor ? { color: "#D63425" } : {}}>
                AI Answer
              </span>
            </div>

            <div className="px-5 py-4">
              {ragAnswer !== null ? (
                <>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {renderAnswerWithCitations(ragAnswer, ragCitations ?? [])}
                    {isRagStreaming && <span className="cite-cursor" />}
                  </p>
                  {!isRagStreaming && suggestedFollowUps.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-2">
                      {suggestedFollowUps.map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => { setQuery(q); setActiveQuery(q); }}
                          className="text-xs px-3 py-1.5 rounded-full border border-gray-200 bg-white text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                  {ragCitations && ragCitations.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[#D63425]/10 flex flex-wrap gap-2">
                      {ragCitations.map((c) => {
                        const gen = citationAnimGen[c.index] ?? 0;
                        // During streaming, hide chips not yet referenced by the model.
                        // Once streaming ends, show all chips regardless of gen.
                        if (gen === 0 && isRagStreaming) return null;
                        const animStyle: React.CSSProperties =
                          gen === 1
                            ? { animation: "cite-pop-in 0.35s cubic-bezier(0.175,0.885,0.32,1.275) both" }
                            : gen > 1
                            ? { animation: "cite-pulse 0.55s ease both" }
                            : {};
                        const citationClass = `inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          c.sourceSlug
                            ? "border-[#D63425]/20 bg-white hover:bg-[#D63425]/5 hover:border-[#D63425]/40 cursor-pointer"
                            : "border-gray-200 bg-white cursor-default"
                        }`;
                        const citationStyle = { color: c.sourceSlug ? "#D63425" : "#9ca3af", ...animStyle };
                        const citationContent = (
                          <>
                            <span className="font-bold text-[10px] opacity-60">[{c.index}]</span>
                            <span className="truncate max-w-[180px]">{c.title}</span>
                          </>
                        );
                        return c.sourceSlug ? (
                          <Link
                            key={`${c.index}-${gen}`}
                            id={`citation-${c.index}`}
                            href={`/wiki/${c.sourceSlug}`}
                            className={citationClass}
                            style={citationStyle}
                          >
                            {citationContent}
                          </Link>
                        ) : (
                          <span
                            key={`${c.index}-${gen}`}
                            id={`citation-${c.index}`}
                            className={citationClass}
                            style={citationStyle}
                          >
                            {citationContent}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : isRagStreaming || (ragCitations !== null && ragCitations.length > 0 && !searchDone) ? (
                /* Citations received but first token hasn't arrived yet */
                (<div className="flex items-center gap-2 py-1">
                  <div className="w-3.5 h-3.5 border-2 border-[#D63425]/30 border-t-[#D63425] rounded-full animate-spin shrink-0" />
                  <span className="text-xs text-gray-400">Generating answer…</span>
                </div>)
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
              ) : searchError ? (
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 w-6 h-6 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                    <Search size={12} className="text-[#D63425]" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-700 leading-relaxed font-medium">
                      Search is temporarily unavailable.
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      The AI search service didn't respond. Please try again in a moment, or browse the pages below.
                    </p>
                    <button
                      type="button"
                      onClick={() => { const q = activeQuery; setActiveQuery(""); setTimeout(() => setActiveQuery(q), 0); }}
                      className="mt-2 text-xs font-semibold underline underline-offset-2 hover:no-underline transition-all"
                      style={{ color: "#D63425" }}
                    >
                      Try again
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                    <BookOpen size={12} className="text-gray-400" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      The knowledge base doesn't have specific information about <span className="font-medium text-gray-700">"{activeQuery}"</span> yet.
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      New topics are added as contributors upload source material. You can browse all pages below, or{" "}
                      <Link href="/admin" className="underline hover:text-gray-600 transition-colors">contribute a source</Link>.
                    </p>
                  </div>
                </div>
              )}
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
          isSearching ? (
            <div className="text-center py-20 text-gray-400">
              <div className="w-6 h-6 border-2 border-[#D63425]/20 border-t-[#D63425] rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm">Searching…</p>
            </div>
          ) : ragAnswer !== null ? null : (
            <div className="text-center py-20 text-gray-400">
              <BookOpen size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">
                {pages?.length === 0
                  ? "No wiki pages yet. Use the admin panel to build the wiki from existing sections."
                  : "No pages match your search."}
              </p>
            </div>
          )
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
                        {page.synthesized && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-sky-50 text-sky-600 border-sky-200">
                            <Sparkles size={9} />
                            Synthesized
                          </span>
                        )}
                        {page.tags.map((tag) => (
                          <span
                            key={tag}
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${TAG_COLORS[tag] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
                          >
                            {tag}
                          </span>
                        ))}
                        {page.tags.length === 0 && !page.synthesized && (
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
          <span className="text-xs text-gray-400 font-medium uppercase tracking-widest">IAB HK · HK AI Marketing Playbook</span>
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
