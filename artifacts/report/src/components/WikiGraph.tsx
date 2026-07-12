import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import ForceGraph2D, { ForceGraphMethods, NodeObject } from "react-force-graph-2d";
import { useLocation } from "wouter";
import { forceX, forceY, forceManyBody } from "d3-force";

interface WikiPageSummary {
  id: number;
  slug: string;
  title: string;
  tags: string[];
  relatedSlugs: string[];
  updatedAt: string;
  excerpt: string;
}

interface WikiGraphProps {
  pages: WikiPageSummary[];
  allPages: WikiPageSummary[];
}

const TAG_HEX: Record<string, string> = {
  "Organizations": "#3b82f6",
  "Statistics": "#8b5cf6",
  "Tools & Platforms": "#22c55e",
  "Regulatory": "#f97316",
  "Trends": "#ef4444",
  "Case Studies": "#eab308",
  "Frameworks": "#9ca3af",
};

const TAGS_ORDERED = [
  "Organizations",
  "Statistics",
  "Tools & Platforms",
  "Regulatory",
  "Trends",
  "Case Studies",
  "Frameworks",
];

const DEFAULT_NODE_COLOR = "#6b7280";
const FADED_NODE_COLOR = "#e5e7eb";
const LINK_COLOR_ACTIVE = "#94a3b8";
const LINK_COLOR_FADED = "#f1f5f9";
const GRAPH_HEIGHT = 620;
const MIN_RADIUS = 3.5;
const MAX_RADIUS = 11;

const CLUSTER_R = 260;
const CLUSTER_CENTERS: Record<string, { x: number; y: number }> = {};
TAGS_ORDERED.forEach((tag, i) => {
  const angle = (2 * Math.PI * i) / TAGS_ORDERED.length - Math.PI / 2;
  CLUSTER_CENTERS[tag] = {
    x: CLUSTER_R * Math.cos(angle),
    y: CLUSTER_R * Math.sin(angle),
  };
});

type NodeDatum = {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  x?: number;
  y?: number;
};

export default function WikiGraph({ pages, allPages }: WikiGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<NodeDatum> | undefined>(undefined);
  const [containerWidth, setContainerWidth] = useState(800);
  const [, navigate] = useLocation();

  useEffect(() => {
    const measure = () => {
      if (containerRef.current) setContainerWidth(containerRef.current.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const { graphData, degreeMap, maxDegree } = useMemo(() => {
    const slugSet = new Set(allPages.map((p) => p.slug));
    const nodes: NodeDatum[] = allPages.map((p) => ({
      id: p.slug,
      slug: p.slug,
      title: p.title,
      tags: p.tags,
    }));
    const seenLinks = new Set<string>();
    const links: { source: string; target: string }[] = [];
    for (const p of allPages) {
      for (const relSlug of p.relatedSlugs) {
        if (!slugSet.has(relSlug)) continue;
        const key = [p.slug, relSlug].sort().join("|");
        if (!seenLinks.has(key)) {
          seenLinks.add(key);
          links.push({ source: p.slug, target: relSlug });
        }
      }
    }
    const degreeMap: Record<string, number> = {};
    for (const link of links) {
      degreeMap[link.source] = (degreeMap[link.source] ?? 0) + 1;
      degreeMap[link.target] = (degreeMap[link.target] ?? 0) + 1;
    }
    const maxDegree = Math.max(1, ...Object.values(degreeMap));
    return { graphData: { nodes, links }, degreeMap, maxDegree };
  }, [allPages]);

  const activeSlugSet = useMemo(() => new Set(pages.map((p) => p.slug)), [pages]);
  const activeSlugSetRef = useRef(activeSlugSet);
  activeSlugSetRef.current = activeSlugSet;

  const forcesAppliedRef = useRef(false);
  useEffect(() => {
    if (!containerWidth || forcesAppliedRef.current) return;
    forcesAppliedRef.current = true;
    let zoomTimer: ReturnType<typeof setTimeout> | null = null;
    const applyTimer = setTimeout(() => {
      if (!graphRef.current) return;
      graphRef.current.d3Force(
        "x",
        forceX<NodeObject<NodeDatum>>((node) => CLUSTER_CENTERS[node.tags[0]]?.x ?? 0).strength(0.12),
      );
      graphRef.current.d3Force(
        "y",
        forceY<NodeObject<NodeDatum>>((node) => CLUSTER_CENTERS[node.tags[0]]?.y ?? 0).strength(0.12),
      );
      graphRef.current.d3Force("charge", forceManyBody<NodeObject<NodeDatum>>().strength(-120));
      graphRef.current.d3ReheatSimulation();
      zoomTimer = setTimeout(() => {
        graphRef.current?.zoom(2.5, 800);
      }, 1400);
    }, 120);
    return () => {
      clearTimeout(applyTimer);
      if (zoomTimer !== null) clearTimeout(zoomTimer);
    };
  }, [containerWidth]);

  const getRadius = useCallback(
    (slug: string): number => {
      const degree = degreeMap[slug] ?? 0;
      return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * (degree / maxDegree);
    },
    [degreeMap, maxDegree],
  );

  const getNodeColor = useCallback((slug: string, tags: string[]): string => {
    if (!activeSlugSetRef.current.has(slug)) return FADED_NODE_COLOR;
    const tag = tags[0];
    return tag ? (TAG_HEX[tag] ?? DEFAULT_NODE_COLOR) : DEFAULT_NODE_COLOR;
  }, []);

  const getLinkColor = useCallback(
    (link: { source: NodeDatum | string; target: NodeDatum | string }): string => {
      const src = typeof link.source === "string" ? link.source : link.source.slug;
      const tgt = typeof link.target === "string" ? link.target : link.target.slug;
      return activeSlugSetRef.current.has(src) && activeSlugSetRef.current.has(tgt)
        ? LINK_COLOR_ACTIVE
        : LINK_COLOR_FADED;
    },
    [],
  );

  const handleNodeClick = useCallback(
    (node: NodeDatum) => navigate(`/wiki/${node.slug}`),
    [navigate],
  );

  const nodeCanvasObjectMode = useCallback(() => "replace" as const, []);
  const nodeLabel = useCallback((node: object) => (node as NodeDatum).title, []);

  const paintNode = useCallback(
    (node: NodeDatum, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const radius = getRadius(node.slug);
      const isActive = activeSlugSetRef.current.has(node.slug);
      const color = isActive
        ? (node.tags[0] ? (TAG_HEX[node.tags[0]] ?? DEFAULT_NODE_COLOR) : DEFAULT_NODE_COLOR)
        : FADED_NODE_COLOR;

      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI, false);
      ctx.fillStyle = color;
      ctx.fill();

      const baseFontSize = 10;
      const fontSize = Math.max(baseFontSize / globalScale, 2.5);
      const maxChars = globalScale < 1.2 ? 12 : globalScale < 2 ? 18 : 25;
      const label =
        node.title.length > maxChars
          ? node.title.slice(0, maxChars - 1) + "…"
          : node.title;

      ctx.font = `${fontSize}px Montserrat, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = isActive ? "#374151" : "#d1d5db";
      ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + radius + 1.5 / globalScale);
    },
    [getRadius],
  );

  const legendTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const page of pages) {
      if (page.tags[0] && TAG_HEX[page.tags[0]]) tagSet.add(page.tags[0]);
    }
    return TAGS_ORDERED.filter((t) => tagSet.has(t));
  }, [pages]);

  return (
    <div
      ref={containerRef}
      className="w-full relative"
      style={{
        height: `${GRAPH_HEIGHT}px`,
        borderRadius: "12px",
        overflow: "hidden",
        border: "1px solid #f3f4f6",
        background: "#fafafa",
      }}
    >
      {containerWidth > 0 && (
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          width={containerWidth}
          height={GRAPH_HEIGHT}
          backgroundColor="#fafafa"
          nodeLabel={nodeLabel}
          nodeCanvasObject={(node, ctx, scale) =>
            paintNode(node as NodeDatum, ctx, scale)
          }
          nodeCanvasObjectMode={nodeCanvasObjectMode}
          linkColor={(link) =>
            getLinkColor(
              link as { source: NodeDatum | string; target: NodeDatum | string },
            )
          }
          linkWidth={0.8}
          onNodeClick={(node) => handleNodeClick(node as NodeDatum)}
          enableNodeDrag
          enableZoomInteraction
          cooldownTicks={150}
          autoPauseRedraw={false}
        />
      )}

      <div
        style={{
          position: "absolute",
          bottom: 12,
          left: 12,
          background: "rgba(255,255,255,0.92)",
          border: "1px solid #f3f4f6",
          borderRadius: 8,
          padding: "8px 10px",
          fontSize: 10,
          lineHeight: "1.75",
          backdropFilter: "blur(4px)",
          pointerEvents: "none",
          zIndex: 10,
          fontFamily: "'Montserrat', sans-serif",
        }}
      >
        {legendTags.map((tag) => (
          <div key={tag} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: TAG_HEX[tag],
                flexShrink: 0,
              }}
            />
            <span style={{ color: "#374151" }}>{tag}</span>
          </div>
        ))}
        <div
          style={{
            borderTop: "1px solid #f3f4f6",
            marginTop: 5,
            paddingTop: 4,
            color: "#9ca3af",
            fontStyle: "italic",
          }}
        >
          Scroll to zoom · Drag to pan · Click to open
        </div>
      </div>
    </div>
  );
}
