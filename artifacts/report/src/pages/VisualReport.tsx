import { useState, useCallback, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import {
  ArrowLeft, BarChart3, Clock, Zap,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { useSections } from "@/hooks/use-sections";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface ChartDataPoint {
  label: string;
  value: number;
  unit: string;
}

const CHART_COLORS = [
  "#199edb",
  "#337ab7",
  "#5aafe0",
  "#1a8bbf",
  "#2d6fa3",
  "#4aa8d8",
];

const EASE_IN: [number, number, number, number] = [0.16, 1, 0.3, 1];
const EASE_OUT: [number, number, number, number] = [0.7, 0, 0.84, 0];

const slideVariants = {
  enter: (dir: number) => ({
    x: dir > 0 ? "40%" : "-40%",
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.45, ease: EASE_IN },
  },
  exit: (dir: number) => ({
    x: dir > 0 ? "-40%" : "40%",
    opacity: 0,
    transition: { duration: 0.3, ease: EASE_OUT },
  }),
};

function StatBadge({ point, index }: { point: ChartDataPoint; index: number }) {
  const bgColors = ["#199edb", "#337ab7", "#5aafe0"];
  const bg = bgColors[index % bgColors.length];

  return (
    <div
      className="rounded-lg px-4 py-3 flex flex-col items-center justify-center min-w-[90px]"
      style={{ backgroundColor: bg }}
    >
      <span style={{ fontFamily: 'Montserrat', fontWeight: 900, fontSize: '22px', color: '#ffffff', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {point.value}{point.unit}
      </span>
      <span style={{ fontFamily: 'Montserrat', fontSize: '10px', color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '6px', textAlign: 'center', lineHeight: 1.3, maxWidth: '80px' }}>
        {point.label}
      </span>
    </div>
  );
}

function ImagePanel({ imageUrl, title }: { imageUrl: string | null; title: string }) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  if (imageUrl) {
    return (
      <div className="relative w-full h-full min-h-[200px]">
        <img
          src={`${base}${imageUrl}`}
          alt={`Illustration for ${title}`}
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[200px] flex items-center justify-center overflow-hidden" style={{ backgroundColor: '#f5f9fd' }}>
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '120px', height: '120px', borderRadius: '50%', border: '1px solid #199edb20' }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '70px', height: '70px', borderRadius: '50%', border: '1px solid #199edb30' }} />
      <BarChart3 style={{ width: '28px', height: '28px', color: '#199edb', opacity: 0.3 }} />
    </div>
  );
}

function SectionCard({
  section,
  index,
  direction,
}: {
  section: {
    id: number;
    slug: string;
    title: string;
    description: string;
    keyInsights: string[];
    chartData: ChartDataPoint[];
    imageUrl: string | null;
    lastUpdated: string;
  };
  index: number;
  direction: number;
}) {
  const hasChartData = section.chartData && section.chartData.length > 0;
  const chartPoints = useMemo(
    () =>
      (section.chartData ?? []).map((p) => ({
        name: p.label.length > 18 ? p.label.slice(0, 16) + "…" : p.label,
        fullLabel: p.label,
        value: p.value,
        unit: p.unit,
      })),
    [section.chartData],
  );

  return (
    <motion.div
      key={section.id}
      custom={direction}
      variants={slideVariants}
      initial="enter"
      animate="center"
      exit="exit"
      className="bg-white border border-[#e5e7eb] rounded-2xl overflow-hidden relative flex flex-col lg:flex-row"
      style={{ minHeight: "480px", boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}
    >
      {/* Top accent bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', backgroundColor: '#199edb' }} />

      {/* Right panel — image */}
      <div className="order-first lg:order-last w-full h-52 lg:h-auto lg:w-[38%] flex-shrink-0 relative overflow-hidden lg:border-l lg:border-[#e5e7eb]">
        <ImagePanel imageUrl={section.imageUrl} title={section.title} />
      </div>

      {/* Left panel — text & data */}
      <div className="flex-1 p-8 pt-10 flex flex-col overflow-hidden">

        {/* Card Header */}
        <div className="flex items-start justify-between mb-7">
          <div className="flex items-start gap-4">
            <span style={{ fontFamily: 'Montserrat', fontWeight: 900, fontSize: '48px', color: '#e5e7eb', lineHeight: 1, userSelect: 'none', marginTop: '2px' }}>
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <h2 style={{ fontFamily: 'Montserrat', fontWeight: 700, fontSize: '16px', color: '#4a4a4a', lineHeight: 1.3, marginBottom: '6px' }}>
                {section.title}
              </h2>
              {section.description && (
                <p style={{ fontFamily: 'Montserrat', fontSize: '13px', color: '#B6B6B6', lineHeight: 1.5, maxWidth: '480px' }}>
                  {section.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-4" style={{ fontFamily: 'Montserrat', fontSize: '10px', color: '#B6B6B6', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            <Clock className="w-3 h-3" />
            {format(new Date(section.lastUpdated), "MMM dd, yyyy")}
          </div>
        </div>

        {/* Stat Badges */}
        {hasChartData && (
          <div className="flex flex-wrap gap-2.5 mb-7">
            {section.chartData.slice(0, 4).map((point, i) => (
              <StatBadge key={i} point={point} index={i} />
            ))}
          </div>
        )}

        <div className={`grid gap-6 flex-1 ${hasChartData && chartPoints.length >= 2 ? "lg:grid-cols-2" : "grid-cols-1"}`}>
          {/* Bar Chart */}
          {hasChartData && chartPoints.length >= 2 && (
            <div className="rounded-xl p-5 border border-[#e5e7eb]" style={{ backgroundColor: '#fafafa' }}>
              <h3 style={{ fontFamily: 'Montserrat', fontWeight: 600, fontSize: '10px', color: '#199edb', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BarChart3 className="w-3 h-3" />
                Data Breakdown
              </h3>
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartPoints} barCategoryGap="32%">
                    <CartesianGrid
                      strokeDasharray="2 4"
                      stroke="#e5e7eb"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="name"
                      stroke="#B6B6B6"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      dy={8}
                      tick={{ fill: "#B6B6B6", fontFamily: 'Montserrat' }}
                    />
                    <YAxis
                      stroke="#B6B6B6"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      dx={-6}
                      tick={{ fill: "#B6B6B6", fontFamily: 'Montserrat' }}
                      tickFormatter={(v) => {
                        const u = chartPoints[0]?.unit ?? "";
                        return `${v}${u}`;
                      }}
                    />
                    <Tooltip
                      cursor={{ fill: "#199edb10" }}
                      contentStyle={{
                        backgroundColor: "#ffffff",
                        borderColor: "#e5e7eb",
                        color: "#4d4d4d",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontFamily: "Montserrat",
                        boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
                      }}
                      formatter={(value: number, _name: string, props: { payload?: { unit?: string; fullLabel?: string } }) => [
                        `${value}${props.payload?.unit ?? ""}`,
                        props.payload?.fullLabel ?? "",
                      ]}
                      labelFormatter={() => ""}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={44}>
                      {chartPoints.map((_entry, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Key Insights */}
          {section.keyInsights && section.keyInsights.length > 0 && (
            <div className="rounded-xl p-5 border border-[#e5e7eb]" style={{ backgroundColor: '#fafafa' }}>
              <h3 style={{ fontFamily: 'Montserrat', fontWeight: 600, fontSize: '10px', color: '#D63425', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Zap className="w-3 h-3" />
                Key Insights
              </h3>
              <ul className="space-y-3.5">
                {section.keyInsights.slice(0, 3).map((insight, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span style={{ width: '2px', alignSelf: 'stretch', borderRadius: '9999px', backgroundColor: '#199edb', flexShrink: 0, marginTop: '2px', minHeight: '20px', display: 'inline-block' }} />
                    <span style={{ fontFamily: 'Montserrat', fontSize: '13px', color: '#4d4d4d', lineHeight: 1.6 }}>
                      {insight}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* No data placeholder */}
          {!hasChartData && (!section.keyInsights || section.keyInsights.length === 0) && (
            <div className="col-span-full flex items-center justify-center h-32" style={{ fontFamily: 'Montserrat', fontSize: '11px', color: '#B6B6B6', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              No data available yet
            </div>
          )}
        </div>

      </div>
    </motion.div>
  );
}

export default function VisualReport() {
  const { data: sections, isLoading } = useSections();
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState(1);

  const sortedSections = useMemo(
    () => (sections ?? []).sort((a, b) => a.displayOrder - b.displayOrder),
    [sections],
  );

  const total = sortedSections.length;

  const goTo = useCallback((index: number, dir: number) => {
    if (index === activeIndex) return;
    setDirection(dir);
    setActiveIndex(index);
  }, [activeIndex]);

  const goPrev = useCallback(() => {
    if (activeIndex > 0) goTo(activeIndex - 1, -1);
  }, [activeIndex, goTo]);

  const goNext = useCallback(() => {
    if (activeIndex < total - 1) goTo(activeIndex + 1, 1);
  }, [activeIndex, total, goTo]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goPrev, goNext]);

  useEffect(() => {
    setActiveIndex(0);
  }, [sortedSections.length]);

  const currentSection = sortedSections[activeIndex];
  const currentMonthYear = format(new Date(), "MMMM yyyy");

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: 'Montserrat, sans-serif' }}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-[#e5e7eb]" style={{ backdropFilter: 'blur(12px)' }}>
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 h-8 px-3"
                style={{ fontFamily: 'Montserrat', fontSize: '11px', color: '#B6B6B6', letterSpacing: '0.12em', textTransform: 'uppercase' }}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Full Report
              </Button>
            </Link>
            <div className="h-4 w-px bg-[#e5e7eb]" />
            <span style={{ fontFamily: 'Montserrat', fontWeight: 700, fontSize: '13px', color: '#4a4a4a', letterSpacing: '0.05em' }}>
              State of AI
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-[#199edb]/30" style={{ backgroundColor: '#199edb10' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#199edb', display: 'inline-block' }} />
            <span style={{ fontFamily: 'Montserrat', fontSize: '10px', color: '#199edb', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600 }}>
              Visual Summary
            </span>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative px-6 pt-12 pb-10 border-b border-[#e5e7eb]">
        <div className="max-w-[1400px] mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#e5e7eb] mb-5" style={{ backgroundColor: '#fafafa' }}>
              <BarChart3 className="w-3 h-3" style={{ color: '#B6B6B6' }} />
              <span style={{ fontFamily: 'Montserrat', fontSize: '10px', color: '#B6B6B6', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                Data Dashboard · {currentMonthYear}
              </span>
            </div>
            <h1 style={{ fontFamily: 'Montserrat', fontWeight: 800, fontSize: '32px', color: '#3b3b3b', lineHeight: 1.25, marginBottom: '12px' }}>
              State of AI in{" "}
              <span style={{ color: '#199edb' }}>
                Hong Kong Marketing
              </span>
            </h1>
            <p style={{ fontFamily: 'Montserrat', fontSize: '16px', color: '#4d4d4d', lineHeight: 1.7, maxWidth: '640px' }}>
              A visual breakdown of key data points, insights, and trends across{" "}
              {total || "all"} report sections. Updated automatically as new research is contributed.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Carousel */}
      <main className="max-w-[1400px] mx-auto px-6 pb-24 pt-10">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-2 border-[#199edb]/20 border-t-[#199edb] rounded-full animate-spin" />
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <BarChart3 className="w-10 h-10" style={{ color: '#B6B6B6' }} />
            <p style={{ fontFamily: 'Montserrat', fontSize: '11px', color: '#B6B6B6', letterSpacing: '0.15em', textTransform: 'uppercase' }}>No report sections yet</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Card area */}
            <div className="relative overflow-hidden">
              <AnimatePresence mode="wait" custom={direction}>
                {currentSection && (
                  <SectionCard
                    key={currentSection.id}
                    section={{
                      ...currentSection,
                      chartData: (currentSection as typeof currentSection & { chartData?: ChartDataPoint[] }).chartData ?? [],
                      imageUrl: (currentSection as typeof currentSection & { imageUrl?: string | null }).imageUrl ?? null,
                    }}
                    index={activeIndex}
                    direction={direction}
                  />
                )}
              </AnimatePresence>
            </div>

            {/* Navigation controls */}
            <div className="flex items-center justify-between gap-4 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={goPrev}
                disabled={activeIndex === 0}
                aria-label="Previous section"
                className="gap-2 h-8 px-3 disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ fontFamily: 'Montserrat', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', borderColor: '#e5e7eb', color: '#B6B6B6' }}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Prev</span>
              </Button>

              <div className="flex items-center gap-1.5 overflow-x-auto max-w-[60vw]">
                {sortedSections.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => goTo(i, i > activeIndex ? 1 : -1)}
                    aria-label={`Go to section ${i + 1}: ${s.title}`}
                    title={s.title}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md whitespace-nowrap transition-all duration-200 focus-visible:outline-none"
                    style={{
                      fontFamily: 'Montserrat',
                      fontSize: '10px',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                      backgroundColor: i === activeIndex ? '#199edb10' : 'transparent',
                      color: i === activeIndex ? '#199edb' : '#B6B6B6',
                      border: i === activeIndex ? '1px solid #199edb30' : '1px solid transparent',
                    }}
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <span className="hidden md:inline max-w-[80px] truncate" style={{ fontWeight: 400 }}>
                      {s.title.split(" ").slice(0, 2).join(" ")}
                    </span>
                  </button>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={goNext}
                disabled={activeIndex === total - 1}
                aria-label="Next section"
                className="gap-2 h-8 px-3 disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ fontFamily: 'Montserrat', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', borderColor: '#e5e7eb', color: '#B6B6B6' }}
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#e5e7eb] py-10 px-6" style={{ backgroundColor: '#fafafa' }}>
        <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <span style={{ fontFamily: 'Montserrat', fontWeight: 800, fontSize: '14px', color: '#B6B6B6', letterSpacing: '0.1em', userSelect: 'none' }}>
            STATE OF AI / HK
          </span>
          <Link href="/">
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
              style={{ fontFamily: 'Montserrat', fontSize: '11px', color: '#B6B6B6', letterSpacing: '0.12em', textTransform: 'uppercase' }}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Return to Full Report
            </Button>
          </Link>
        </div>
      </footer>
    </div>
  );
}
