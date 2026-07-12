import { useEffect } from "react";

interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  ogImage?: string;
  ogType?: string;
}

const SITE_NAME = "HK AI Marketing Playbook";
const DEFAULT_OG_IMAGE = "/opengraph.jpg";

function setMetaTag(selector: string, content: string, attr: "name" | "property" = "name") {
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${selector}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, selector);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLinkTag(rel: string, href: string) {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function absoluteUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return window.location.origin + path;
}

export function usePageMeta(meta: PageMeta | null) {
  useEffect(() => {
    if (!meta) return;

    const { title, description, canonical, ogType = "article" } = meta;
    const ogImage = absoluteUrl(meta.ogImage ?? DEFAULT_OG_IMAGE);
    const pageTitle = `${title} — ${SITE_NAME}`;
    const canonicalAbs = absoluteUrl(canonical);

    document.title = pageTitle;

    setMetaTag("description", description);

    setLinkTag("canonical", canonicalAbs);

    setMetaTag("og:type", ogType, "property");
    setMetaTag("og:title", pageTitle, "property");
    setMetaTag("og:description", description, "property");
    setMetaTag("og:url", canonicalAbs, "property");
    setMetaTag("og:image", ogImage, "property");
    setMetaTag("og:site_name", SITE_NAME, "property");

    setMetaTag("twitter:card", "summary_large_image");
    setMetaTag("twitter:title", pageTitle);
    setMetaTag("twitter:description", description);
    setMetaTag("twitter:image", ogImage);

    return () => {
      document.title = SITE_NAME;
    };
  }, [meta?.title, meta?.description, meta?.canonical]);
}

export function markdownToPlainText(markdown: string, maxLength = 160): string {
  return markdown
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*>]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, maxLength)
    .replace(/\s+\S*$/, "")
    .concat("…");
}
