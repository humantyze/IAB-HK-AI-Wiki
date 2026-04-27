import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Search, BookOpen, Clock, ChevronRight, Lock } from "lucide-react";

interface WikiPageSummary {
  id: number;
  slug: string;
  title: string;
  tags: string[];
  relatedSlugs: string[];
  updatedAt: string;
  excerpt: string;
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

export default function WikiIndex() {
  const { data: pages, isLoading } = useWikiPages();
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState("All");

  const filtered = (pages ?? []).filter((p) => {
    const matchesTag = activeTag === "All" || p.tags.includes(activeTag);
    const q = query.toLowerCase();
    const matchesQuery = !q || p.title.toLowerCase().includes(q) || p.excerpt.toLowerCase().includes(q);
    return matchesTag && matchesQuery;
  });

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
            <img
              src={`${(import.meta.env.BASE_URL as string)}iabhk-logo.png`}
              alt="IAB Hong Kong"
              style={{ height: "32px", width: "auto" }}
            />
          </div>
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-gray-200 text-sm">|</span>
            <BookOpen size={14} style={{ color: "#D63425" }} />
            <span className="text-sm font-semibold text-gray-700">Knowledge Base</span>
          </div>
          <nav className="flex gap-5 ml-auto text-xs font-medium text-gray-500">
            <Link href="/admin/login" className="flex items-center gap-1.5 hover:text-gray-800 transition-colors">
              <Lock size={11} />
              <span>Admin</span>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <div className="max-w-6xl mx-auto px-6 lg:px-8 pt-12 pb-8">
        <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#D63425" }}>
          IAB Hong Kong · State of AI in Marketing
        </p>
        <h1 className="text-3xl font-bold text-gray-800 mb-3" style={{ letterSpacing: "-0.5px" }}>
          Knowledge Base
        </h1>
        <p className="text-sm text-gray-500 max-w-2xl leading-relaxed">
          Welcome to the iAB Hong Kong State of AI Knowledge Base — an initiative of the 2026 AI and Technology Committee. This platform is designed as a living knowledge resource inspired by the "Second Brain" concept popularized by Andrej Karpathy. As new material is submitted, our language model reviews it in full, identifies key entities and ideas, and creates or updates relevant wiki pages. It also refines topic summaries, builds cross-links across related subjects, and flags inconsistencies, helping each new source strengthen an evolving, interconnected knowledge graph.
        </p>

        {/* Search */}
        <div className="mt-6 relative max-w-xl">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search concepts, companies, statistics…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-gray-400 text-gray-700 placeholder-gray-400"
          />
        </div>

        {/* Tag filters */}
        <div className="flex flex-wrap gap-2 mt-4">
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
      </div>

      {/* Count row */}
      <div className="max-w-6xl mx-auto px-6 lg:px-8">
        <div className="border-t border-gray-100 pt-4 pb-2 flex items-center justify-between">
          {isLoading ? (
            <span className="text-xs text-gray-400">Loading…</span>
          ) : (
            <span className="text-xs text-gray-400 font-medium">
              {filtered.length} {filtered.length === 1 ? "page" : "pages"}
              {activeTag !== "All" ? ` · ${activeTag}` : ""}
            </span>
          )}
        </div>
      </div>

      {/* Card grid */}
      <div className="max-w-6xl mx-auto px-6 lg:px-8 pb-20">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-2 border-[#D63425]/20 border-t-[#D63425] rounded-full animate-spin" />
          </div>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((page) => (
              <Link key={page.slug} href={`/wiki/${page.slug}`}>
                <div className="group border border-gray-100 rounded-xl p-5 bg-white hover:border-gray-300 hover:shadow-sm transition-all flex flex-col gap-3 cursor-pointer h-full">
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
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 px-6 bg-[#fafafa]">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="text-xs text-gray-400 font-medium uppercase tracking-widest">IAB HK · State of AI in Marketing</span>
          <Link href="/admin" className="text-xs text-gray-400 hover:text-[#D63425] transition-colors uppercase tracking-widest font-medium flex items-center gap-1.5">
            <Lock size={10} />
            Contributor Access
          </Link>
        </div>
      </footer>
    </div>
  );
}
