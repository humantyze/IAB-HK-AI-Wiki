import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { BookOpen, ArrowLeft, Clock, ChevronRight, Lock, AlignLeft, Share2 } from "lucide-react";
import { ShareInsightDialog } from "@/components/ShareInsightDialog";
import { extractInsights, insightFromText, fallbackInsight, type Insight } from "@/lib/insights";

interface SectionData {
  id: number;
  slug: string;
  title: string;
  description: string;
  displayOrder: number;
  bodyMarkdown: string;
  keyInsights: string[];
  chartData: unknown[];
  imageUrl: string | null;
  lastUpdated: string;
}

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
        return <a key={j} href={linkMatch[2]} className="underline underline-offset-2" style={{ color: "#D63425" }}>{linkMatch[1]}</a>;
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
      i++;
      continue;
    }

    if (line.startsWith("## ")) {
      const text = line.slice(3);
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      nodes.push(
        <h2 key={key++} id={id} className="text-base font-bold text-gray-800 mt-8 mb-3 scroll-mt-20" style={{ letterSpacing: "-0.2px" }}>
          {inlineRender(text)}
        </h2>
      );
      i++;
      continue;
    }

    if (line.startsWith("| ")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const headerCells = tableLines[0].split("|").slice(1, -1).map((c) => c.trim());
      const bodyRows = tableLines.slice(2).map((r) => r.split("|").slice(1, -1).map((c) => c.trim()));
      nodes.push(
        <div key={key++} className="overflow-x-auto mb-4 rounded-lg border border-gray-100">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {headerCells.map((h, ci) => (
                  <th key={ci} className="px-3 py-2 text-left font-semibold text-gray-600">{inlineRender(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 text-gray-600 leading-snug">{inlineRender(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      const items: string[] = [];
      while (i < lines.length && (lines[i].startsWith("- ") || lines[i].startsWith("* "))) {
        items.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <ul key={key++} className="mb-4 space-y-1">
          {items.map((item, li) => (
            <li key={li} className="flex gap-2 text-sm text-gray-600 leading-relaxed">
              <span className="mt-1.5 w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: "#D63425" }} />
              <span>{inlineRender(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    const orderedMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (orderedMatch) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      nodes.push(
        <ol key={key++} className="mb-4 space-y-1 list-none">
          {items.map((item, li) => (
            <li key={li} className="flex gap-2 text-sm text-gray-600 leading-relaxed">
              <span className="font-semibold text-xs mt-0.5 flex-shrink-0" style={{ color: "#D63425" }}>{li + 1}.</span>
              <span>{inlineRender(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    if (line.startsWith("> ")) {
      const text = line.slice(2);
      nodes.push(
        <blockquote key={key++} className="border-l-2 pl-4 py-1 mb-4 bg-gray-50 rounded-r" style={{ borderColor: "#D63425" }}>
          <p className="text-sm text-gray-600 italic leading-relaxed">{inlineRender(text)}</p>
        </blockquote>
      );
      i++;
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    nodes.push(
      <p key={key++} className="text-sm text-gray-600 leading-relaxed mb-4">
        {inlineRender(line)}
      </p>
    );
    i++;
  }

  return nodes;
}

function useSectionPage(slug: string) {
  const [section, setSection] = useState<SectionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const baseUrl = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
    setIsLoading(true);
    setNotFound(false);

    fetch(`${baseUrl}/api/sections/${slug}`, { credentials: "include" })
      .then((r) => {
        if (r.status === 404) { setNotFound(true); setIsLoading(false); return null; }
        return r.json() as Promise<SectionData>;
      })
      .then((data) => {
        if (!data) return;
        setSection(data);
      })
      .finally(() => setIsLoading(false));
  }, [slug]);

  return { section, isLoading, notFound };
}

interface SectionPageProps {
  params: { slug: string };
}

export default function SectionPage({ params }: SectionPageProps) {
  const { slug } = params;
  const { section, isLoading, notFound } = useSectionPage(slug);
  const [activeHeading, setActiveHeading] = useState<string>("");
  const [shareOpen, setShareOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const headings = section ? extractHeadings(section.bodyMarkdown) : [];
  const baseUrl = import.meta.env.BASE_URL as string;
  const sectionInsights = section
    ? [
        ...section.keyInsights.map((t, i) => insightFromText(t, `ki-${i}`)),
        ...extractInsights(section.bodyMarkdown),
      ]
    : [];
  const insights: Insight[] = section
    ? sectionInsights.length
      ? sectionInsights
      : [fallbackInsight(section.title, section.bodyMarkdown)]
    : [];

  useEffect(() => {
    if (!headings.length) return;
    const handleScroll = () => {
      let current = headings[0]?.id ?? "";
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top <= 120) current = h.id;
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

  if (notFound || !section) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center" style={{ fontFamily: "'Montserrat', sans-serif" }}>
        <div className="text-center">
          <p className="text-gray-400 text-sm mb-4">Section not found.</p>
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

      {/* Breadcrumb */}
      <div className="max-w-6xl mx-auto px-6 lg:px-8 pt-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={12} />
          <span>All Pages</span>
        </Link>
      </div>

      {/* Layout */}
      <div className="max-w-6xl mx-auto px-6 lg:px-8 py-6 flex gap-10">
        {/* Main content */}
        <main ref={contentRef} className="flex-1 min-w-0">
          <div className="mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#D63425" }}>
              Report Section
            </p>
            <h1 className="text-2xl font-bold text-gray-800 mb-2" style={{ letterSpacing: "-0.5px" }}>
              {section.title}
            </h1>
            {section.description && (
              <p className="text-sm text-gray-500 mb-2 leading-relaxed">{section.description}</p>
            )}
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Clock size={11} />
                Updated {formatDate(section.lastUpdated)}
              </span>
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

          <div className="h-px bg-gray-100 mb-6 mt-4" />

          {section.keyInsights.length > 0 && (
            <div className="mb-6 p-4 rounded-xl border border-gray-100 bg-gray-50">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Key Insights</p>
              <ul className="space-y-2">
                {section.keyInsights.map((insight, i) => (
                  <li key={i} className="flex gap-2 text-xs text-gray-700 leading-snug">
                    <span className="mt-1 w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: "#D63425" }} />
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="prose-sm max-w-none">
            {renderMarkdown(section.bodyMarkdown)}
          </div>
        </main>

        {/* Sidebar */}
        <aside className="w-56 flex-shrink-0 hidden lg:block">
          <div className="sticky top-24 space-y-6">
            {headings.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
                  <AlignLeft size={10} />
                  On This Page
                </p>
                <nav className="space-y-1">
                  {headings.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => {
                        document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                        setActiveHeading(h.id);
                      }}
                      className={`block w-full text-left text-xs leading-snug py-1 transition-colors ${
                        h.level === 3 ? "pl-3" : ""
                      } ${
                        activeHeading === h.id
                          ? "font-semibold"
                          : "text-gray-400 hover:text-gray-600"
                      }`}
                      style={activeHeading === h.id ? { color: "#D63425" } : {}}
                    >
                      {h.text}
                    </button>
                  ))}
                </nav>
              </div>
            )}

            <div className="pt-4 border-t border-gray-100">
              <Link href="/">
                <span
                  className="flex items-center gap-2 text-xs font-semibold transition-colors cursor-pointer"
                  style={{ color: "#D63425" }}
                >
                  <ChevronRight size={12} />
                  <span>Knowledge Base</span>
                </span>
              </Link>
            </div>
          </div>
        </aside>
      </div>

      <ShareInsightDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        title={section.title}
        tag="Report Section"
        insights={insights}
        logoSrc={`${baseUrl}iabhk-logo.png`}
      />
    </div>
  );
}
