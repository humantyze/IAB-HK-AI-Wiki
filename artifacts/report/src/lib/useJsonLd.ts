import { useEffect } from "react";

export function useJsonLd(schema: Record<string, unknown> | null | undefined) {
  useEffect(() => {
    if (!schema) return;

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute("data-jsonld", "true");
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [JSON.stringify(schema)]);
}
