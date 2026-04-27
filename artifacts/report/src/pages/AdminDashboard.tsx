import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { Link, useLocation } from "wouter";
import {
  LogOut, Upload as UploadIcon, History, GitBranch, Hand,
  Paperclip, X, ImageIcon, Sparkles, CheckCircle2, AlertCircle,
  ArrowLeft, ChevronRight, UploadCloud, BookOpen, RefreshCw,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useSections, useSectionVersions } from "@/hooks/use-sections";
import { useUploads, useSubmitUpload, useAnalyzeUpload, type AnalysisResult, type SectionSuggestion } from "@/hooks/use-uploads";
import { getListSectionsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

const uploadSchema = z.object({
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
  const { data: sections } = useSections();
  const { data: uploads } = useUploads();
  const submitUpload = useSubmitUpload();
  const analyzeUpload = useAnalyzeUpload();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);
  const { data: versions } = useSectionVersions(selectedSectionId ?? 0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [generatingImages, setGeneratingImages] = useState(false);
  const [imageProgress, setImageProgress] = useState<{
    current: number;
    total: number;
    currentSectionTitle: string;
    completedSlugs: Set<string>;
    failedSlugs: Set<string>;
  } | null>(null);
  const [promptExtra, setPromptExtra] = useState("");
  const [uploadingSectionId, setUploadingSectionId] = useState<number | null>(null);

  const [phase, setPhase] = useState<"input" | "review">("input");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [approvedSlugs, setApprovedSlugs] = useState<Set<string>>(new Set());
  const [wikiPageCount, setWikiPageCount] = useState<number | null>(null);
  const [wikiSeeding, setWikiSeeding] = useState(false);
  const [wikiSeedResult, setWikiSeedResult] = useState<{ pagesCreated: number; pagesUpdated: number } | null>(null);

  const form = useForm<z.infer<typeof uploadSchema>>({
    resolver: zodResolver(uploadSchema),
    defaultValues: { contentType: "market_data", contributorName: "", rawText: "" },
  });

  const fetchWikiCount = async () => {
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/wiki`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as unknown[];
        setWikiPageCount(data.length);
      }
    } catch {
      // silently ignore
    }
  };

  const handleWikiSeed = async () => {
    setWikiSeeding(true);
    setWikiSeedResult(null);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/wiki/seed`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json() as { pagesCreated: number; pagesUpdated: number };
        setWikiSeedResult(data);
        await fetchWikiCount();
        toast({ title: "Wiki Built", description: `${data.pagesCreated} pages created, ${data.pagesUpdated} updated.` });
      } else {
        toast({ title: "Seed Failed", description: "Wiki seed encountered an error.", variant: "destructive" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      toast({ title: "Seed Failed", description: message, variant: "destructive" });
    } finally {
      setWikiSeeding(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setLocation("/admin/login");
    }
    if (!authLoading && isAuthenticated) {
      fetchWikiCount();
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

    try {
      await submitUpload.mutateAsync({
        ...values,
        rawText: values.rawText?.trim() || undefined,
        targetSections,
        file: selectedFile,
      });
      toast({ title: "Integration Complete", description: `Content successfully integrated into ${targetSections.length} section${targetSections.length > 1 ? "s" : ""}.` });
      form.reset({ rawText: "", contentType: values.contentType, contributorName: values.contributorName });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setPhase("input");
      setAnalysis(null);
      setApprovedSlugs(new Set());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Integration failed";
      toast({ title: "Integration Failed", description: message, variant: "destructive" });
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

  const handleGenerateImages = async () => {
    setGeneratingImages(true);
    setImageProgress(null);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/admin/generate-images`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptExtra: promptExtra.trim() || undefined }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json() as { error?: string; message?: string };
        toast({ title: "Generation Failed", description: String(data.error ?? data.message ?? "Unknown error"), variant: "destructive" });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completedSlugs = new Set<string>();
      let failedSlugs = new Set<string>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (event.type === "start") {
              setImageProgress({ current: 0, total: event.total as number, currentSectionTitle: "", completedSlugs: new Set(), failedSlugs: new Set() });
            } else if (event.type === "generating") {
              setImageProgress({ current: (event.current as number) - 1, total: event.total as number, currentSectionTitle: event.sectionTitle as string, completedSlugs: new Set(completedSlugs), failedSlugs: new Set(failedSlugs) });
            } else if (event.type === "done") {
              completedSlugs = new Set([...completedSlugs, event.sectionSlug as string]);
              setImageProgress({ current: event.current as number, total: event.total as number, currentSectionTitle: event.sectionTitle as string, completedSlugs: new Set(completedSlugs), failedSlugs: new Set(failedSlugs) });
            } else if (event.type === "failed") {
              failedSlugs = new Set([...failedSlugs, event.sectionSlug as string]);
              setImageProgress({ current: event.current as number, total: event.total as number, currentSectionTitle: event.sectionTitle as string, completedSlugs: new Set(completedSlugs), failedSlugs: new Set(failedSlugs) });
            } else if (event.type === "complete") {
              const { generated, failed, message } = event as { generated: number; failed: number; message: string };
              if (failed > 0) {
                toast({ title: "Generation Complete", description: message, variant: "destructive" });
              } else if (generated === 0) {
                toast({ title: "No New Images Needed", description: message });
              } else {
                toast({ title: "Images Generated", description: message });
              }
              await queryClient.invalidateQueries({ queryKey: getListSectionsQueryKey() });
            }
          } catch {
            // ignore malformed events
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      toast({ title: "Generation Failed", description: message, variant: "destructive" });
    } finally {
      setGeneratingImages(false);
      setImageProgress(null);
    }
  };

  const handleImageUpload = async (sectionId: number, file: File | undefined) => {
    if (!file) return;
    setUploadingSectionId(sectionId);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch(`${baseUrl}/api/admin/sections/${sectionId}/upload-image`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await res.json() as { imageUrl?: string; error?: string };
      if (res.ok) {
        toast({ title: "Image Uploaded", description: "Section image updated successfully." });
        await queryClient.invalidateQueries({ queryKey: getListSectionsQueryKey() });
      } else {
        toast({ title: "Upload Failed", description: String(data.error ?? "Upload failed"), variant: "destructive" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast({ title: "Upload Failed", description: message, variant: "destructive" });
    } finally {
      setUploadingSectionId(null);
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
            <Link href="/" className="hidden sm:block text-[11px] font-display uppercase tracking-widest text-foreground/70 hover:text-primary transition-colors">
              View Knowledge Base
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
          The <span className="text-primary font-medium">Content</span> tab is where you submit new source material — whitepapers, case studies, market data, etc. The AI reads it, suggests which report sections to update, and you approve before anything changes. <span className="font-medium text-foreground/90">Wiki pages are created automatically as part of this process</span> — you do not need to do anything extra.
          {" "}The <span className="text-green-400 font-medium">Wiki</span> tab is for monitoring and occasional maintenance only. The rebuild tool re-reads the compiled report sections and regenerates wiki pages from them — use it if pages have gone out of sync after a manual section edit, or to recover deleted pages. <span className="font-medium text-foreground/90">Avoid running it repeatedly:</span> each run can append additional content to existing pages, and running it multiple times may cause pages to accumulate redundant sections.
        </div>
        <Tabs defaultValue="upload" className="space-y-8">
          <TabsList className="w-full bg-card/50 backdrop-blur-md border border-border/50 p-1 rounded-xl h-auto">
            <TabsTrigger value="upload" className="flex-1 py-3 px-2 sm:px-6 rounded-lg font-display tracking-tight sm:tracking-[0.15em] uppercase text-[10px] sm:text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all">
              <UploadIcon className="hidden sm:inline-flex w-4 h-4 sm:mr-3" />Content
            </TabsTrigger>
            <TabsTrigger value="wiki" className="flex-1 py-3 px-2 sm:px-6 rounded-lg font-display tracking-tight sm:tracking-[0.15em] uppercase text-[10px] sm:text-xs data-[state=active]:bg-green-500/10 data-[state=active]:text-green-400 transition-all">
              <BookOpen className="hidden sm:inline-flex w-4 h-4 sm:mr-3" />Wiki
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-1 py-3 px-2 sm:px-6 rounded-lg font-display tracking-tight sm:tracking-[0.15em] uppercase text-[10px] sm:text-xs data-[state=active]:bg-secondary/10 data-[state=active]:text-secondary transition-all">
              <History className="hidden sm:inline-flex w-4 h-4 sm:mr-3" />Upload History
            </TabsTrigger>
            <TabsTrigger value="versions" className="flex-1 py-3 px-2 sm:px-6 rounded-lg font-display tracking-tight sm:tracking-[0.15em] uppercase text-[10px] sm:text-xs data-[state=active]:bg-accent/10 data-[state=active]:text-accent transition-all">
              <GitBranch className="hidden sm:inline-flex w-4 h-4 sm:mr-3" />Image Generation
            </TabsTrigger>
          </TabsList>

          {/* UPLOAD TAB */}
          <TabsContent value="upload" className="mt-8 outline-none">
            <Card className="border-primary/20 shadow-[0_10px_50px_rgba(0,240,255,0.03)] bg-card/40 backdrop-blur-md rounded-2xl overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-primary to-transparent" />
              <CardHeader className="pb-4 sm:pb-8 pt-6 sm:pt-10 px-4 sm:px-10">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="font-serif text-xl sm:text-3xl font-bold">Content Addition Panel</CardTitle>
                    <CardDescription className="text-sm sm:text-base mt-2 font-light text-foreground/70">
                      {phase === "input"
                        ? "Submit intelligence, research, or market data. The AI will analyse the content and suggest which report sections to update."
                        : "Review the AI-generated integration plan below. Approve or remove sections, then confirm to integrate."}
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
                {phase === "input" && (
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleAnalyze)} className="space-y-10">
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
                              Paste text here <span className="text-foreground/50 normal-case tracking-normal font-sans text-[11px]">(Optional — attach a file below instead)</span>
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Paste raw data, reports, or transcriptions here for AI synthesis..."
                                className="min-h-[300px] bg-background/30 border-border/50 rounded-xl font-mono text-sm p-6 focus-visible:ring-primary/30 leading-relaxed resize-y"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div>
                        <label className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/70 block mb-3">Supplementary File (Optional)</label>
                        <div className="flex items-center gap-4">
                          <label className="flex-1 flex items-center gap-3 p-4 border border-dashed border-border/50 rounded-xl bg-background/30 hover:border-primary/30 hover:bg-background/50 transition-all cursor-pointer group">
                            <Paperclip className="w-5 h-5 text-foreground/70 group-hover:text-primary transition-colors" />
                            <span className="text-sm text-foreground/70 group-hover:text-foreground transition-colors">
                              {selectedFile ? selectedFile.name : "Attach PDF, TXT, CSV, DOCX, or XLSX (max 10MB)"}
                            </span>
                            <input
                              ref={fileInputRef}
                              type="file"
                              className="hidden"
                              accept=".pdf,.txt,.csv,.docx,.xlsx"
                              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                            />
                          </label>
                          {selectedFile && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                              className="text-foreground/70 hover:text-destructive"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="flex justify-end pt-4">
                        <Button
                          type="submit"
                          disabled={analyzeUpload.isPending}
                          className="w-full sm:w-auto h-14 px-10 font-display uppercase tracking-[0.2em] text-xs bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-[0_0_20px_rgba(0,240,255,0.2)] hover:shadow-[0_0_30px_rgba(0,240,255,0.4)] transition-all"
                        >
                          {analyzeUpload.isPending
                            ? <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-3" />Analysing…</>
                            : <><Sparkles className="w-4 h-4 mr-3" />Analyse Content</>}
                        </Button>
                      </div>
                    </form>
                  </Form>
                )}

                {phase === "review" && analysis && (
                  <div className="space-y-10">
                    {/* Summary */}
                    {analysis.summary && (
                      <div className="p-6 border border-primary/20 rounded-xl bg-primary/5 relative overflow-hidden">
                        <div className="absolute -top-10 -right-10 w-40 h-40 bg-primary/10 blur-[60px] rounded-full pointer-events-none" />
                        <div className="flex items-start gap-4 relative z-10">
                          <Sparkles className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                          <div>
                            <p className="font-display tracking-[0.2em] uppercase text-[10px] text-primary mb-2">AI Content Summary</p>
                            <p className="text-foreground/80 font-light leading-relaxed">{analysis.summary}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Task List */}
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

                    {/* Approved count + confirm */}
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
          </TabsContent>

          {/* HISTORY TAB */}
          <TabsContent value="history" className="mt-8 outline-none">
            <Card className="border-secondary/20 shadow-[0_10px_50px_rgba(255,0,255,0.03)] bg-card/40 backdrop-blur-md rounded-2xl overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-secondary to-transparent" />
              <CardHeader className="pb-4 sm:pb-8 pt-6 sm:pt-10 px-4 sm:px-10">
                <CardTitle className="font-serif text-xl sm:text-3xl font-bold">Processing Log</CardTitle>
                <CardDescription className="text-base mt-2 font-light text-foreground/70">Status of all data payloads submitted for AI synthesis.</CardDescription>
              </CardHeader>
              <CardContent className="px-4 sm:px-10 pb-6 sm:pb-10">
                <div className="space-y-6">
                  {uploads?.length === 0 && (
                    <div className="text-center py-20 text-foreground/70 border border-dashed border-border/50 rounded-2xl bg-background/20 font-display tracking-widest uppercase text-xs">
                      No Data Payloads Found
                    </div>
                  )}
                  {uploads?.map((upload) => (
                    <div key={upload.id} className="group flex flex-col xl:flex-row xl:items-center justify-between p-6 border border-border/40 rounded-2xl bg-background/30 hover:border-secondary/30 hover:bg-background/50 transition-all duration-300">
                      <div className="flex-1">
                        <div className="flex items-center space-x-4 mb-3">
                          <Badge
                            variant="outline"
                            className={`font-display uppercase tracking-[0.1em] text-[10px] px-2 py-0.5 border-transparent ${
                              upload.status === "processed" ? "bg-primary/10 text-primary" :
                              upload.status === "error" ? "bg-destructive/10 text-destructive" :
                              "bg-secondary/10 text-secondary animate-pulse"
                            }`}
                          >
                            {upload.status}
                          </Badge>
                          <span className="text-xs text-foreground/70 font-mono tracking-tight opacity-70">
                            {format(new Date(upload.createdAt), "yyyy.MM.dd HH:mm:ss")}
                          </span>
                        </div>
                        <h4 className="text-lg font-serif font-bold text-foreground/90 mb-1">
                          {upload.contentType.replace("_", " ").toUpperCase()} <span className="text-foreground/70 font-normal mx-2">|</span> {upload.contributorName || "Anonymous Source"}
                        </h4>
                        <div className="flex items-center space-x-2 mt-2">
                          <span className="font-display text-[10px] uppercase text-foreground/70 tracking-widest">Vectors:</span>
                          <div className="flex flex-wrap gap-2">
                            {upload.targetSections.map((s) => (
                              <span key={s} className="text-[10px] px-2 py-0.5 bg-card border border-border/50 rounded text-foreground/70">{s}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                      {upload.rawText && (
                        <div className="mt-6 xl:mt-0 xl:ml-12 xl:w-[400px] text-xs text-foreground/70 line-clamp-3 font-mono leading-relaxed p-4 bg-black/20 rounded-xl border border-white/5">
                          {upload.rawText}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* VERSIONS TAB */}
          <TabsContent value="versions" className="mt-8 outline-none">
            <Card className="border-accent/20 shadow-[0_10px_50px_rgba(0,150,255,0.03)] bg-card/40 backdrop-blur-md rounded-2xl overflow-hidden min-h-[700px]">
              <div className="h-1 w-full bg-gradient-to-r from-accent to-transparent" />
              <div className="flex flex-col lg:flex-row h-full min-h-[700px]">
                <div className="w-full lg:w-80 border-r border-border/30 bg-background/20 p-4 sm:p-8">
                  <div className="mb-6">
                    <h4 className="font-display tracking-[0.2em] text-[10px] uppercase text-foreground/70 mb-4">Sections</h4>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateImages}
                      disabled={generatingImages}
                      className="w-full border-accent/30 text-accent hover:bg-accent/10 font-display uppercase tracking-widest text-[10px] h-10"
                    >
                      <ImageIcon className="w-3 h-3 mr-2" />
                      {generatingImages ? "Generating…" : "Generate Section Images"}
                    </Button>

                    {imageProgress && imageProgress.total > 0 && (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between text-[10px] font-display uppercase tracking-widest text-foreground/70">
                          <span>{imageProgress.current} of {imageProgress.total} done</span>
                          <span>{Math.round((imageProgress.current / imageProgress.total) * 100)}%</span>
                        </div>
                        <div className="h-1 bg-border/30 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-accent to-secondary transition-all duration-700 ease-out"
                            style={{ width: `${(imageProgress.current / imageProgress.total) * 100}%` }}
                          />
                        </div>
                        {imageProgress.currentSectionTitle && (
                          <p className="text-[10px] text-foreground/60 truncate">
                            {imageProgress.current < imageProgress.total ? `Generating: ${imageProgress.currentSectionTitle}` : imageProgress.currentSectionTitle}
                          </p>
                        )}
                      </div>
                    )}

                    {!imageProgress && (
                      <div className="mt-3 space-y-1">
                        <label className="font-display tracking-[0.2em] text-[10px] uppercase text-foreground/60">
                          Prompt Addition (Optional)
                        </label>
                        <Input
                          value={promptExtra}
                          onChange={(e) => setPromptExtra(e.target.value)}
                          placeholder="e.g. bold, vibrant colors"
                          disabled={generatingImages}
                          className="bg-background/50 border-border/50 h-9 rounded-lg text-xs focus-visible:ring-accent/30"
                        />
                        <p className="text-[10px] text-foreground/60 leading-snug">Appended to each section's image prompt.</p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3">
                    {sections?.sort((a, b) => a.displayOrder - b.displayOrder).map((sec) => (
                      <div
                        key={sec.id}
                        className={`rounded-xl text-sm transition-all duration-300 border
                          ${selectedSectionId === sec.id
                            ? "bg-accent/10 border-accent/30 text-accent shadow-[inset_0_0_15px_rgba(0,150,255,0.05)]"
                            : "border-transparent hover:bg-background/50 text-foreground/70"}`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedSectionId(sec.id)}
                          className="w-full text-left px-4 pt-4 pb-2"
                        >
                          <div className="font-display text-[10px] opacity-50 mb-1">SECTION {sec.displayOrder}</div>
                          <div className="font-medium leading-tight">{sec.title}</div>
                        </button>
                        <div className="px-4 pb-3 flex items-center gap-2">
                          <label className={`flex items-center gap-1.5 cursor-pointer text-[10px] font-display uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-all
                            ${uploadingSectionId === sec.id
                              ? "border-accent/20 text-accent/50 pointer-events-none"
                              : "border-accent/30 text-accent/70 hover:text-accent hover:bg-accent/10"}`}
                          >
                            {uploadingSectionId === sec.id
                              ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                              : <UploadCloud className="w-3 h-3" />}
                            {uploadingSectionId === sec.id ? "Uploading…" : "Upload Image"}
                            <input
                              type="file"
                              className="hidden"
                              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                              disabled={uploadingSectionId !== null}
                              onChange={(e) => {
                                handleImageUpload(sec.id, e.target.files?.[0]);
                                e.target.value = "";
                              }}
                            />
                          </label>
                          {(sec.imageUrl || imageProgress?.completedSlugs.has(sec.slug)) && (
                            <span
                              className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0"
                              title="Image set"
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex-1 p-4 sm:p-8 lg:p-12 overflow-y-auto">
                  {!selectedSectionId ? (
                    <div className="h-full flex flex-col items-center justify-center text-foreground/70 border border-dashed border-border/40 rounded-2xl bg-background/10">
                      <GitBranch className="w-12 h-12 mb-4 opacity-20" />
                      <p className="font-display tracking-widest text-xs uppercase">Select a section to view its history</p>
                    </div>
                  ) : (
                    <div className="space-y-10">
                      <div className="mb-10">
                        <h3 className="font-serif text-3xl font-bold text-foreground/90">
                          {sections?.find((s) => s.id === selectedSectionId)?.title}
                        </h3>
                        <p className="font-display tracking-[0.2em] uppercase text-[10px] text-accent mt-3">Version Matrix</p>
                      </div>

                      {versions?.length === 0 && <p className="text-foreground/70 font-light italic">No version history found for this section.</p>}

                      {versions?.map((version, idx) => (
                        <div key={version.id} className="relative pl-10 pb-10 border-l border-border/30 last:pb-0 last:border-transparent">
                          <div className="absolute left-0 top-0 w-3 h-3 -translate-x-[6.5px] rounded-full bg-background border-2 border-accent" />
                          <div className="bg-card/50 border border-border/40 rounded-2xl p-8 relative overflow-hidden group hover:border-accent/30 transition-colors">
                            {idx === 0 && (
                              <div className="absolute top-0 right-0 bg-accent text-accent-foreground text-[9px] font-display uppercase tracking-widest px-4 py-1.5 rounded-bl-xl shadow-[0_0_15px_rgba(0,150,255,0.3)]">
                                Active State
                              </div>
                            )}
                            <div className="flex items-center space-x-4 mb-8">
                              <div className="font-display text-sm text-foreground/80 tracking-widest">v.{version.id}.0</div>
                              <div className="w-1 h-1 rounded-full bg-border" />
                              <div className="text-xs text-foreground/70 font-mono tracking-tight">
                                {format(new Date(version.createdAt), "yyyy.MM.dd HH:mm:ss")}
                              </div>
                            </div>
                            <div className="space-y-8">
                              {version.keyInsights && version.keyInsights.length > 0 && (
                                <div>
                                  <span className="font-display tracking-[0.2em] text-[10px] uppercase text-accent mb-4 block">Extracted Insights</span>
                                  <ul className="space-y-2">
                                    {version.keyInsights.map((ki, i) => (
                                      <li key={i} className="flex items-start text-sm text-foreground/70 leading-relaxed">
                                        <span className="text-accent/50 mr-3 mt-0.5 select-none">›</span>
                                        {ki}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              <div>
                                <span className="font-display tracking-[0.2em] text-[10px] uppercase text-accent mb-4 block">Content Snapshot</span>
                                <div className="text-sm font-serif text-foreground/70 leading-loose border-l border-border/50 pl-6 py-2 bg-gradient-to-r from-background/50 to-transparent">
                                  {version.bodyMarkdown.substring(0, 300)}...
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* WIKI TAB */}
          <TabsContent value="wiki" className="mt-8 outline-none">
            <Card className="border-green-500/20 shadow-[0_10px_50px_rgba(0,200,100,0.03)] bg-card/40 backdrop-blur-md rounded-2xl overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-green-500 to-transparent" />
              <CardHeader className="pb-4 sm:pb-8 pt-6 sm:pt-10 px-4 sm:px-10">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="font-serif text-xl sm:text-3xl font-bold flex items-center gap-3">
                      <BookOpen className="w-6 h-6 text-green-400" />
                      Knowledge Base
                    </CardTitle>
                    <CardDescription className="text-sm sm:text-base mt-2 font-light text-foreground/70">
                      Monitor and maintain the public Knowledge Base. Wiki pages are created automatically each time you upload a PDF — this rebuild tool is only needed for maintenance or recovery.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="px-4 sm:px-10 pb-6 sm:pb-10 space-y-8">
                {/* Stats row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-border/50 bg-background/50 p-6">
                    <div className="text-[10px] font-display uppercase tracking-widest text-foreground/70 mb-2">Wiki Pages</div>
                    <div className="text-4xl font-bold font-serif text-green-400">
                      {wikiPageCount === null ? "—" : wikiPageCount}
                    </div>
                    <p className="text-xs text-foreground/70 mt-1">pages in the knowledge base</p>
                  </div>
                  <div className="rounded-xl border border-border/50 bg-background/50 p-6 flex flex-col justify-between">
                    <div>
                      <div className="text-[10px] font-display uppercase tracking-widest text-foreground/70 mb-2">Last Rebuild Result</div>
                      {wikiSeedResult ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-400" />
                            <span className="text-sm text-foreground/80">
                              <strong>{wikiSeedResult.pagesCreated}</strong> pages created
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <RefreshCw className="w-4 h-4 text-blue-400" />
                            <span className="text-sm text-foreground/80">
                              <strong>{wikiSeedResult.pagesUpdated}</strong> pages updated
                            </span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-foreground/70">Run a seed to see results.</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Seed action */}
                <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-6">
                  <h3 className="font-display text-sm tracking-widest uppercase text-green-400 mb-2">Rebuild Wiki from Report Sections</h3>
                  <p className="text-sm text-foreground/70 mb-4 leading-relaxed">
                    Use this if wiki pages are out of sync with the report — for example after manually editing a section, or to recover deleted pages. It re-reads all 8 compiled report sections and regenerates wiki pages from them. This may take 1–2 minutes.
                  </p>
                  <Button
                    onClick={handleWikiSeed}
                    disabled={wikiSeeding}
                    className="font-display uppercase tracking-widest text-[11px] bg-green-600 hover:bg-green-700 text-white border-none"
                  >
                    {wikiSeeding ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Building Wiki…
                      </>
                    ) : (
                      <>
                        <BookOpen className="w-4 h-4 mr-2" />
                        Rebuild Wiki from Sections
                      </>
                    )}
                  </Button>
                </div>

                {/* View link */}
                <div className="text-center">
                  <Link href="/" className="text-[11px] font-display uppercase tracking-widest text-foreground/70 hover:text-green-400 transition-colors inline-flex items-center gap-2">
                    <BookOpen className="w-3 h-3" />
                    View Knowledge Base
                  </Link>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
