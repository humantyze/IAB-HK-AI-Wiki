import { useState } from "react";
import { Search, BookOpen, Tag, Clock, ChevronRight } from "lucide-react";

const TAGS = ["All", "Organizations", "Statistics", "Tools & Platforms", "Regulatory", "Trends", "Case Studies", "Frameworks"];

const WIKI_PAGES = [
  {
    slug: "ai-expectation-gap",
    title: "AI Expectation Gap",
    excerpt: "The disconnect between C-suite optimism and practitioner-level readiness across Hong Kong marketing organisations. Identified across all verticals surveyed.",
    tags: ["Trends", "Statistics"],
    updated: "Apr 2025",
    sources: 3,
  },
  {
    slug: "hkpc-advisory-survey-2025",
    title: "HKPC Advisory Survey 2025",
    excerpt: "Hong Kong Productivity Council's annual study covering AI adoption rates, investment intent, and skills gap assessment across 400+ enterprises.",
    tags: ["Statistics", "Frameworks"],
    updated: "Mar 2025",
    sources: 1,
  },
  {
    slug: "hsbc-communication-amplifier",
    title: "HSBC Communication Amplifier",
    excerpt: "HSBC's internal AI tool for drafting and localising marketing copy at scale. Deployed across APAC business banking and retail segments.",
    tags: ["Case Studies", "Organizations"],
    updated: "Apr 2025",
    sources: 2,
  },
  {
    slug: "iab-hong-kong",
    title: "IAB Hong Kong",
    excerpt: "The Interactive Advertising Bureau's Hong Kong chapter — publisher of this report, convener of the AI working group, and primary research sponsor.",
    tags: ["Organizations"],
    updated: "Apr 2025",
    sources: 4,
  },
  {
    slug: "generative-ai-content-creation",
    title: "Generative AI for Content Creation",
    excerpt: "Use of large language models and image generation APIs to produce campaign copy, visuals, and social media assets at reduced cost and time.",
    tags: ["Tools & Platforms", "Trends"],
    updated: "Apr 2025",
    sources: 5,
  },
  {
    slug: "personal-data-ordinance",
    title: "Personal Data (Privacy) Ordinance",
    excerpt: "Hong Kong's primary data protection law governing how organisations collect, use, and retain personal data — directly relevant to AI-driven audience targeting.",
    tags: ["Regulatory", "Frameworks"],
    updated: "Feb 2025",
    sources: 2,
  },
  {
    slug: "cathay-pacific-ai-personalisation",
    title: "Cathay Pacific AI Personalisation",
    excerpt: "Cathay's deployment of propensity models to personalise loyalty programme communications and post-booking upsell flows for Marco Polo Club members.",
    tags: ["Case Studies", "Organizations"],
    updated: "Mar 2025",
    sources: 1,
  },
  {
    slug: "responsible-ai-charter",
    title: "Responsible AI Charter (IAB HK)",
    excerpt: "A voluntary industry code of conduct covering transparency, bias mitigation, and consumer rights in AI-driven advertising, drafted by the IAB HK working group.",
    tags: ["Regulatory", "Frameworks"],
    updated: "Apr 2025",
    sources: 2,
  },
  {
    slug: "ai-adoption-rate-2025",
    title: "AI Adoption Rate — HK Marketing 2025",
    excerpt: "67% of surveyed Hong Kong marketing teams report using at least one AI tool in production, up from 34% in 2023. Piloting remains the dominant mode.",
    tags: ["Statistics"],
    updated: "Apr 2025",
    sources: 3,
  },
  {
    slug: "adobe-firefly",
    title: "Adobe Firefly",
    excerpt: "Adobe's commercially-safe generative image and video model, widely cited by HK creative agencies for compliant asset production without rights risk.",
    tags: ["Tools & Platforms"],
    updated: "Mar 2025",
    sources: 2,
  },
  {
    slug: "skills-gap-marketing-ai",
    title: "Marketing AI Skills Gap",
    excerpt: "Only 23% of HK marketing professionals report confidence in prompting or evaluating AI outputs. Training investment lags tool adoption by an estimated 18 months.",
    tags: ["Trends", "Statistics"],
    updated: "Apr 2025",
    sources: 4,
  },
  {
    slug: "synthetic-data-audiences",
    title: "Synthetic Audience Data",
    excerpt: "Use of AI-generated synthetic personas and modelled behavioural datasets to train targeting algorithms without relying on first-party PII.",
    tags: ["Tools & Platforms", "Regulatory"],
    updated: "Mar 2025",
    sources: 2,
  },
];

const TAG_COLORS: Record<string, string> = {
  "Organizations": "bg-blue-50 text-blue-700 border-blue-100",
  "Statistics": "bg-purple-50 text-purple-700 border-purple-100",
  "Tools & Platforms": "bg-green-50 text-green-700 border-green-100",
  "Regulatory": "bg-orange-50 text-orange-700 border-orange-100",
  "Trends": "bg-red-50 text-red-700 border-red-100",
  "Case Studies": "bg-yellow-50 text-yellow-700 border-yellow-100",
  "Frameworks": "bg-gray-100 text-gray-700 border-gray-200",
};

export function WikiIndex() {
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState("All");

  const filtered = WIKI_PAGES.filter((p) => {
    const matchesTag = activeTag === "All" || p.tags.includes(activeTag);
    const matchesQuery =
      query === "" ||
      p.title.toLowerCase().includes(query.toLowerCase()) ||
      p.excerpt.toLowerCase().includes(query.toLowerCase());
    return matchesTag && matchesQuery;
  });

  return (
    <div
      style={{ fontFamily: "'Montserrat', sans-serif" }}
      className="min-h-screen bg-white"
    >
      {/* Thin top bar */}
      <div style={{ backgroundColor: "#D63425" }} className="h-1 w-full" />

      {/* Header */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-8 py-4 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <BookOpen size={18} style={{ color: "#D63425" }} />
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#D63425" }}>
              IAB HK
            </span>
            <span className="text-gray-200 text-sm">|</span>
            <span className="text-sm font-semibold text-gray-700">Wiki</span>
          </div>
          <nav className="flex gap-5 ml-auto text-xs font-medium text-gray-500">
            <a href="#" className="hover:text-gray-800 transition-colors">Report</a>
            <a href="#" className="font-semibold" style={{ color: "#D63425" }}>Wiki</a>
            <a href="#" className="hover:text-gray-800 transition-colors">Admin</a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <div className="max-w-6xl mx-auto px-8 pt-12 pb-8">
        <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#D63425" }}>
          Knowledge Base
        </p>
        <h1 className="text-3xl font-bold text-gray-800 mb-2" style={{ letterSpacing: "-0.5px" }}>
          State of AI in HK Marketing — Wiki
        </h1>
        <p className="text-sm text-gray-500 max-w-xl">
          An automatically-generated index of every entity, concept, and data point extracted from the report and uploaded research files.
        </p>

        {/* Search */}
        <div className="mt-6 relative max-w-xl">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search entities, companies, statistics…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-gray-400 text-gray-700 placeholder-gray-400"
          />
        </div>

        {/* Tag filters */}
        <div className="flex flex-wrap gap-2 mt-4">
          {TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(tag)}
              className={`text-xs px-3 py-1 rounded-full border font-medium transition-all ${
                activeTag === tag
                  ? "text-white border-transparent"
                  : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
              }`}
              style={activeTag === tag ? { backgroundColor: "#D63425", borderColor: "#D63425" } : {}}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Divider + count */}
      <div className="max-w-6xl mx-auto px-8">
        <div className="border-t border-gray-100 pt-4 pb-2 flex items-center justify-between">
          <span className="text-xs text-gray-400 font-medium">
            {filtered.length} {filtered.length === 1 ? "page" : "pages"}
            {activeTag !== "All" ? ` · ${activeTag}` : ""}
          </span>
          <span className="text-xs text-gray-400">Last synced from report · Apr 2025</span>
        </div>
      </div>

      {/* Card grid */}
      <div className="max-w-6xl mx-auto px-8 pb-16">
        <div className="grid grid-cols-3 gap-4">
          {filtered.map((page) => (
            <a
              key={page.slug}
              href="#"
              className="group border border-gray-100 rounded-xl p-5 bg-white hover:border-gray-300 hover:shadow-sm transition-all flex flex-col gap-3"
            >
              <div className="flex flex-wrap gap-1.5">
                {page.tags.map((tag) => (
                  <span
                    key={tag}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${TAG_COLORS[tag] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div>
                <h3 className="text-sm font-bold text-gray-800 group-hover:text-red-600 transition-colors leading-snug mb-1.5">
                  {page.title}
                </h3>
                <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">
                  {page.excerpt}
                </p>
              </div>

              <div className="mt-auto flex items-center justify-between pt-2 border-t border-gray-50">
                <div className="flex items-center gap-1 text-gray-400">
                  <Clock size={10} />
                  <span className="text-[10px]">{page.updated}</span>
                  <span className="text-[10px] ml-2 text-gray-300">·</span>
                  <span className="text-[10px] ml-1">{page.sources} {page.sources === 1 ? "source" : "sources"}</span>
                </div>
                <ChevronRight size={12} className="text-gray-300 group-hover:text-red-500 transition-colors" />
              </div>
            </a>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <BookOpen size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No pages match your search.</p>
          </div>
        )}
      </div>
    </div>
  );
}
