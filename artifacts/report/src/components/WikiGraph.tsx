import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useLocation } from "wouter";

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
const DEFAULT_NODE_COLOR = "#6b7280";
const FADED_NODE_COLOR = "#d1d5db";
const LINK_COLOR_ACTIVE = "#94a3b8";
const LINK_COLOR_FADED = "#e2e8f0";
const GRAPH_HEIGHT = 600;

type NodeDatum = {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  active: boolean;
  x?: number;
  y?: number;
};

export default function WikiGraph({ pages, allPages }: WikiGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [, navigate] = useLocation();

  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const activeSlugSet = useMemo(() => new Set(pages.map((p) => p.slug)), [pages]);

  const { nodes, links } = useMemo(() => {
    const slugSet = new Set(allPages.map((p) => p.slug));
    const nodes: NodeDatum[] = allPages.map((p) => ({
      id: p.slug,
      slug: p.slug,
      title: p.title,
      tags: p.tags,
      // active iff the page is in the current filtered set (handles both tag + search)
      active: activeSlugSet.has(p.slug),
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
    return { nodes, links };
  }, [allPages, activeSlugSet]);

  const getNodeColor = useCallback((node: NodeDatum): string => {
    if (!node.active) return FADED_NODE_COLOR;
    const tag = node.tags[0];
    return tag ? (TAG_HEX[tag] ?? DEFAULT_NODE_COLOR) : DEFAULT_NODE_COLOR;
  }, []);

  const getLinkColor = useCallback((link: { source: NodeDatum | string; target: NodeDatum | string }): string => {
    const src = typeof link.source === "string" ? link.source : link.source.slug;
    const tgt = typeof link.target === "string" ? link.target : link.target.slug;
    // A link is active only when both endpoints are in the current filtered set
    const active = activeSlugSet.has(src) && activeSlugSet.has(tgt);
    return active ? LINK_COLOR_ACTIVE : LINK_COLOR_FADED;
  }, [activeSlugSet]);

  const handleNodeClick = useCallback((node: NodeDatum) => {
    navigate(`/wiki/${node.slug}`);
  }, [navigate]);

  const paintNode = useCallback((
    node: NodeDatum,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    const radius = Math.max(5 / globalScale, 2);
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = getNodeColor(node);
    ctx.fill();

    if (globalScale >= 1.5) {
      const fontSize = Math.max(9 / globalScale, 3);
      ctx.font = `${fontSize}px Montserrat, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = node.active ? "#374151" : "#9ca3af";
      ctx.fillText(node.title, node.x ?? 0, (node.y ?? 0) + radius + 1.5 / globalScale);
    }
  }, [getNodeColor]);

  return (
    <div
      ref={containerRef}
      className="w-full"
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
          graphData={{ nodes, links }}
          width={containerWidth}
          height={GRAPH_HEIGHT}
          backgroundColor="#fafafa"
          nodeLabel={(node) => (node as NodeDatum).title}
          nodeColor={(node) => getNodeColor(node as NodeDatum)}
          nodeCanvasObject={(node, ctx, scale) => paintNode(node as NodeDatum, ctx, scale)}
          nodeCanvasObjectMode={() => "replace"}
          linkColor={(link) => getLinkColor(link as { source: NodeDatum | string; target: NodeDatum | string })}
          linkWidth={0.8}
          onNodeClick={(node) => handleNodeClick(node as NodeDatum)}
          enableNodeDrag
          enableZoomInteraction
          cooldownTicks={120}
        />
      )}
    </div>
  );
}
