import { forwardRef } from "react";

const RED = "#D63425";
const INK = "#1f1f1f";

export interface ShareCardProps {
  /** Eyebrow label — usually the page's primary tag. */
  tag: string;
  /** The headline sentence shown large on the card. */
  sentence: string;
  /** A statistic substring within the sentence to highlight in red. */
  stat?: string | null;
  /** Page title shown as the topic attribution. */
  title: string;
  /** Source attribution (e.g. report name or citation). */
  source?: string;
  logoSrc: string;
}

function fontSizeFor(len: number): number {
  if (len <= 70) return 70;
  if (len <= 110) return 60;
  if (len <= 160) return 50;
  if (len <= 210) return 42;
  return 36;
}

/** Render the sentence, highlighting the stat substring in brand red if present. */
function renderSentence(sentence: string, stat?: string | null) {
  if (stat) {
    const idx = sentence.toLowerCase().indexOf(stat.toLowerCase());
    if (idx !== -1) {
      const before = sentence.slice(0, idx);
      const match = sentence.slice(idx, idx + stat.length);
      const after = sentence.slice(idx + stat.length);
      return (
        <>
          {before}
          <span style={{ color: RED, fontWeight: 800 }}>{match}</span>
          {after}
        </>
      );
    }
  }
  return sentence;
}

/**
 * A fixed 1080×1080 branded card designed to be exported as a PNG via
 * html-to-image. Uses inline styles only so the export captures it faithfully.
 */
export const ShareCard = forwardRef<HTMLDivElement, ShareCardProps>(
  ({ tag, sentence, stat, title, source, logoSrc }, ref) => {
    const size = fontSizeFor(sentence.length);
    return (
      <div
        ref={ref}
        style={{
          width: 1080,
          height: 1080,
          backgroundColor: "#ffffff",
          fontFamily: "'Montserrat', sans-serif",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          padding: "84px 88px",
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        {/* Top accent bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 14,
            backgroundColor: RED,
          }}
        />

        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <img src={logoSrc} alt="IAB Hong Kong" crossOrigin="anonymous" style={{ height: 58, width: "auto" }} />
          <span
            style={{
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: 2.5,
              textTransform: "uppercase",
              color: "#9ca3af",
            }}
          >
            Hong Kong Bible of AI Adoption
          </span>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: RED,
              marginBottom: 36,
            }}
          >
            {tag}
          </div>
          <div style={{ display: "flex", gap: 32 }}>
            <div style={{ width: 8, backgroundColor: RED, borderRadius: 4, flexShrink: 0 }} />
            <p
              style={{
                margin: 0,
                fontSize: size,
                lineHeight: 1.22,
                fontWeight: 600,
                color: INK,
                letterSpacing: -0.5,
              }}
            >
              {renderSentence(sentence, stat)}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div>
          <div style={{ height: 1, backgroundColor: "#e5e7eb", marginBottom: 28 }} />
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
            }}
          >
            <div style={{ maxWidth: 620 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: INK, marginBottom: 6 }}>{title}</div>
              {source && (
                <div style={{ fontSize: 16, color: "#9ca3af", fontWeight: 500 }}>Source: {source}</div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 12, height: 12, borderRadius: 999, backgroundColor: RED }} />
              <span style={{ fontSize: 16, fontWeight: 600, color: "#6b7280" }}>
                State of AI in HK Marketing
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

ShareCard.displayName = "ShareCard";
