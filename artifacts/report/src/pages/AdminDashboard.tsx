import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import {
  LogOut, Upload as UploadIcon, Hand,
  Paperclip, X, Sparkles, FileText,
  BookOpen, Check, PlusCircle, Eye, Layers, Image,
  AlertTriangle, AlertCircle, History, ChevronDown, ChevronUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useSubmitUpload, useUploads, UploadError } from "@/hooks/use-uploads";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

const uploadSchema = z.object({
  uploaderName: z.string().min(1, "Name is required"),
  uploaderEmail: z.string().min(1, "Work email is required").email("Must be a valid email address"),
  contributorName: z.string().optional(),
  contentType: z.enum(["whitepaper", "case_study", "market_data", "regulation_update", "trend_insight"]),
  rawText: z.string().optional(),
  responsibleAi: z.boolean().optional().default(false),
});

type StepDef = { label: string; detail: string; Icon: LucideIcon; afterSeconds: number };

function getStepsForFile(file: File | null): StepDef[] {
  const mime = file?.type ?? "";
  const name = file?.name?.toLowerCase() ?? "";

  if (mime === "application/pdf") {
    return [
      { label: "Reading document", detail: "Extracting text from PDF pages…", Icon: FileText, afterSeconds: 0 },
      { label: "Analysing images", detail: "Using AI vision to interpret charts and diagrams…", Icon: Eye, afterSeconds: 5 },
      { label: "Building wiki pages", detail: "Generating knowledge pages from extracted content…", Icon: BookOpen, afterSeconds: 22 },
    ];
  }
  if (mime.includes("presentationml") || name.endsWith(".pptx")) {
    return [
      { label: "Reading presentation", detail: "Opening and parsing slide structure…", Icon: FileText, afterSeconds: 0 },
      { label: "Parsing slides", detail: "Extracting text, images, and speaker notes from each slide…", Icon: Layers, afterSeconds: 4 },
      { label: "Building wiki pages", detail: "Generating knowledge pages from slide content…", Icon: BookOpen, afterSeconds: 18 },
    ];
  }
  if (mime.includes("wordprocessingml") || name.endsWith(".docx") || name.endsWith(".doc")) {
    return [
      { label: "Reading document", detail: "Parsing document structure and formatting…", Icon: FileText, afterSeconds: 0 },
      { label: "Extracting content", detail: "Pulling text, tables, and embedded elements…", Icon: Layers, afterSeconds: 3 },
      { label: "Building wiki pages", detail: "Generating knowledge pages from document content…", Icon: BookOpen, afterSeconds: 12 },
    ];
  }
  if (mime.startsWith("image/")) {
    return [
      { label: "Reading image", detail: "Loading and preparing image for analysis…", Icon: Image, afterSeconds: 0 },
      { label: "Analysing with AI", detail: "Using computer vision to interpret visual content…", Icon: Eye, afterSeconds: 2 },
      { label: "Building wiki pages", detail: "Generating knowledge pages from visual content…", Icon: BookOpen, afterSeconds: 14 },
    ];
  }
  return [
    { label: "Processing content", detail: "Parsing and preparing submitted material…", Icon: FileText, afterSeconds: 0 },
    { label: "Building wiki pages", detail: "Extracting knowledge pages from your content…", Icon: BookOpen, afterSeconds: 8 },
  ];
}

interface ErrorCopy {
  headline: string;
  body: string;
  action: string;
}

function getErrorCopy(code: string): ErrorCopy {
  switch (code) {
    case "EXTRACTION_EMPTY":
      return {
        headline: "We couldn't read your file",
        body: "The PDF appears to be scanned or image-only and couldn't be read automatically.",
        action: "Please upload a text-based PDF, or reach out to the IAB HK team.",
      };
    case "TEXT_EXTRACTION_FAILED":
      return {
        headline: "We couldn't read your file",
        body: "The file could not be read — it may be corrupt or in an unsupported format.",
        action: "Please upload a text-based PDF, or reach out to the IAB HK team.",
      };
    case "UNSUPPORTED_FILE_TYPE":
      return {
        headline: "File type not supported",
        body: "Only PDF, DOCX, and Markdown files can be processed.",
        action: "Convert your document and try again.",
      };
    case "DUPLICATE_UPLOAD":
      return {
        headline: "Already submitted",
        body: "This document has already been uploaded and processed.",
        action: "Delete the original submission first if you need to reprocess it.",
      };
    default:
      return {
        headline: "Something went wrong",
        body: "An unexpected error occurred while processing your file.",
        action: "Please try again, or contact the IAB HK team if it keeps happening.",
      };
  }
}

export default function AdminDashboard() {
  const { isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const [, setLocation] = useLocation();
  const submitUpload = useSubmitUpload();
  const { toast } = useToast();

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState(0);
  const [activeSteps, setActiveSteps] = useState<StepDef[]>([]);

  const [uploadError, setUploadError] = useState<{ code: string; meta?: Record<string, unknown> } | null>(null);

  const [submitResult, setSubmitResult] = useState<{
    fileNames: string[];
    wikiCountBefore: number;
    uploadId: number;
  } | null>(null);
  const [wikiCountAfter, setWikiCountAfter] = useState<number | null>(null);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const [isSlowProcessing, setIsSlowProcessing] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [isRechecking, setIsRechecking] = useState(false);

  const { data: uploads } = useUploads();
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);

  useEffect(() => {
    if (!isSubmitting) {
      setSubmitStep(0);
      return;
    }
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 1;
      setSubmitStep((prev) => {
        const next = prev + 1;
        if (next < activeSteps.length && elapsed >= activeSteps[next].afterSeconds) {
          return next;
        }
        return prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isSubmitting, activeSteps]);

  const form = useForm<z.infer<typeof uploadSchema>>({
    resolver: zodResolver(uploadSchema),
    defaultValues: { uploaderName: "", uploaderEmail: "", contentType: "market_data", contributorName: "", rawText: "", responsibleAi: false },
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setLocation("/admin/login");
    }
  }, [authLoading, isAuthenticated, setLocation]);

  useEffect(() => {
    if (!isPolling || !submitResult) return;
    let attempts = 0;
    const MAX_ATTEMPTS = 72;
    const SLOW_THRESHOLD = 36;
    const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

    const poll = async () => {
      if (attempts >= MAX_ATTEMPTS) { setIsPolling(false); setPollTimedOut(true); return; }
      if (attempts === SLOW_THRESHOLD) { setIsSlowProcessing(true); }
      attempts++;
      try {
        // Primary: poll upload status so partial outcomes are never masked by early wiki-count growth
        const statusRes = await fetch(`${baseUrl}/api/uploads/${submitResult.uploadId}/status`, { credentials: "include" });
        if (!statusRes.ok) return;
        const statusData = await statusRes.json() as { status: string };

        if (statusData.status === "processed" || statusData.status === "partial" || statusData.status === "failed") {
          // Processing complete — fetch final wiki count regardless of outcome
          let finalCount = submitResult.wikiCountBefore;
          try {
            const wikiRes = await fetch(`${baseUrl}/api/wiki`, { credentials: "include" });
            if (wikiRes.ok) {
              const data = await wikiRes.json();
              finalCount = Array.isArray(data) ? data.length : finalCount;
            }
          } catch { /* ignore */ }

          setWikiCountAfter(finalCount);
          setIsSlowProcessing(false);

          if (statusData.status === "failed") {
            setUploadWarning(
              "Your file was uploaded but we couldn't generate any wiki content from it. " +
              "The IAB HK team has been notified and will review it.",
            );
          } else if (statusData.status === "partial") {
            setUploadWarning(
              "Wiki pages were generated, but some optional steps (such as image or visual analysis) " +
              "could not be completed. Your content has been added to the knowledge base.",
            );
          }

          setIsPolling(false);
        }
        // status "pending" → processing still in flight, continue polling
      } catch { /* ignore */ }
    };

    // First check after 10 s, then every 5 s
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const timer = setTimeout(() => {
      void poll();
      intervalId = setInterval(poll, 5000);
    }, 10000);
    return () => {
      clearTimeout(timer);
      if (intervalId) clearInterval(intervalId);
    };
  }, [isPolling, submitResult]);

  if (authLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!isAuthenticated) return null;

  const handleSubmit = async (values: z.infer<typeof uploadSchema>) => {
    const rawText = values.rawText?.trim() ?? "";
    if (!rawText && selectedFiles.length === 0) {
      toast({ title: "Content Required", description: "Please provide text content or attach a file.", variant: "destructive" });
      return;
    }

    setUploadError(null);
    setActiveSteps(getStepsForFile(selectedFiles[0] ?? null));
    setSubmitStep(0);
    setIsSubmitting(true);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      let wikiCountBefore = 0;
      try {
        const wikiRes = await fetch(`${baseUrl}/api/wiki`, { credentials: "include" });
        if (wikiRes.ok) {
          const wikiData = await wikiRes.json();
          wikiCountBefore = Array.isArray(wikiData) ? wikiData.length : 0;
        }
      } catch { /* non-critical */ }

      const result = await submitUpload.mutateAsync({
        uploaderName: values.uploaderName,
        uploaderEmail: values.uploaderEmail,
        contributorName: values.contributorName,
        rawText: rawText || undefined,
        contentType: values.contentType,
        files: selectedFiles.length > 0 ? selectedFiles : undefined,
        responsibleAi: values.responsibleAi ?? false,
      });

      const fileNames = selectedFiles.map((f) => f.name);
      form.reset({ uploaderName: values.uploaderName, uploaderEmail: values.uploaderEmail, rawText: "", contentType: values.contentType, contributorName: values.contributorName, responsibleAi: false });
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSubmitResult({ fileNames, wikiCountBefore, uploadId: result.id });
      setWikiCountAfter(null);
      setUploadWarning(null);
      setIsPolling(true);
    } catch (err) {
      if (err instanceof UploadError) {
        setUploadError({ code: err.errorCode, meta: err.meta });
      } else {
        setUploadError({ code: "SERVER_ERROR" });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRecheck = async () => {
    if (!submitResult) return;
    setIsRechecking(true);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const statusRes = await fetch(`${baseUrl}/api/uploads/${submitResult.uploadId}/status`, { credentials: "include" });
      if (!statusRes.ok) return;
      const statusData = await statusRes.json() as { status: string };

      if (statusData.status === "processed" || statusData.status === "partial" || statusData.status === "failed") {
        let finalCount = submitResult.wikiCountBefore;
        try {
          const wikiRes = await fetch(`${baseUrl}/api/wiki`, { credentials: "include" });
          if (wikiRes.ok) {
            const data = await wikiRes.json();
            finalCount = Array.isArray(data) ? data.length : finalCount;
          }
        } catch { /* ignore */ }

        setWikiCountAfter(finalCount);
        setIsSlowProcessing(false);
        setPollTimedOut(false);

        if (statusData.status === "failed") {
          setUploadWarning(
            "Your file was uploaded but we couldn't generate any wiki content from it. " +
            "The IAB HK team has been notified and will review it.",
          );
        } else if (statusData.status === "partial") {
          setUploadWarning(
            "Wiki pages were generated, but some optional steps (such as image or visual analysis) " +
            "could not be completed. Your content has been added to the knowledge base.",
          );
        }
      }
      // still pending — leave the button visible so they can try again later
    } catch { /* ignore */ } finally {
      setIsRechecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:3rem_3rem] opacity-30 pointer-events-none z-0" />

      <header className="border-b border-border/50 bg-card/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center border border-secondary/20">
              <Hand className="text-secondary w-5 h-5" />
            </div>
            <div>
              <div className="font-serif font-bold text-base sm:text-lg leading-tight text-foreground/90">CONTRIBUTOR PORTAL</div>
              <div className="font-display text-[10px] uppercase tracking-widest text-secondary/70">Only IAB HK access allowed</div>
            </div>
          </div>
          <div className="flex items-center space-x-3 sm:space-x-6">
            <Link href="/" className="hidden sm:block text-[11px] font-display uppercase tracking-widest text-foreground/85 hover:text-primary transition-colors">
              View Knowledge Base
            </Link>
            <div className="hidden sm:block w-px h-6 bg-border" />
            <Link href="/super-admin/login" className="hidden sm:block text-[11px] font-display uppercase tracking-widest text-foreground/65 hover:text-foreground/70 transition-colors">
              Admin Panel
            </Link>
            <div className="hidden sm:block w-px h-6 bg-border" />
            <Button variant="ghost" size="sm" onClick={() => logout()} className="text-foreground/85 hover:text-destructive font-display uppercase tracking-widest text-[11px]">
              <LogOut className="w-3 h-3 sm:mr-2" /><span className="hidden sm:inline">Terminate Session</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-12 relative z-10">
        <div className="mb-8 p-5 rounded-xl border border-border/40 bg-card/30 backdrop-blur-md text-sm text-foreground/90 leading-relaxed">
          <span className="font-semibold text-foreground/90">How this works: </span>
          Submit source material — whitepapers, case studies, market data, etc. The AI reads it and <span className="font-medium text-foreground/90">automatically generates wiki knowledge pages</span> from the content. No further action required.
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <Card className="border-primary/20 shadow-[0_10px_50px_rgba(0,240,255,0.03)] bg-card/40 backdrop-blur-md rounded-2xl overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-primary to-transparent" />
          <CardHeader className="pb-4 sm:pb-8 pt-6 sm:pt-10 px-4 sm:px-10">
            <CardTitle className="font-serif text-xl sm:text-3xl font-bold">Content Submission Panel</CardTitle>
            <CardDescription className="text-sm sm:text-base mt-2 font-light text-foreground/85">
              Submit intelligence, research, or market data. The AI will extract wiki knowledge pages from your content automatically.
            </CardDescription>
          </CardHeader>

          <CardContent className="px-4 sm:px-10 pb-6 sm:pb-10">
            {isSubmitting && (
              <div className="py-10 sm:py-16 flex flex-col items-center">
                <div className="w-full max-w-md">
                  <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-5 relative">
                      <Sparkles className="w-6 h-6 text-primary" />
                      <span className="absolute inset-0 rounded-2xl animate-ping bg-primary/10" />
                    </div>
                    <h3 className="font-serif text-xl font-bold text-foreground/90 mb-2">Processing Your Content</h3>
                    <p className="text-sm text-foreground/85 font-light">This takes around 10–30 seconds. Please keep this tab open.</p>
                  </div>

                  <div className="space-y-2">
                    {activeSteps.map((step, idx) => {
                      const done = idx < submitStep;
                      const active = idx === submitStep;
                      return (
                        <div
                          key={step.label}
                          className={`flex items-center gap-4 px-5 py-4 rounded-xl border transition-all duration-500 ${
                            done
                              ? "border-primary/20 bg-primary/5"
                              : active
                              ? "border-primary/40 bg-primary/8 shadow-[0_0_20px_rgba(0,240,255,0.06)]"
                              : "border-border/20 bg-background/10 opacity-40"
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-500 ${
                            done
                              ? "border-primary bg-primary/20"
                              : active
                              ? "border-primary/60 bg-primary/10"
                              : "border-border/30"
                          }`}>
                            {done ? (
                              <Check className="w-3.5 h-3.5 text-primary" />
                            ) : active ? (
                              <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <step.Icon className="w-3.5 h-3.5 text-foreground/90" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium leading-tight ${done ? "text-primary/80" : active ? "text-foreground/90" : "text-foreground/65"}`}>
                              {step.label}
                            </p>
                            {active && (
                              <p className="text-[11px] text-foreground/85 mt-0.5 font-light">{step.detail}</p>
                            )}
                          </div>
                          {done && <span className="text-[10px] font-display text-primary/50 tracking-widest uppercase shrink-0">Done</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {!isSubmitting && submitResult && (
              <div className="py-10 sm:py-16 flex flex-col items-center">
                <div className="w-full max-w-md space-y-6">
                  <div className="text-center">
                    <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl border mb-5 ${
                      uploadWarning
                        ? "bg-amber-500/10 border-amber-500/20"
                        : "bg-green-500/10 border-green-500/20"
                    }`}>
                      {uploadWarning
                        ? <AlertTriangle className="w-6 h-6 text-amber-400" />
                        : <Check className="w-6 h-6 text-green-400" />
                      }
                    </div>
                    <h3 className="font-serif text-xl font-bold text-foreground/90 mb-1">
                      {uploadWarning ? "File Received" : "Content Received"}
                    </h3>
                    {submitResult.fileNames.length > 0 && (
                      <div className="space-y-0.5 mt-1">
                        {submitResult.fileNames.map((name) => (
                          <p key={name} className="text-sm text-foreground/85 font-mono truncate">{name}</p>
                        ))}
                      </div>
                    )}
                  </div>

                  {uploadWarning ? (
                    <div className="flex items-start gap-4 px-5 py-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
                      <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-amber-400/90">Content not extracted</p>
                        <p className="text-xs text-foreground/90 mt-1 leading-relaxed">{uploadWarning}</p>
                      </div>
                    </div>
                  ) : (
                    <div className={`flex items-center gap-4 px-5 py-4 rounded-xl border transition-all duration-500 ${
                      wikiCountAfter !== null
                        ? "border-primary/30 bg-primary/5"
                        : "border-primary/20 bg-primary/5 shadow-[0_0_20px_rgba(0,240,255,0.05)]"
                    }`}>
                      <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 border-primary/60 bg-primary/10">
                        {wikiCountAfter !== null ? (
                          <Check className="w-3.5 h-3.5 text-primary" />
                        ) : (
                          <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        )}
                      </div>
                      <div className="flex-1">
                        {wikiCountAfter !== null ? (
                          <>
                            <p className="text-sm font-medium text-primary/80">Wiki pages generated</p>
                            <p className="text-xs text-foreground/85 mt-0.5">
                              {wikiCountAfter - submitResult.wikiCountBefore} new page{wikiCountAfter - submitResult.wikiCountBefore !== 1 ? "s" : ""} added to the knowledge base
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-medium text-foreground/90">AI is generating wiki pages…</p>
                            <p className="text-xs text-foreground/85 mt-0.5">
                              {pollTimedOut
                                ? "Processing is taking longer than expected. Click \"Re-check status\" to see if it's done."
                                : isSlowProcessing
                                ? "Still processing — this is taking longer than usual. You can safely leave this page."
                                : "This typically takes 60–90 seconds. You can leave this page."}
                            </p>
                          </>
                        )}
                      </div>
                      {wikiCountAfter !== null && (
                        <span className="text-lg font-bold text-primary shrink-0">
                          +{wikiCountAfter - submitResult.wikiCountBefore}
                        </span>
                      )}
                    </div>
                  )}

                  {pollTimedOut && wikiCountAfter === null && (
                    <Button
                      onClick={() => void handleRecheck()}
                      disabled={isRechecking}
                      className="w-full h-12 font-display uppercase tracking-[0.2em] text-xs bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded-xl transition-all"
                    >
                      {isRechecking ? (
                        <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
                      ) : (
                        <History className="w-4 h-4 mr-2" />
                      )}
                      {isRechecking ? "Checking…" : "Re-check Status"}
                    </Button>
                  )}

                  <Button
                    onClick={() => { setSubmitResult(null); setWikiCountAfter(null); setUploadWarning(null); setIsSlowProcessing(false); setIsPolling(false); setPollTimedOut(false); setIsRechecking(false); }}
                    className="w-full h-12 font-display uppercase tracking-[0.2em] text-xs bg-background/50 hover:bg-background/80 text-foreground/85 border border-border/50 rounded-xl transition-all"
                  >
                    <PlusCircle className="w-4 h-4 mr-2" />Submit Another
                  </Button>
                </div>
              </div>
            )}

            {!isSubmitting && !submitResult && (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-10">

                  {uploadError && (
                    <div className={`flex items-start gap-4 px-5 py-4 rounded-xl border ${
                      uploadError.code === "DUPLICATE_UPLOAD"
                        ? "border-amber-500/40 bg-amber-500/5"
                        : "border-destructive/40 bg-destructive/5"
                    }`}>
                      {uploadError.code === "DUPLICATE_UPLOAD"
                        ? <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                        : <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                      }
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold ${uploadError.code === "DUPLICATE_UPLOAD" ? "text-amber-400/90" : "text-destructive/90"}`}>
                          {getErrorCopy(uploadError.code).headline}
                        </p>
                        <p className="text-xs text-foreground/85 mt-1 leading-relaxed">
                          {getErrorCopy(uploadError.code).body}
                          {uploadError.code === "DUPLICATE_UPLOAD" && uploadError.meta?.existingCreatedAt && (
                            <> Originally submitted on {new Date(uploadError.meta.existingCreatedAt as string).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.</>
                          )}
                        </p>
                        {uploadError.code === "DUPLICATE_UPLOAD" && uploadError.meta?.existingFilePath && (
                          <p className="text-xs text-foreground/85 mt-1 font-mono truncate">
                            {(uploadError.meta.existingFilePath as string).split(", ").map((f) => f.replace(/^\d+-\d+-/, "")).join(", ")}
                          </p>
                        )}
                        <p className="text-xs text-foreground/85 mt-1.5 italic">
                          {getErrorCopy(uploadError.code).action}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setUploadError(null)}
                        className="text-foreground/90 hover:text-foreground/60 transition-colors shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="uploaderName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/85">
                            Your Name <span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="Full name" className="bg-background/50 border-border/50 h-12 rounded-xl focus-visible:ring-primary/30" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="uploaderEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/85">
                            Work Email <span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="you@company.com" className="bg-background/50 border-border/50 h-12 rounded-xl focus-visible:ring-primary/30" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                    <FormField
                      control={form.control}
                      name="contributorName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/85">Source</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter author or organization name" className="bg-background/50 border-border/50 h-12 rounded-xl focus-visible:ring-primary/30" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="contentType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/85">Type of Content</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="bg-background/50 border-border/50 h-12 rounded-xl focus:ring-primary/30">
                                <SelectValue placeholder="Select classification..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-card border-border/50">
                              <SelectItem value="whitepaper">Whitepaper Extract</SelectItem>
                              <SelectItem value="case_study">Case Study Evidence</SelectItem>
                              <SelectItem value="market_data">Market Data / Statistics</SelectItem>
                              <SelectItem value="regulation_update">Regulatory Update</SelectItem>
                              <SelectItem value="trend_insight">Trend Insight</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="rawText"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/85">
                          Paste text here <span className="text-foreground/85 normal-case tracking-normal font-sans text-[11px]">(Optional if uploading a file — content is read automatically)</span>
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Paste raw data, reports, or transcriptions here — or leave blank and attach a PDF below to let the AI read it directly..."
                            className="bg-background/50 border-border/50 min-h-[160px] rounded-xl focus-visible:ring-primary/30 resize-none text-sm font-light"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="responsibleAi"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border/40 bg-background/20">
                          <FormControl>
                            <Checkbox
                              checked={field.value ?? false}
                              onCheckedChange={field.onChange}
                              id="responsibleAi"
                              className="border-primary/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                            />
                          </FormControl>
                          <label htmlFor="responsibleAi" className="flex flex-col gap-0.5 cursor-pointer select-none">
                            <span className="font-display tracking-[0.15em] uppercase text-[10px] text-foreground/90">Responsible AI</span>
                            <span className="text-[11px] text-foreground/85 font-light normal-case tracking-normal">All wiki pages generated from this upload will be flagged as Responsible AI content</span>
                          </label>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="space-y-3">
                    <div className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/85">
                      Attach File <span className="text-foreground/85 normal-case tracking-normal font-sans text-[11px]">(Optional — PDF, DOCX, PPTX, images)</span>
                    </div>

                    {selectedFiles.length > 0 && (
                      <div className="space-y-2">
                        {selectedFiles.map((file, idx) => (
                          <div key={`${file.name}-${idx}`} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/20 bg-primary/5">
                            <Paperclip className="w-4 h-4 text-primary/60 shrink-0" />
                            <span className="flex-1 text-sm text-foreground/90 font-mono truncate">{file.name}</span>
                            <span className="text-xs text-foreground/65 shrink-0">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                            <button
                              type="button"
                              onClick={() => setSelectedFiles((prev) => prev.filter((_, i) => i !== idx))}
                              className="text-foreground/90 hover:text-destructive transition-colors shrink-0"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <label className="flex items-center gap-3 px-5 py-4 rounded-xl border border-dashed border-border/40 bg-background/20 hover:bg-background/40 hover:border-primary/30 transition-all cursor-pointer group">
                      <UploadIcon className="w-4 h-4 text-foreground/65 group-hover:text-primary/60 transition-colors" />
                      <span className="text-sm text-foreground/85 group-hover:text-foreground/70 transition-colors font-light">
                        {selectedFiles.length > 0 ? "Add another file" : "Click to attach a file"}
                      </span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        accept=".pdf,.docx,.doc,.pptx,.md,.txt,.jpg,.jpeg,.png,.webp,.gif,.tiff"
                        multiple
                        onChange={(e) => {
                          const incoming = Array.from(e.target.files ?? []);
                          setSelectedFiles((prev) => {
                            const existingNames = new Set(prev.map((f) => f.name));
                            return [...prev, ...incoming.filter((f) => !existingNames.has(f.name))];
                          });
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                      />
                    </label>
                  </div>

                  <div className="space-y-3">
                    <Button
                      type="submit"
                      disabled={submitUpload.isPending}
                      className="w-full h-14 font-display uppercase tracking-[0.2em] text-xs bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground border border-primary/30 rounded-xl transition-all duration-300"
                    >
                      {submitUpload.isPending
                        ? <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-3" />Submitting…</>
                        : "Submit Content"}
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>

        {/* Submission History */}
        {uploads && uploads.length > 0 ? (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <History className="w-4 h-4 text-foreground/65" />
              <h2 className="font-display text-xs uppercase tracking-widest text-foreground/85">Submission History</h2>
            </div>
            <div className="space-y-2">
              {(uploads as Array<{
                id: number;
                uploaderName?: string | null;
                contentType: string;
                filePath?: string | null;
                status: string;
                processingErrors?: Array<{ step: string; message: string; ts: string }>;
                createdAt: string;
              }>).map((upload) => {
                const errors = upload.processingErrors ?? [];
                const hasErrors = errors.length > 0;
                const isExpanded = expandedHistoryId === upload.id;
                const statusColor =
                  upload.status === "processed"
                    ? "border-green-500/30 text-green-400/70"
                    : upload.status === "partial"
                    ? "border-amber-500/30 text-amber-400/70"
                    : upload.status === "failed" || upload.status === "error"
                    ? "border-destructive/30 text-destructive/70"
                    : "border-border/30 text-foreground/65";
                return (
                  <div key={upload.id} className="rounded-xl border border-border/30 bg-card/30 backdrop-blur-sm overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-background/30 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px] font-display tracking-widest uppercase border-primary/20 text-primary/60">
                            {upload.contentType.replace(/_/g, " ")}
                          </Badge>
                          <Badge variant="outline" className={`text-[10px] font-display tracking-widest uppercase ${statusColor}`}>
                            {upload.status}
                          </Badge>
                          <span className="text-xs text-foreground/90 truncate">
                            {upload.filePath ? upload.filePath.replace(/^\d+-\d+-/, "") : (upload.uploaderName ?? "Text submission")}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs text-foreground/65 shrink-0">
                        {new Date(upload.createdAt).toLocaleDateString("en-HK", {
                          day: "numeric", month: "short", year: "numeric",
                          timeZone: "Asia/Hong_Kong",
                        })}
                      </span>
                      {hasErrors && (
                        <button
                          onClick={() => setExpandedHistoryId(isExpanded ? null : upload.id)}
                          className="text-foreground/90 hover:text-amber-400 transition-colors p-1 shrink-0"
                          title={isExpanded ? "Hide errors" : "Show processing errors"}
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                    {hasErrors && isExpanded && (
                      <div className="border-t border-border/20 px-4 py-3 bg-background/40 space-y-1.5">
                        <p className="text-[10px] font-display uppercase tracking-widest text-foreground/65 mb-2">Processing Errors</p>
                        {errors.map((err, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-foreground/90 font-mono">
                            <span className={`shrink-0 mt-0.5 text-[10px] uppercase font-display tracking-wide ${
                              err.step === "text_extraction" || err.step === "wiki_extraction"
                                ? "text-destructive/70"
                                : "text-amber-400/70"
                            }`}>[{err.step}]</span>
                            <span className="break-all leading-relaxed">{err.message}</span>
                            <span className="shrink-0 text-foreground/90 ml-auto whitespace-nowrap">
                              {new Date(err.ts).toLocaleTimeString("en-HK", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Hong_Kong" })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        </div>
      </main>
    </div>
  );
}
