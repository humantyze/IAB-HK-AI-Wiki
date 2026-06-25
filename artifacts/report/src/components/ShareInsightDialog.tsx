import { useRef, useState, useEffect } from "react";
import { toPng } from "html-to-image";
import { Download, Copy, Share2, Check, ImageIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ShareCard } from "@/components/ShareCard";
import type { Insight } from "@/lib/insights";

const PREVIEW_WIDTH = 420;
const SCALE = PREVIEW_WIDTH / 1080;

interface ShareInsightDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  tag: string;
  source?: string;
  insights: Insight[];
  logoSrc: string;
}

async function renderCard(node: HTMLElement): Promise<string> {
  await document.fonts.ready;
  return toPng(node, { width: 1080, height: 1080, pixelRatio: 1, cacheBust: true });
}

function fileName(title: string): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)}-insight.png`;
}

export function ShareInsightDialog({
  open,
  onOpenChange,
  title,
  tag,
  source,
  insights,
  logoSrc,
}: ShareInsightDialogProps) {
  const { toast } = useToast();
  const cardRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState<null | "download" | "copy" | "share">(null);
  const [copied, setCopied] = useState(false);
  const [canShareFiles, setCanShareFiles] = useState(false);

  useEffect(() => {
    if (open) setSelected(0);
  }, [open]);

  useEffect(() => {
    try {
      setCanShareFiles(
        typeof navigator !== "undefined" &&
          typeof navigator.canShare === "function" &&
          typeof File !== "undefined" &&
          navigator.canShare({ files: [new File([], "x.png", { type: "image/png" })] }),
      );
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  const active = insights[selected];

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setBusy("download");
    try {
      const dataUrl = await renderCard(cardRef.current);
      const link = document.createElement("a");
      link.download = fileName(title);
      link.href = dataUrl;
      link.click();
    } catch {
      toast({ title: "Couldn't generate image", description: "Please try again.", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    if (!cardRef.current) return;
    setBusy("copy");
    try {
      const dataUrl = await renderCard(cardRef.current);
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied to clipboard", description: "Paste the image anywhere." });
    } catch {
      toast({
        title: "Copy not supported",
        description: "Use Download instead.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async () => {
    if (!cardRef.current) return;
    setBusy("share");
    try {
      const dataUrl = await renderCard(cardRef.current);
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], fileName(title), { type: "image/png" });
      await navigator.share({ files: [file], title, text: active?.sentence });
    } catch {
      /* user cancelled or share failed — no-op */
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl p-0 overflow-hidden"
        style={{ fontFamily: "'Montserrat', sans-serif" }}
      >
        <div className="flex flex-col md:flex-row max-h-[85vh]">
          {/* Preview */}
          <div className="bg-gray-50 p-6 flex items-center justify-center md:w-[480px] flex-shrink-0 border-b md:border-b-0 md:border-r border-gray-100">
            <div
              style={{
                width: PREVIEW_WIDTH,
                height: PREVIEW_WIDTH,
                maxWidth: "100%",
                overflow: "hidden",
                borderRadius: 12,
                boxShadow: "0 10px 40px rgba(0,0,0,0.12)",
              }}
            >
              <div style={{ transform: `scale(${SCALE})`, transformOrigin: "top left" }}>
                {active && (
                  <ShareCard
                    ref={cardRef}
                    tag={tag}
                    sentence={active.sentence}
                    stat={active.stat}
                    title={title}
                    source={source}
                    logoSrc={logoSrc}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex-1 flex flex-col min-w-0 p-6">
            <DialogHeader className="mb-4 text-left">
              <DialogTitle className="flex items-center gap-2 text-lg">
                <ImageIcon size={18} style={{ color: "#D63425" }} />
                Share an insight
              </DialogTitle>
              <DialogDescription>
                Pick a statistic or takeaway to turn into a branded image for LinkedIn, X, or your newsletter.
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
              {insights.length === 0 && (
                <p className="text-sm text-gray-400 py-8 text-center">
                  No shareable insights found on this page.
                </p>
              )}
              {insights.map((ins, i) => (
                <button
                  key={ins.id}
                  onClick={() => setSelected(i)}
                  className="block w-full text-left rounded-lg border p-3 transition-all"
                  style={{
                    borderColor: i === selected ? "#D63425" : "#e5e7eb",
                    backgroundColor: i === selected ? "rgba(214,52,37,0.04)" : "#fff",
                  }}
                >
                  {ins.stat && (
                    <span className="text-xs font-bold mr-1.5" style={{ color: "#D63425" }}>
                      {ins.stat}
                    </span>
                  )}
                  <span className="text-xs text-gray-600 leading-relaxed">{ins.sentence}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 pt-4 mt-2 border-t border-gray-100">
              <button
                onClick={handleDownload}
                disabled={!active || busy !== null}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: "#D63425" }}
              >
                {busy === "download" ? (
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <Download size={15} />
                )}
                Download
              </button>
              <button
                onClick={handleCopy}
                disabled={!active || busy !== null}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {busy === "copy" ? (
                  <span className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                ) : copied ? (
                  <Check size={15} style={{ color: "#16a34a" }} />
                ) : (
                  <Copy size={15} />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
              {canShareFiles && (
                <button
                  onClick={handleShare}
                  disabled={!active || busy !== null}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {busy === "share" ? (
                    <span className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                  ) : (
                    <Share2 size={15} />
                  )}
                  Share
                </button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
