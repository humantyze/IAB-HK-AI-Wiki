import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { ArrowLeft, ChevronRight, Lightbulb, CheckCircle2, XCircle } from "lucide-react";
import { usePageMeta } from "@/hooks/usePageMeta";

interface KnowledgeCitation {
  index: number;
  sourceType: string;
  sourceSlug: string | null;
  title: string;
  similarity: number;
}

interface QuizEntry {
  question: string;
  choices: string[];
  correctIndex: number;
  answer: string;
  citations: KnowledgeCitation[];
}

const FALLBACK_QUESTIONS = [
  "How does the Ad Context Protocol work?",
  "What is the Agentic Real-Time Framework?",
  "What problem does the Prebid Sales Agent solve?",
  "How do AI agents negotiate media deals?",
  "What is the Agentic Advertising Organization?",
  "How are walled gardens affecting programmatic advertising?",
  "What is NBCUniversal doing with agentic automation?",
  "What did the PubMatic–Butler/Till–Geloso PoC show?",
  "What is PubMatic forecasting for agentic execution?",
  "How many marketers want agentic media buying?",
];

const OPTION_LABELS = ["A", "B", "C", "D"];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleChoices(entry: QuizEntry): QuizEntry {
  const correct = entry.choices[entry.correctIndex];
  const shuffled = shuffle(entry.choices);
  return { ...entry, choices: shuffled, correctIndex: shuffled.indexOf(correct) };
}

function renderInlineWithCitations(
  text: string,
  citations: KnowledgeCitation[],
  keyPrefix: string,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const markerRegex = /(\[\d+\])+/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = markerRegex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const nums = [...match[0].matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1]));
    parts.push(
      <sup key={`${keyPrefix}-cite-${match.index}`} className="ml-0.5">
        {nums.map((n, i) => {
          const cit = citations.find((c) => c.index === n);
          return (
            <a
              key={n}
              href={cit?.sourceSlug ? `#citation-${n}` : undefined}
              className="text-[#D63425] font-bold hover:underline"
              style={{ fontSize: "0.68em" }}
            >
              {i > 0 ? "," : ""}[{n}]
            </a>
          );
        })}
      </sup>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function renderAnswerWithCitations(
  answer: string,
  citations: KnowledgeCitation[],
): React.ReactNode[] {
  const paragraphs = answer
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) return renderInlineWithCitations(answer, citations, "p0");
  return paragraphs.map((para, i) => (
    <p key={i} className={i > 0 ? "mt-3" : undefined}>
      {renderInlineWithCitations(para, citations, `p${i}`)}
    </p>
  ));
}

type Phase = "question" | "revealed" | "done";

export default function QuizPage() {
  const baseUrl = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  const [loading, setLoading] = useState(true);

  // MCQ mode
  const [mcqEntries, setMcqEntries] = useState<QuizEntry[]>([]);

  // Streaming fallback (no MCQ cache)
  const [streamQuestions, setStreamQuestions] = useState<string[]>([]);
  const [ragAnswer, setRagAnswer] = useState<string | null>(null);
  const [ragCitations, setRagCitations] = useState<KnowledgeCitation[] | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const pendingTokensRef = useRef<string[]>([]);
  const rafRef = useRef<number | null>(null);
  const streamEndedRef = useRef(false);

  // Shared state
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("question");

  // MCQ-specific state
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Streaming fallback specific
  const [userAnswer, setUserAnswer] = useState("");

  usePageMeta({
    title: "Test your knowledge — Knowledge Base",
    description:
      "Test your understanding of AI trends in Hong Kong marketing with questions drawn from the knowledge base.",
    canonical: "/quiz",
    ogType: "website",
  });

  useEffect(() => {
    fetch(`${baseUrl}/api/knowledge/quiz`, { credentials: "include" })
      .then((r) => r.json())
      .then((data: unknown) => {
        const entries = (data as { entries?: QuizEntry[] }).entries;
        if (Array.isArray(entries) && entries.length > 0) {
          setMcqEntries(shuffle(entries).map(shuffleChoices));
        } else {
          // fallback: load plain questions for streaming mode
          return fetch(`${baseUrl}/api/knowledge/questions`, { credentials: "include" })
            .then((r) => r.json())
            .then((qdata: unknown) => {
              const qs = (qdata as { questions?: string[] }).questions;
              setStreamQuestions(
                Array.isArray(qs) && qs.length > 0
                  ? shuffle(qs)
                  : shuffle(FALLBACK_QUESTIONS),
              );
            });
        }
      })
      .catch(() => setStreamQuestions(shuffle(FALLBACK_QUESTIONS)))
      .finally(() => setLoading(false));
  }, [baseUrl]);

  const hasMcq = mcqEntries.length > 0;
  const total = hasMcq ? mcqEntries.length : streamQuestions.length;
  const currentEntry = hasMcq ? mcqEntries[index] : null;
  const currentStreamQuestion = !hasMcq ? streamQuestions[index] ?? "" : "";

  // ── Streaming helpers (fallback only) ──────────────────────────────────────
  const handleToken = useCallback((token: string) => {
    pendingTokensRef.current.push(token);
    if (rafRef.current === null) {
      const drain = () => {
        if (pendingTokensRef.current.length > 0) {
          const batch = pendingTokensRef.current.splice(0, 3);
          setRagAnswer((prev) => (prev ?? "") + batch.join(""));
          rafRef.current = requestAnimationFrame(drain);
        } else if (streamEndedRef.current) {
          setIsStreaming(false);
          streamEndedRef.current = false;
          rafRef.current = null;
        } else {
          rafRef.current = null;
        }
      };
      rafRef.current = requestAnimationFrame(drain);
    }
  }, []);

  const streamAnswer = useCallback(
    async (question: string) => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setRagAnswer(null);
      setRagCitations(null);
      setIsStreaming(true);
      pendingTokensRef.current = [];
      streamEndedRef.current = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      let r: Response;
      try {
        r = await fetch(`${baseUrl}/api/knowledge/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({ query: question }),
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") setIsStreaming(false);
        return;
      }
      if (!r.ok) { setIsStreaming(false); return; }
      const ct = r.headers.get("content-type") ?? "";
      if (ct.includes("text/event-stream") && r.body) {
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split("\n\n");
            buffer = events.pop() ?? "";
            for (const block of events) {
              if (!block.trim()) continue;
              let eventType = "";
              const dataLines: string[] = [];
              for (const line of block.split("\n")) {
                if (line.startsWith("event: ")) eventType = line.slice(7).trim();
                else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
                else if (line === "data:") dataLines.push("");
              }
              const data = dataLines.join("\n");
              if (eventType === "citations") {
                try { setRagCitations(JSON.parse(data) as KnowledgeCitation[]); } catch { /* ignore */ }
              } else if (eventType === "token") {
                try { handleToken(JSON.parse(data) as string); } catch { /* ignore */ }
              }
            }
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
        } finally {
          streamEndedRef.current = true;
          if (rafRef.current === null) { setIsStreaming(false); streamEndedRef.current = false; }
        }
      } else {
        try {
          const rag = (await r.json()) as { answer?: string; citations?: KnowledgeCitation[] };
          if (rag.answer) setRagAnswer(rag.answer.trim());
          setRagCitations(rag.citations ?? []);
        } catch { /* ignore */ }
        setIsStreaming(false);
      }
    },
    [baseUrl, handleToken],
  );

  const resetStream = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    pendingTokensRef.current = [];
    streamEndedRef.current = false;
    setRagAnswer(null);
    setRagCitations(null);
    setIsStreaming(false);
  }, []);

  // ── Navigation ──────────────────────────────────────────────────────────────
  const handleNext = useCallback(() => {
    if (!hasMcq) resetStream();
    setUserAnswer("");
    setSelectedIndex(null);
    const nextIndex = index + 1;
    setIndex(nextIndex);
    setPhase(nextIndex >= total ? "done" : "question");
  }, [hasMcq, index, total, resetStream]);

  // ── MCQ selection ───────────────────────────────────────────────────────────
  const handleSelect = useCallback(
    (i: number) => {
      if (selectedIndex !== null) return;
      setSelectedIndex(i);
      setPhase("revealed");
    },
    [selectedIndex],
  );

  // ── Streaming fallback actions ──────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    setPhase("revealed");
    streamAnswer(currentStreamQuestion);
  }, [currentStreamQuestion, streamAnswer]);

  const handleReveal = useCallback(() => {
    setPhase("revealed");
    streamAnswer(currentStreamQuestion);
  }, [currentStreamQuestion, streamAnswer]);

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="min-h-screen bg-white flex items-center justify-center"
        style={{ fontFamily: "'Montserrat', sans-serif" }}
      >
        <span className="text-sm text-gray-400">Loading quiz…</span>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div
        className="min-h-screen bg-white flex items-center justify-center"
        style={{ fontFamily: "'Montserrat', sans-serif" }}
      >
        <span className="text-sm text-gray-400">No questions available yet.</span>
      </div>
    );
  }

  // ── Shell (header + layout) ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Montserrat', sans-serif" }}>
      <div style={{ backgroundColor: "#D63425" }} className="h-1 w-full" />

      <header className="border-b border-gray-100 bg-white sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 lg:px-8 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Back to wiki</span>
          </Link>
          <div className="flex items-center gap-2 ml-auto">
            <Lightbulb size={14} style={{ color: "#D63425" }} />
            <span className="text-sm font-semibold text-gray-700">Test your knowledge</span>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 lg:px-8 py-10">
        {phase === "done" ? (
          <CompletionCard total={total} />
        ) : (
          <>
            {/* Progress */}
            <div className="flex items-center gap-3 mb-6">
              <span className="text-xs px-3 py-1 rounded-full bg-gray-100 text-gray-500 font-medium">
                {index + 1} of {total}
              </span>
              <div className="flex-1 h-1 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    backgroundColor: "#D63425",
                    width: `${((index + 1) / total) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* Question card */}
            <div className="border border-gray-100 rounded-xl bg-white shadow-sm p-6">
              <p
                className="text-xs font-semibold uppercase tracking-widest mb-3"
                style={{ color: "#D63425" }}
              >
                Question
              </p>
              <h2 className="text-base font-bold text-gray-800 leading-snug mb-5">
                {hasMcq ? currentEntry!.question : currentStreamQuestion}
              </h2>

              {hasMcq ? (
                <McqBody
                  entry={currentEntry!}
                  selectedIndex={selectedIndex}
                  onSelect={handleSelect}
                  onNext={handleNext}
                  isLast={index + 1 >= total}
                />
              ) : (
                <StreamingBody
                  phase={phase}
                  userAnswer={userAnswer}
                  setUserAnswer={setUserAnswer}
                  onSubmit={handleSubmit}
                  onReveal={handleReveal}
                  onNext={handleNext}
                  ragAnswer={ragAnswer}
                  ragCitations={ragCitations}
                  isStreaming={isStreaming}
                  isLast={index + 1 >= total}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── MCQ body ──────────────────────────────────────────────────────────────────
function McqBody({
  entry,
  selectedIndex,
  onSelect,
  onNext,
  isLast,
}: {
  entry: QuizEntry;
  selectedIndex: number | null;
  onSelect: (i: number) => void;
  onNext: () => void;
  isLast: boolean;
}) {
  const revealed = selectedIndex !== null;

  return (
    <>
      <div className="flex flex-col gap-2 mb-5">
        {entry.choices.map((choice, i) => {
          const isSelected = selectedIndex === i;
          const isCorrect = i === entry.correctIndex;
          let borderColor = "border-gray-200";
          let bgColor = "bg-white";
          let textColor = "text-gray-700";
          let labelBg = "bg-gray-100";
          let labelText = "text-gray-500";

          if (revealed) {
            if (isCorrect) {
              borderColor = "border-green-400";
              bgColor = "bg-green-50";
              textColor = "text-green-800";
              labelBg = "bg-green-400";
              labelText = "text-white";
            } else if (isSelected) {
              borderColor = "border-red-400";
              bgColor = "bg-red-50";
              textColor = "text-red-800";
              labelBg = "bg-red-400";
              labelText = "text-white";
            } else {
              textColor = "text-gray-400";
              labelText = "text-gray-400";
              labelBg = "bg-gray-50";
            }
          }

          return (
            <button
              key={i}
              onClick={() => onSelect(i)}
              disabled={revealed}
              className={`w-full flex items-start gap-3 px-4 py-3 rounded-lg border text-left transition-all ${borderColor} ${bgColor} ${revealed ? "cursor-default" : "hover:border-gray-400 hover:bg-gray-50 cursor-pointer"}`}
            >
              <span
                className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${labelBg} ${labelText}`}
              >
                {OPTION_LABELS[i]}
              </span>
              <span className={`text-sm leading-snug ${textColor}`}>{choice}</span>
              {revealed && isCorrect && (
                <CheckCircle2 size={16} className="ml-auto shrink-0 mt-0.5 text-green-500" />
              )}
              {revealed && isSelected && !isCorrect && (
                <XCircle size={16} className="ml-auto shrink-0 mt-0.5 text-red-500" />
              )}
            </button>
          );
        })}
      </div>

      {/* Result feedback */}
      {revealed && selectedIndex !== null && (
        <div className="mb-4">
          {selectedIndex === entry.correctIndex ? (
            <p className="text-sm font-semibold text-green-700">Correct!</p>
          ) : (
            <p className="text-sm font-semibold text-red-700">
              Incorrect — the correct answer is{" "}
              <span className="font-bold">{OPTION_LABELS[entry.correctIndex]}</span>.
            </p>
          )}
        </div>
      )}

      {/* Cached KB answer */}
      {revealed && (
        <div className="border-t border-gray-100 pt-5">
          <p
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: "#D63425" }}
          >
            Knowledge base answer
          </p>
          <div className="text-sm text-gray-700 leading-relaxed">
            {renderAnswerWithCitations(entry.answer, entry.citations)}
          </div>

          {entry.citations.filter((c) => c.sourceSlug).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {entry.citations
                .filter((c) => c.sourceSlug)
                .map((c) => (
                  <Link
                    key={c.index}
                    href={`/wiki/${c.sourceSlug}`}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-[#D63425]/20 bg-white hover:bg-[#D63425]/5 transition-colors"
                    style={{ color: "#D63425" }}
                  >
                    <span className="font-bold text-[10px] opacity-60">[{c.index}]</span>
                    <span className="truncate max-w-[180px]">{c.title}</span>
                  </Link>
                ))}
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <button
              onClick={onNext}
              className="flex items-center gap-1.5 text-sm font-medium text-white rounded-full px-4 py-2 transition-opacity hover:opacity-90"
              style={{ backgroundColor: "#D63425" }}
            >
              {isLast ? "Finish" : "Next question"}
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Streaming fallback body ───────────────────────────────────────────────────
function StreamingBody({
  phase,
  userAnswer,
  setUserAnswer,
  onSubmit,
  onReveal,
  onNext,
  ragAnswer,
  ragCitations,
  isStreaming,
  isLast,
}: {
  phase: Phase;
  userAnswer: string;
  setUserAnswer: (v: string) => void;
  onSubmit: () => void;
  onReveal: () => void;
  onNext: () => void;
  ragAnswer: string | null;
  ragCitations: KnowledgeCitation[] | null;
  isStreaming: boolean;
  isLast: boolean;
}) {
  return (
    <>
      {phase === "question" && (
        <>
          <textarea
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            placeholder="Write your answer here… (optional)"
            rows={4}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 text-gray-700 placeholder-gray-400 focus:outline-none focus:border-gray-400 resize-none mb-4"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={onSubmit}
              className="text-sm font-medium text-white rounded-full px-4 py-2 transition-opacity hover:opacity-90"
              style={{ backgroundColor: "#D63425" }}
            >
              Submit answer
            </button>
            <button
              onClick={onReveal}
              className="text-sm text-gray-500 border border-gray-200 rounded-full px-4 py-2 hover:border-gray-400 hover:text-gray-700 transition-colors"
            >
              Reveal answer
            </button>
          </div>
        </>
      )}

      {phase === "revealed" && (
        <>
          {userAnswer.trim() && (
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
                Your answer
              </p>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {userAnswer.trim()}
              </p>
            </div>
          )}

          <div className={userAnswer.trim() ? "border-t border-gray-100 pt-5" : undefined}>
            <p
              className="text-xs font-semibold uppercase tracking-widest mb-3"
              style={{ color: "#D63425" }}
            >
              Knowledge base answer
            </p>
            <div className="text-sm text-gray-700 leading-relaxed">
              {ragAnswer !== null ? (
                <>
                  {renderAnswerWithCitations(ragAnswer, ragCitations ?? [])}
                  {isStreaming && <span className="cite-cursor ml-0.5" />}
                </>
              ) : isStreaming ? (
                <span className="text-gray-400 text-xs">
                  Searching knowledge base<span className="cite-cursor ml-0.5" />
                </span>
              ) : (
                <span className="text-gray-400 text-xs">No answer found in knowledge base.</span>
              )}
            </div>

            {ragCitations && ragCitations.filter((c) => c.sourceSlug).length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {ragCitations
                  .filter((c) => c.sourceSlug)
                  .map((c) => (
                    <Link
                      key={c.index}
                      id={`citation-${c.index}`}
                      href={`/wiki/${c.sourceSlug}`}
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-[#D63425]/20 bg-white hover:bg-[#D63425]/5 transition-colors"
                      style={{ color: "#D63425" }}
                    >
                      <span className="font-bold text-[10px] opacity-60">[{c.index}]</span>
                      <span className="truncate max-w-[180px]">{c.title}</span>
                    </Link>
                  ))}
              </div>
            )}
          </div>

          {!isStreaming && (
            <div className="mt-5 flex justify-end">
              <button
                onClick={onNext}
                className="flex items-center gap-1.5 text-sm font-medium text-white rounded-full px-4 py-2 transition-opacity hover:opacity-90"
                style={{ backgroundColor: "#D63425" }}
              >
                {isLast ? "Finish" : "Next question"}
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── Completion card ───────────────────────────────────────────────────────────
function CompletionCard({ total }: { total: number }) {
  return (
    <div className="border border-gray-100 rounded-xl bg-white shadow-sm p-10 text-center">
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
        style={{ backgroundColor: "#D63425" }}
      >
        <Lightbulb size={22} className="text-white" />
      </div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">You explored {total} questions</h2>
      <p className="text-sm text-gray-500 mb-6">Dive deeper into the topics that caught your attention.</p>
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm font-medium text-white rounded-full px-5 py-2.5 transition-colors"
        style={{ backgroundColor: "#D63425" }}
      >
        <ArrowLeft size={13} />
        Back to wiki
      </Link>
    </div>
  );
}
