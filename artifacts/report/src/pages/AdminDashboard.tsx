import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import {
  LogOut, Upload as UploadIcon, Hand,
  Paperclip, X, CheckCircle2, AlertCircle,
  ArrowLeft, ChevronRight, Sparkles, FileText,
  ImageIcon, BookOpen, Layers, Check,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useSubmitUpload, useAnalyzeUpload, type AnalysisResult, type SectionSuggestion } from "@/hooks/use-uploads";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const uploadSchema = z.object({
  uploaderName: z.string().min(1, "Name is required"),
  uploaderEmail: z.string().min(1, "Work email is required").email("Must be a valid email address"),
  contributorName: z.string().optional(),
  contentType: z.enum(["whitepaper", "case_study", "market_data", "regulation_update", "trend_insight"]),
  rawText: z.string().optional(),
});

const confidenceConfig: Record<SectionSuggestion["confidence"], { label: string; classes: string }> = {
  high: { label: "High Match", classes: "bg-primary/10 text-primary border-primary/20" },
  medium: { label: "Medium Match", classes: "bg-secondary/10 text-secondary border-secondary/20" },
  low: { label: "Low Match", classes: "bg-muted/30 text-foreground/70 border-border/40" },
};

export default function AdminDashboard() {
  const { isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const [, setLocation] = useLocation();
  const submitUpload = useSubmitUpload();
  const analyzeUpload = useAnalyzeUpload();
  const { toast } = useToast();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<"input" | "review" | "integrating">("input");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [approvedSlugs, setApprovedSlugs] = useState<Set<string>>(new Set());
  const [integrationStep, setIntegrationStep] = useState(0);

  const INTEGRATION_STEPS = [
    { label: "Processing content", detail: "Parsing and preparing submitted material…", Icon: FileText },
    { label: "Analysing with AI", detail: "Mapping content to report sections…", Icon: Sparkles },
    { label: "Generating visuals", detail: "Creating AI illustrations for the report…", Icon: ImageIcon },
    { label: "Writing to report", detail: "Applying updates to approved sections…", Icon: Layers },
    { label: "Building wiki entries", detail: "Generating atomic knowledge pages…", Icon: BookOpen },
  ] as const;

  useEffect(() => {
    if (phase !== "integrating") {
      setIntegrationStep(0);
      return;
    }
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 1;
      if (elapsed >= 38) setIntegrationStep(4);
      else if (elapsed >= 24) setIntegrationStep(3);
      else if (elapsed >= 10) setIntegrationStep(2);
      else if (elapsed >= 3) setIntegrationStep(1);
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  const form = useForm<z.infer<typeof uploadSchema>>({
    resolver: zodResolver(uploadSchema),
    defaultValues: { uploaderName: "", uploaderEmail: "", contentType: "market_data", contributorName: "", rawText: "" },
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setLocation("/admin/login");
    }
  }, [authLoading, isAuthenticated, setLocation]);

  if (authLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!isAuthenticated) return null;

  const handleAnalyze = async (values: z.infer<typeof uploadSchema>) => {
    const rawText = values.rawText?.trim() ?? "";
    if (!rawText && !selectedFile) {
      toast({ title: "Content Required", description: "Please provide text content or attach a file before analysing.", variant: "destructive" });
      return;
    }

    try {
      const result = await analyzeUpload.mutateAsync({
        contentType: values.contentType,
        rawText: rawText || undefined,
        file: selectedFile,
      });
      setAnalysis(result);
      setApprovedSlugs(new Set(result.suggestions.map((s) => s.slug)));
      setPhase("review");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      toast({ title: "Analysis Failed", description: message, variant: "destructive" });
    }
  };

  const handleConfirmIntegration = async () => {
    const values = form.getValues();
    const targetSections = [...approvedSlugs];

    if (targetSections.length === 0) {
      toast({ title: "No Sections Selected", description: "Approve at least one section before integrating.", variant: "destructive" });
      return;
    }

    setPhase("integrating");

    try {
      await submitUpload.mutateAsync({
        uploaderName: values.uploaderName,
        uploaderEmail: values.uploaderEmail,
        contributorName: values.contributorName,
        rawText: values.rawText?.trim() || undefined,
        targetSections,
        contentType: values.contentType,
        file: selectedFile,
      });
      toast({ title: "Integration Complete", description: `Content successfully integrated into ${targetSections.length} section${targetSections.length > 1 ? "s" : ""}.` });
      form.reset({ uploaderName: values.uploaderName, uploaderEmail: values.uploaderEmail, rawText: "", contentType: values.contentType, contributorName: values.contributorName });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setPhase("input");
      setAnalysis(null);
      setApprovedSlugs(new Set());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Integration failed";
      toast({ title: "Integration Failed", description: message, variant: "destructive" });
      setPhase("review");
    }
  };

  const toggleSlug = (slug: string) => {
    setApprovedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
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
            <Link href="/" className="hidden sm:block text-[11px] font-display uppercase tracking-widest text-foreground/70 hover:text-primary transition-colors">
              View Knowledge Base
            </Link>
            <div className="hidden sm:block w-px h-6 bg-border" />
            <Link href="/super-admin/login" className="hidden sm:block text-[11px] font-display uppercase tracking-widest text-foreground/40 hover:text-foreground/70 transition-colors">
              Admin Panel
            </Link>
            <div className="hidden sm:block w-px h-6 bg-border" />
            <Button variant="ghost" size="sm" onClick={() => logout()} className="text-foreground/70 hover:text-destructive font-display uppercase tracking-widest text-[11px]">
              <LogOut className="w-3 h-3 sm:mr-2" /><span className="hidden sm:inline">Terminate Session</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-12 relative z-10">
        <div className="mb-8 p-5 rounded-xl border border-border/40 bg-card/30 backdrop-blur-md text-sm text-foreground/80 leading-relaxed">
          <span className="font-semibold text-foreground/80">How this works: </span>
          Submit new source material — whitepapers, case studies, market data, etc. The AI reads it, suggests which report sections to update, and you approve before anything changes. <span className="font-medium text-foreground/90">Wiki pages are created automatically as part of this process</span> — you do not need to do anything extra.
        </div>

        <Card className="border-primary/20 shadow-[0_10px_50px_rgba(0,240,255,0.03)] bg-card/40 backdrop-blur-md rounded-2xl overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-primary to-transparent" />
          <CardHeader className="pb-4 sm:pb-8 pt-6 sm:pt-10 px-4 sm:px-10">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="font-serif text-xl sm:text-3xl font-bold">Content Addition Panel</CardTitle>
                <CardDescription className="text-sm sm:text-base mt-2 font-light text-foreground/70">
                  {phase === "input"
                    ? "Submit intelligence, research, or market data. The AI will analyse the content and suggest which report sections to update."
                    : phase === "review"
                    ? "Review the AI-generated integration plan below. Approve or remove sections, then confirm to integrate."
                    : "AI is processing your content and updating the report. Steps complete automatically."}
                </CardDescription>
              </div>
              {phase === "review" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setPhase("input"); setAnalysis(null); setApprovedSlugs(new Set()); }}
                  className="text-foreground/70 hover:text-foreground font-display uppercase tracking-widest text-[11px]"
                >
                  <ArrowLeft className="w-3 h-3 mr-2" /> Back
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="px-4 sm:px-10 pb-6 sm:pb-10">
            {phase === "integrating" && (
              <div className="py-10 sm:py-16 flex flex-col items-center">
                <div className="w-full max-w-md">
                  <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-5 relative">
                      <Sparkles className="w-6 h-6 text-primary" />
                      <span className="absolute inset-0 rounded-2xl animate-ping bg-primary/10" />
                    </div>
                    <h3 className="font-serif text-xl font-bold text-foreground/90 mb-2">Integration in Progress</h3>
                    <p className="text-sm text-foreground/50 font-light">This takes around 30–60 seconds. Please keep this tab open.</p>
                  </div>

                  <div className="space-y-2">
                    {INTEGRATION_STEPS.map((step, idx) => {
                      const done = idx < integrationStep;
                      const active = idx === integrationStep;
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
                              <step.Icon className="w-3.5 h-3.5 text-foreground/30" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium leading-tight ${done ? "text-primary/80" : active ? "text-foreground/90" : "text-foreground/40"}`}>
                              {step.label}
                            </p>
                            {active && (
                              <p className="text-[11px] text-foreground/50 mt-0.5 font-light">{step.detail}</p>
                            )}
                          </div>
                          {done && <span className="text-[10px] font-display text-primary/50 tracking-widest uppercase shrink-0">Done</span>}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-8 h-px w-full bg-border/20 overflow-hidden rounded-full">
                    <div
                      className="h-full bg-gradient-to-r from-primary/60 to-primary transition-all duration-1000 ease-out rounded-full"
                      style={{ width: `${Math.round(((integrationStep) / (INTEGRATION_STEPS.length - 1)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-center text-[11px] text-foreground/30 mt-3 font-display tracking-widest uppercase">
                    Step {integrationStep + 1} of {INTEGRATION_STEPS.length}
                  </p>
                </div>
              </div>
            )}

            {phase === "input" && (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleAnalyze)} className="space-y-10">

                  {/* Identity fields — required */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="uploaderName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/70">
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
                          <FormLabel className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/70">
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
                          <FormLabel className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/70">Source</FormLabel>
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
                          <FormLabel className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/70">Type of Content</FormLabel>
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
                        <FormLabel className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/70">
                          Paste text here <span className="text-foreground/50 normal-case tracking-normal font-sans text-[11px]">(Optional if uploading a PDF — content is read automatically)</span>
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Paste raw data, reports, or transcriptions here — or leave blank and attach a PDF below to let the AI read it directly..."
                            className="min-h-[300px] bg-background/30 border-border/50 rounded-xl font-mono text-sm p-6 focus-visible:ring-primary/30 leading-relaxed resize-y"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div>
                    <label className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/70 block mb-3">
                      Attach PDF <span className="text-foreground/50 normal-case tracking-normal font-sans text-[11px]">(Optional — text above takes priority)</span>
                    </label>
                    {selectedFile ? (
                      <div className="flex items-center gap-3 p-4 border border-primary/30 rounded-xl bg-primary/5">
                        <Paperclip className="w-4 h-4 text-primary shrink-0" />
                        <span className="text-sm text-foreground/80 flex-1 truncate font-mono">{selectedFile.name}</span>
                        <button
                          type="button"
                          onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                          className="text-foreground/50 hover:text-destructive transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-3 h-16 border border-dashed border-border/50 rounded-xl bg-background/20 hover:bg-background/40 hover:border-primary/30 transition-all cursor-pointer group">
                        <UploadIcon className="w-4 h-4 text-foreground/50 group-hover:text-primary transition-colors" />
                        <span className="text-sm text-foreground/50 group-hover:text-foreground/80 transition-colors font-display uppercase tracking-widest text-[10px]">Click to attach PDF</span>
                        <input
                          ref={fileInputRef}
                          type="file"
                          className="hidden"
                          accept=".pdf,.txt,.csv,.docx,.xlsx"
                          onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                        />
                      </label>
                    )}
                  </div>

                  <div className="space-y-3">
                    <Button
                      type="submit"
                      disabled={analyzeUpload.isPending}
                      className="w-full h-14 font-display uppercase tracking-[0.2em] text-xs bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground border border-primary/30 rounded-xl transition-all duration-300"
                    >
                      {analyzeUpload.isPending
                        ? <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-3" />Reading content &amp; mapping sections…</>
                        : "Analyse Content"}
                    </Button>
                    {analyzeUpload.isPending && (
                      <p className="text-center text-[11px] text-foreground/40 font-light">
                        Usually takes 5–15 seconds
                      </p>
                    )}
                  </div>
                </form>
              </Form>
            )}

            {phase === "review" && analysis && (
              <div className="space-y-10">
                {analysis.summary && (
                  <div className="p-6 rounded-xl border border-primary/20 bg-primary/5">
                    <p className="font-display tracking-[0.2em] uppercase text-[10px] text-primary mb-2">AI Content Summary</p>
                    <p className="text-foreground/80 font-light leading-relaxed">{analysis.summary}</p>
                  </div>
                )}

                <div>
                  <h3 className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/70 mb-6 flex items-center gap-3">
                    <span className="w-1.5 h-1.5 bg-primary rounded-full shadow-[0_0_8px_rgba(0,240,255,0.8)]" />
                    Integration Task List — Review &amp; Approve
                  </h3>

                  {analysis.suggestions.length === 0 ? (
                    <div className="flex items-center gap-4 p-6 border border-dashed border-border/50 rounded-xl bg-background/20 text-foreground/70">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <div>
                        <p className="font-medium text-sm">No matching sections found</p>
                        <p className="text-xs mt-1 font-light">The AI could not confidently match the content to any existing section. Go back and refine the content or select sections manually.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {analysis.suggestions.map((suggestion, idx) => {
                        const approved = approvedSlugs.has(suggestion.slug);
                        const conf = confidenceConfig[suggestion.confidence];
                        return (
                          <button
                            key={suggestion.slug}
                            type="button"
                            onClick={() => toggleSlug(suggestion.slug)}
                            className={`w-full text-left p-6 rounded-xl border transition-all duration-300 group ${
                              approved
                                ? "border-primary/40 bg-primary/5 shadow-[inset_0_0_20px_rgba(0,240,255,0.04)]"
                                : "border-border/40 bg-background/20 opacity-60 hover:opacity-80"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex items-start gap-4 flex-1 min-w-0">
                                <div className={`mt-0.5 w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${approved ? "border-primary bg-primary/20" : "border-border/50"}`}>
                                  {approved && <CheckCircle2 className="w-3.5 h-3.5 text-primary" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                                    <span className="font-display text-[10px] text-foreground/50">TASK {String(idx + 1).padStart(2, "0")}</span>
                                    <Badge variant="outline" className={`text-[10px] font-display tracking-wide px-2 py-0.5 border ${conf.classes}`}>
                                      {conf.label}
                                    </Badge>
                                  </div>
                                  <p className="font-medium text-sm text-foreground/90 mb-1">{suggestion.title}</p>
                                  <p className="text-xs text-foreground/70 font-light leading-relaxed">{suggestion.reason}</p>
                                </div>
                              </div>
                              <ChevronRight className={`w-4 h-4 mt-1 shrink-0 transition-colors ${approved ? "text-primary/60" : "text-border/50"}`} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-4 border-t border-border/30">
                  <p className="text-xs text-foreground/70 font-light">
                    <span className="text-foreground font-medium">{approvedSlugs.size}</span> of {analysis.suggestions.length} section{analysis.suggestions.length !== 1 ? "s" : ""} approved for integration
                  </p>
                  <Button
                    type="button"
                    onClick={handleConfirmIntegration}
                    disabled={submitUpload.isPending || approvedSlugs.size === 0}
                    className="w-full sm:w-auto h-14 px-10 font-display uppercase tracking-[0.2em] text-xs bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-[0_0_20px_rgba(0,240,255,0.2)] hover:shadow-[0_0_30px_rgba(0,240,255,0.4)] transition-all disabled:opacity-40"
                  >
                    {submitUpload.isPending
                      ? <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-3" />Integrating…</>
                      : "Confirm Integration"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
