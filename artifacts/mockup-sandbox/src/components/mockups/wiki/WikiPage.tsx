import { BookOpen, ArrowLeft, Clock, FileText, ChevronRight, ExternalLink, Tag } from "lucide-react";

const WIKI_ENTRY = {
  title: "AI Expectation Gap",
  tags: ["Trends", "Statistics"],
  updated: "April 2025",
  sources: [
    { label: "Executive Overview", ref: "§ Executive Overview, para. 3" },
    { label: "Market Context & Landscape", ref: "§ Market Context, fig. 4" },
    { label: "HKPC Productivity Survey Upload", ref: "Uploaded: hkpc-survey-2025.pdf" },
  ],
  related: [
    { slug: "skills-gap-marketing-ai", title: "Marketing AI Skills Gap", tags: ["Trends", "Statistics"] },
    { slug: "hkpc-advisory-survey-2025", title: "HKPC Advisory Survey 2025", tags: ["Statistics"] },
    { slug: "responsible-ai-charter", title: "Responsible AI Charter (IAB HK)", tags: ["Regulatory", "Frameworks"] },
    { slug: "ai-adoption-rate-2025", title: "AI Adoption Rate — HK Marketing 2025", tags: ["Statistics"] },
  ],
  body: `## Overview

The **AI Expectation Gap** describes the measurable disconnect between how senior leaders perceive AI readiness within their organisations, and the ground-level reality experienced by marketing practitioners. Across the 2025 IAB HK research cohort, C-suite respondents reported confidence levels averaging **7.2 / 10**, while team leads and individual contributors in the same firms scored readiness at **4.1 / 10** — a gap of over 3 points.

This pattern is consistent across financial services, retail, and media verticals, though it is most pronounced in financial services where regulatory caution suppresses on-the-ground experimentation even as leadership signals strategic commitment.

## Key Data Points

- **67%** of HK marketing leaders say AI is "core to their strategy" for 2025
- **Only 31%** of practitioners in the same firms report having the skills to execute AI-driven campaigns
- The gap has widened by **8 percentage points** since the 2023 edition of this survey
- Skills investment lags tool procurement by an estimated **12–18 months** in most surveyed enterprises

## Root Causes

Three factors are consistently cited in qualitative interviews:

1. **Top-down mandate without bottom-up enablement.** Boards and CMOs are under pressure to demonstrate AI progress to shareholders and clients. Tools are procured and announced before teams are trained to use them effectively.

2. **Measurement confusion.** There is no agreed metric for "AI readiness" at the team level. Leaders tend to measure tool adoption (are we using it?) while practitioners measure outcome quality (is it producing better work?).

3. **Fear of disclosure.** Practitioners who struggle with AI tools are reluctant to surface this upward, knowing that leadership has publicly committed to AI transformation. The gap is structurally self-concealing.

## Implications for Marketers

Organisations with large expectation gaps show measurably lower campaign ROI from AI-assisted tools and higher rates of AI project abandonment within six months of launch. Closing the gap requires paired investment in tooling and structured training programmes — not sequential investment.`,
};

const TAG_COLORS: Record<string, string> = {
  "Organizations": "bg-blue-50 text-blue-700 border-blue-100",
  "Statistics": "bg-purple-50 text-purple-700 border-purple-100",
  "Tools & Platforms": "bg-green-50 text-green-700 border-green-100",
  "Regulatory": "bg-orange-50 text-orange-700 border-orange-100",
  "Trends": "bg-red-50 text-red-700 border-red-100",
  "Case Studies": "bg-yellow-50 text-yellow-700 border-yellow-100",
  "Frameworks": "bg-gray-100 text-gray-700 border-gray-200",
};

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: JSX.Element[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("## ")) {
      elements.push(
        <h2 key={i} className="text-base font-bold text-gray-800 mt-8 mb-3" style={{ letterSpacing: "-0.2px" }}>
          {line.slice(3)}
        </h2>
      );
    } else if (line.match(/^\d+\.\s/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        listItems.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      elements.push(
        <ol key={i} className="list-decimal list-inside space-y-2 mb-4">
          {listItems.map((item, j) => (
            <li key={j} className="text-sm text-gray-600 leading-relaxed">
              {item.split("**").map((part, k) =>
                k % 2 === 1 ? <strong key={k} className="font-semibold text-gray-800">{part}</strong> : part
              )}
            </li>
          ))}
        </ol>
      );
      continue;
    } else if (line.startsWith("- ")) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        listItems.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={i} className="space-y-1.5 mb-4 pl-1">
          {listItems.map((item, j) => (
            <li key={j} className="flex items-start gap-2 text-sm text-gray-600 leading-relaxed">
              <span className="mt-2 w-1 h-1 rounded-full bg-red-400 flex-shrink-0" />
              <span>
                {item.split("**").map((part, k) =>
                  k % 2 === 1 ? <strong key={k} className="font-semibold text-gray-800">{part}</strong> : part
                )}
              </span>
            </li>
          ))}
        </ul>
      );
      continue;
    } else if (line.trim() !== "") {
      const parts = line.split("**");
      elements.push(
        <p key={i} className="text-sm text-gray-600 leading-relaxed mb-4">
          {parts.map((part, k) =>
            k % 2 === 1 ? <strong key={k} className="font-semibold text-gray-800">{part}</strong> : part
          )}
        </p>
      );
    }

    i++;
  }

  return elements;
}

export function WikiPage() {
  return (
    <div style={{ fontFamily: "'Montserrat', sans-serif" }} className="min-h-screen bg-white">
      {/* Thin top bar */}
      <div style={{ backgroundColor: "#D63425" }} className="h-1 w-full" />

      {/* Header */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-8 py-4 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <BookOpen size={18} style={{ color: "#D63425" }} />
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#D63425" }}>IAB HK</span>
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

      {/* Breadcrumb */}
      <div className="max-w-6xl mx-auto px-8 pt-6 pb-0">
        <a href="#" className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors w-fit">
          <ArrowLeft size={12} />
          <span>All Wiki Pages</span>
        </a>
      </div>

      {/* Main layout */}
      <div className="max-w-6xl mx-auto px-8 py-6 flex gap-10">
        {/* Content */}
        <main className="flex-1 min-w-0">
          {/* Page header */}
          <div className="mb-6">
            <div className="flex flex-wrap gap-1.5 mb-3">
              {WIKI_ENTRY.tags.map((tag) => (
                <span
                  key={tag}
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${TAG_COLORS[tag] ?? ""}`}
                >
                  {tag}
                </span>
              ))}
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2" style={{ letterSpacing: "-0.5px" }}>
              {WIKI_ENTRY.title}
            </h1>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Clock size={11} />
                Updated {WIKI_ENTRY.updated}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <FileText size={11} />
                {WIKI_ENTRY.sources.length} sources
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-gray-100 mb-6" />

          {/* Body */}
          <div className="prose-sm max-w-none">
            {renderMarkdown(WIKI_ENTRY.body)}
          </div>
        </main>

        {/* Sidebar */}
        <aside className="w-60 flex-shrink-0">
          {/* Related pages */}
          <div className="mb-8">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
              <Tag size={10} />
              Related Pages
            </h3>
            <div className="space-y-2">
              {WIKI_ENTRY.related.map((rel) => (
                <a
                  key={rel.slug}
                  href="#"
                  className="group flex items-start gap-2 p-2.5 rounded-lg border border-gray-100 hover:border-gray-200 bg-white hover:bg-gray-50 transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-700 group-hover:text-red-600 transition-colors leading-snug">
                      {rel.title}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {rel.tags.map((t) => (
                        <span key={t} className="text-[9px] text-gray-400 font-medium">{t}</span>
                      ))}
                    </div>
                  </div>
                  <ChevronRight size={11} className="text-gray-300 group-hover:text-red-400 flex-shrink-0 mt-0.5 transition-colors" />
                </a>
              ))}
            </div>
          </div>

          {/* Sources */}
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
              <FileText size={10} />
              Sources
            </h3>
            <div className="space-y-2">
              {WIKI_ENTRY.sources.map((src, i) => (
                <div key={i} className="p-2.5 rounded-lg border border-gray-100 bg-gray-50">
                  <p className="text-xs font-semibold text-gray-700 leading-snug mb-0.5">{src.label}</p>
                  <p className="text-[10px] text-gray-400">{src.ref}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Back to report */}
          <div className="mt-8 pt-6 border-t border-gray-100">
            <a
              href="#"
              className="flex items-center gap-2 text-xs font-semibold transition-colors group"
              style={{ color: "#D63425" }}
            >
              <ExternalLink size={12} />
              <span>View in Report</span>
            </a>
            <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
              Jump to the source section in the full report.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
