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
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "hsl(var(--accent))",
  "hsl(var(--primary) / 0.7)",
  "hsl(var(--secondary) / 0.7)",
  "hsl(var(--accent) / 0.7)",
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
  const colors = [
    "border-primary/40 bg-primary/5 text-primary",
    "border-secondary/40 bg-secondary/5 text-secondary",
    "border-accent/40 bg-accent/5 text-accent",
  ];
  const colorClass = colors[index % colors.length];

  return (
    <div className={`border rounded-xl px-4 py-3 flex flex-col items-center justify-center min-w-[90px] ${colorClass}`}>
      <span className="text-2xl font-black font-mono tabular-nums leading-none">
        {point.value}{point.unit}
      </span>
      <span className="text-[10px] font-display uppercase tracking-widest mt-1.5 opacity-70 text-center leading-tight max-w-[80px]">
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
        <div className="absolute inset-0 bg-gradient-to-l from-transparent via-transparent to-card/40 hidden lg:block" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-card/60 lg:hidden" />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[200px] flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-secondary/5 to-accent/10" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_50%,rgba(0,240,255,0.08),transparent)]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-full border border-primary/10 opacity-40" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full border border-primary/20 opacity-60" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-primary/10 border border-primary/30" />
      <BarChart3 className="absolute w-8 h-8 text-primary/20" />
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
      className="bg-card/60 border border-border/60 rounded-2xl overflow-hidden relative group hover:border-primary/30 transition-colors duration-500 hover:shadow-[0_0_40px_rgba(0,240,255,0.05)] flex flex-col lg:flex-row"
      style={{ minHeight: "480px" }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/3 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none rounded-2xl" />

      {/* Right panel — image (shown on top on mobile via order) */}
      <div className="order-first lg:order-last w-full h-52 lg:h-auto lg:w-1/3 flex-shrink-0 relative overflow-hidden lg:border-l lg:border-border/40">
        <ImagePanel imageUrl={section.imageUrl} title={section.title} />
      </div>

      {/* Left panel — text & data content */}
      <div className="flex-1 p-8 flex flex-col overflow-hidden">

        {/* Card Header */}
        <div className="flex items-start justify-between mb-6 relative z-10">
          <div className="flex items-start gap-4">
            <span className="font-display font-black text-4xl text-muted/20 select-none leading-none mt-1">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <h2 className="text-xl font-serif font-bold text-foreground/90 leading-tight">
                {section.title}
              </h2>
              {section.description && (
                <p className="text-xs text-muted-foreground mt-1 font-light leading-snug max-w-lg">
                  {section.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 font-display tracking-widest uppercase shrink-0 ml-4">
            <Clock className="w-3 h-3" />
            {format(new Date(section.lastUpdated), "MMM dd, yyyy")}
          </div>
        </div>

        {/* Stat Badges */}
        {hasChartData && (
          <div className="flex flex-wrap gap-3 mb-8 relative z-10">
            {section.chartData.slice(0, 4).map((point, i) => (
              <StatBadge key={i} point={point} index={i} />
            ))}
          </div>
        )}

        <div className={`relative z-10 grid gap-8 flex-1 ${hasChartData && chartPoints.length >= 2 ? "lg:grid-cols-2" : "grid-cols-1"}`}>
          {/* Bar Chart */}
          {hasChartData && chartPoints.length >= 2 && (
            <div className="bg-background/30 rounded-xl p-6 border border-border/40">
              <h3 className="font-display font-semibold text-[10px] tracking-[0.25em] uppercase text-primary mb-4 flex items-center gap-2">
                <BarChart3 className="w-3 h-3" />
                Data Breakdown
              </h3>
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartPoints} barCategoryGap="30%">
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="name"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      dy={8}
                      tick={{ fill: "hsl(var(--muted-foreground))" }}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      dx={-6}
                      tick={{ fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(v) => {
                        const u = chartPoints[0]?.unit ?? "";
                        return `${v}${u}`;
                      }}
                    />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted) / 0.15)" }}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        borderColor: "hsl(var(--border))",
                        color: "hsl(var(--foreground))",
                        borderRadius: "8px",
                        fontSize: "11px",
                        fontFamily: "var(--font-display)",
                      }}
                      formatter={(value: number, _name: string, props: { payload?: { unit?: string; fullLabel?: string } }) => [
                        `${value}${props.payload?.unit ?? ""}`,
                        props.payload?.fullLabel ?? "",
                      ]}
                      labelFormatter={() => ""}
                    />
                    <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={48}>
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
            <div className="bg-background/30 rounded-xl p-6 border border-border/40">
              <h3 className="font-display font-semibold text-[10px] tracking-[0.25em] uppercase text-secondary mb-4 flex items-center gap-2">
                <Zap className="w-3 h-3" />
                Key Insights
              </h3>
              <ul className="space-y-3">
                {section.keyInsights.slice(0, 3).map((insight, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary/60 shrink-0 mt-2" />
                    <span className="text-sm text-muted-foreground leading-relaxed font-light line-clamp-3">
                      {insight}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* No data placeholder */}
          {!hasChartData && (!section.keyInsights || section.keyInsights.length === 0) && (
            <div className="col-span-full flex items-center justify-center h-32 text-muted-foreground/40 text-sm font-display tracking-widest uppercase">
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
    setDirection(dir);
    setActiveIndex(index);
  }, []);

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-primary font-display uppercase tracking-widest text-xs gap-2"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Full Report
              </Button>
            </Link>
            <div className="h-4 w-px bg-border/60" />
            <span className="font-serif font-bold text-sm tracking-widest text-foreground/60">
              STATE OF AI
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(0,240,255,0.8)]" />
            <span className="font-display text-[10px] uppercase tracking-[0.25em] text-primary/80">
              Visual Summary
            </span>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative px-6 pt-16 pb-12 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_60%,transparent_100%)] opacity-40 pointer-events-none" />
        <div className="max-w-[1400px] mx-auto relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="inline-flex items-center gap-3 bg-primary/5 border border-primary/20 px-4 py-1.5 rounded-full text-[10px] font-display tracking-[0.2em] uppercase mb-6 text-primary/80">
              <BarChart3 className="w-3 h-3" />
              Data Dashboard · March 2026
            </div>
            <h1 className="text-4xl lg:text-5xl font-serif font-black text-foreground/90 leading-tight mb-4">
              State of AI in{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
                Hong Kong Marketing
              </span>
            </h1>
            <p className="text-muted-foreground font-light max-w-2xl leading-relaxed">
              A visual breakdown of key data points, insights, and trends across{" "}
              {total || "all"} report sections. Updated automatically as new research is contributed.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Carousel */}
      <main className="max-w-[1400px] mx-auto px-6 pb-24">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 border-2 border-primary/20 rounded-full" />
              <div className="absolute inset-0 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground/40 gap-4">
            <BarChart3 className="w-12 h-12" />
            <p className="font-display uppercase tracking-widest text-sm">No report sections yet</p>
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
            <div className="flex items-center justify-between gap-4">
              {/* Prev button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={goPrev}
                disabled={activeIndex === 0}
                aria-label="Previous section"
                className="gap-2 font-display uppercase tracking-widest text-xs text-muted-foreground hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Prev</span>
              </Button>

              {/* Dots + counter */}
              <div className="flex flex-col items-center gap-3">
                {/* Dot indicators */}
                <div className="flex items-center gap-2">
                  {sortedSections.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => goTo(i, i > activeIndex ? 1 : -1)}
                      aria-label={`Go to section ${i + 1}`}
                      className={`rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                        i === activeIndex
                          ? "w-6 h-1.5 bg-primary shadow-[0_0_8px_rgba(0,240,255,0.6)]"
                          : "w-1.5 h-1.5 bg-border/60 hover:bg-primary/40"
                      }`}
                    />
                  ))}
                </div>
                {/* Counter */}
                <span className="font-display text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">
                  {activeIndex + 1} / {total}
                </span>
              </div>

              {/* Next button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={goNext}
                disabled={activeIndex === total - 1}
                aria-label="Next section"
                className="gap-2 font-display uppercase tracking-widest text-xs text-muted-foreground hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-12 px-6 bg-card/30">
        <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="font-serif font-bold text-2xl tracking-widest text-foreground/15 select-none">
            STATE OF AI / HK
          </span>
          <Link href="/">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-primary font-display uppercase tracking-widest text-xs gap-2"
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
