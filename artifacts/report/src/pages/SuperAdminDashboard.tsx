import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link, useLocation } from "wouter";
import {
  LogOut, History, Settings,
  ImageIcon, CheckCircle2, UploadCloud, BookOpen, RefreshCw, AlertCircle,
  Trash2, RotateCcw, Calendar, X,
} from "lucide-react";

import { useSuperAuth } from "@/hooks/use-super-auth";
import { useSections, useSectionVersions } from "@/hooks/use-sections";
import { useUploads, useDeleteUpload, useUploadImpact, useRegressPreview, useRegress, type UploadImpact } from "@/hooks/use-uploads";
import { getListSectionsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function SuperAdminDashboard() {
  const { isAuthenticated, isLoading: authLoading, logout } = useSuperAuth();
  const [, setLocation] = useLocation();
  const { data: sections } = useSections();
  const { data: uploads, refetch: refetchUploads } = useUploads();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);
  const { data: versions } = useSectionVersions(selectedSectionId ?? 0);
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

  const [wikiPageCount, setWikiPageCount] = useState<number | null>(null);
  const [wikiSeeding, setWikiSeeding] = useState(false);
  const [wikiSeedResult, setWikiSeedResult] = useState<{ pagesCreated: number; pagesUpdated: number } | null>(null);

  const deleteUpload = useDeleteUpload();
  const uploadImpact = useUploadImpact();
  const regressPreview = useRegressPreview();
  const regress = useRegress();

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<UploadImpact | null>(null);
  const [regressDate, setRegressDate] = useState("");
  const [regressPreviewData, setRegressPreviewData] = useState<{
    sectionsAffected: number;
    wikiPagesRemoved: number;
    uploadsRemoved: number;
    versionsRemoved: number;
  } | null>(null);
  const [regressConfirmOpen, setRegressConfirmOpen] = useState(false);

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
      setLocation("/super-admin/login");
    }
    if (!authLoading && isAuthenticated) {
      fetchWikiCount();
    }
  }, [authLoading, isAuthenticated, setLocation]);

  if (authLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!isAuthenticated) return null;

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

  const handleDeleteButtonClick = async (uploadId: number) => {
    setDeleteImpact(null);
    setDeleteConfirmId(uploadId);
    try {
      const impact = await uploadImpact.mutateAsync(uploadId);
      setDeleteImpact(impact);
    } catch {
      // Non-critical — dialog still opens without impact count
    }
  };

  const handleDeleteUpload = async (uploadId: number) => {
    try {
      const result = await deleteUpload.mutateAsync(uploadId);
      setDeleteConfirmId(null);
      setDeleteImpact(null);
      toast({
        title: "Contribution Deleted",
        description: `${result.sectionsReverted} section(s) reverted, ${result.versionsDeleted} version(s) removed.`,
      });
      await refetchUploads();
      await queryClient.invalidateQueries({ queryKey: getListSectionsQueryKey() });
      fetchWikiCount();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      toast({ title: "Delete Failed", description: message, variant: "destructive" });
    }
  };

  // Use end-of-selected-day (23:59:59.999) so the chosen date is fully inclusive
  function toEndOfDay(dateStr: string): string {
    return new Date(`${dateStr}T23:59:59.999`).toISOString();
  }

  const handleRegressPreview = async () => {
    if (!regressDate) {
      toast({ title: "Date Required", description: "Please select a target date.", variant: "destructive" });
      return;
    }
    try {
      const preview = await regressPreview.mutateAsync(toEndOfDay(regressDate));
      setRegressPreviewData(preview);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preview failed";
      toast({ title: "Preview Failed", description: message, variant: "destructive" });
    }
  };

  const handleRegressConfirm = async () => {
    if (!regressDate) return;
    try {
      const result = await regress.mutateAsync(toEndOfDay(regressDate));
      setRegressConfirmOpen(false);
      setRegressPreviewData(null);
      setRegressDate("");
      fetchWikiCount();
      toast({
        title: "Regression Complete",
        description: `${result.sectionsReverted} section(s) reverted · ${result.versionsDeleted} version(s) removed · ${result.wikiPagesDeleted} wiki page(s) deleted · ${result.uploadsDeleted} upload(s) removed.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Regression failed";
      toast({ title: "Regression Failed", description: message, variant: "destructive" });
    }
  };

  const deleteTarget = deleteConfirmId !== null ? uploads?.find((u) => u.id === deleteConfirmId) : null;

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:3rem_3rem] opacity-30 pointer-events-none z-0" />

      <header className="border-b border-border/50 bg-card/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center border border-accent/20">
              <Settings className="text-accent w-5 h-5" />
            </div>
            <div>
              <div className="font-serif font-bold text-base sm:text-lg leading-tight text-foreground/90">ADMIN PANEL</div>
              <div className="font-display text-[10px] uppercase tracking-widest text-accent/70">Restricted Access</div>
            </div>
          </div>
          <div className="flex items-center space-x-3 sm:space-x-6">
            <Link href="/" className="hidden sm:block text-[11px] font-display uppercase tracking-widest text-foreground/70 hover:text-accent transition-colors">
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
        <Tabs defaultValue="wiki" className="space-y-8">
          <TabsList className="w-full bg-card/50 backdrop-blur-md border border-border/50 p-1 rounded-xl h-auto">
            <TabsTrigger value="wiki" className="flex-1 py-3 px-2 sm:px-4 rounded-lg font-display tracking-tight sm:tracking-[0.12em] uppercase text-[10px] sm:text-xs data-[state=active]:bg-green-500/10 data-[state=active]:text-green-400 transition-all">
              <BookOpen className="hidden sm:inline-flex w-4 h-4 sm:mr-2" />Wiki
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-1 py-3 px-2 sm:px-4 rounded-lg font-display tracking-tight sm:tracking-[0.12em] uppercase text-[10px] sm:text-xs data-[state=active]:bg-secondary/10 data-[state=active]:text-secondary transition-all">
              <History className="hidden sm:inline-flex w-4 h-4 sm:mr-2" />Contributions
            </TabsTrigger>
            <TabsTrigger value="regress" className="flex-1 py-3 px-2 sm:px-4 rounded-lg font-display tracking-tight sm:tracking-[0.12em] uppercase text-[10px] sm:text-xs data-[state=active]:bg-amber-500/10 data-[state=active]:text-amber-400 transition-all">
              <RotateCcw className="hidden sm:inline-flex w-4 h-4 sm:mr-2" />Regress
            </TabsTrigger>
            <TabsTrigger value="images" className="flex-1 py-3 px-2 sm:px-4 rounded-lg font-display tracking-tight sm:tracking-[0.12em] uppercase text-[10px] sm:text-xs data-[state=active]:bg-accent/10 data-[state=active]:text-accent transition-all">
              <ImageIcon className="hidden sm:inline-flex w-4 h-4 sm:mr-2" />Images
            </TabsTrigger>
          </TabsList>

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
                      Monitor and maintain the public Knowledge Base. Wiki pages are created automatically each time a contributor uploads a PDF — this rebuild tool is only needed for maintenance or recovery.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="px-4 sm:px-10 pb-6 sm:pb-10 space-y-8">
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

                <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-6">
                  <h3 className="font-display text-sm tracking-widest uppercase text-green-400 mb-2">Rebuild Wiki from Report Sections</h3>
                  <p className="text-sm text-foreground/70 mb-4 leading-relaxed">
                    Use this if wiki pages are out of sync with the report — for example after manually editing a section, or to recover deleted pages. It re-reads all compiled report sections and regenerates wiki pages from them. This may take 1–2 minutes.
                  </p>
                  <Button
                    onClick={handleWikiSeed}
                    disabled={wikiSeeding}
                    className="font-display uppercase tracking-[0.15em] text-[11px] bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30 rounded-xl h-11 px-6 transition-all"
                  >
                    {wikiSeeding
                      ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Rebuilding…</>
                      : <><RefreshCw className="w-3.5 h-3.5 mr-2" />Rebuild Wiki</>}
                  </Button>
                  {wikiSeeding && (
                    <p className="text-xs text-foreground/60 mt-3 leading-relaxed">
                      This process reads all report sections and extracts wiki pages. It may take 1–2 minutes depending on content volume.
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
                  <div className="flex gap-3">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-foreground/70 leading-relaxed">
                      <span className="font-medium text-amber-400">Avoid running repeatedly:</span> each run can append additional content to existing pages. Running it multiple times may cause pages to accumulate redundant sections.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* CONTRIBUTIONS / HISTORY TAB */}
          <TabsContent value="history" className="mt-8 outline-none">
            <Card className="border-secondary/20 shadow-[0_10px_50px_rgba(255,0,255,0.03)] bg-card/40 backdrop-blur-md rounded-2xl overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-secondary to-transparent" />
              <CardHeader className="pb-4 sm:pb-8 pt-6 sm:pt-10 px-4 sm:px-10">
                <CardTitle className="font-serif text-xl sm:text-3xl font-bold">Contributions</CardTitle>
                <CardDescription className="text-base mt-2 font-light text-foreground/70">
                  All data payloads submitted for AI synthesis. Deleting a contribution rolls back any sections it updated and removes its wiki sources.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 sm:px-10 pb-6 sm:pb-10">
                <div className="space-y-6">
                  {uploads?.length === 0 && (
                    <div className="text-center py-20 text-foreground/70 border border-dashed border-border/50 rounded-2xl bg-background/20 font-display tracking-widest uppercase text-xs">
                      No Contributions Found
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
                          <span className="text-xs text-foreground/40 font-mono">#{upload.id}</span>
                        </div>
                        <h4 className="text-lg font-serif font-bold text-foreground/90 mb-1">
                          {upload.contentType.replace(/_/g, " ").toUpperCase()} <span className="text-foreground/70 font-normal mx-2">|</span> {upload.contributorName || "Anonymous Source"}
                        </h4>
                        {(upload as unknown as { uploaderName?: string }).uploaderName && (
                          <p className="text-xs text-foreground/50 font-display uppercase tracking-widest mt-0.5">
                            Uploaded by {(upload as unknown as { uploaderName?: string }).uploaderName}
                          </p>
                        )}
                        <div className="flex items-center space-x-2 mt-2">
                          <span className="font-display text-[10px] uppercase text-foreground/70 tracking-widest">Sections:</span>
                          <div className="flex flex-wrap gap-2">
                            {upload.targetSections.map((s) => (
                              <span key={s} className="text-[10px] px-2 py-0.5 bg-card border border-border/50 rounded text-foreground/70">{s}</span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 mt-6 xl:mt-0 xl:ml-8">
                        {upload.rawText && (
                          <div className="hidden xl:block xl:w-[320px] text-xs text-foreground/70 line-clamp-3 font-mono leading-relaxed p-4 bg-black/20 rounded-xl border border-white/5">
                            {upload.rawText}
                          </div>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteButtonClick(upload.id)}
                          disabled={uploadImpact.isPending && deleteConfirmId === upload.id}
                          className="shrink-0 text-foreground/40 hover:text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20 rounded-xl h-9 px-3 transition-all"
                        >
                          {uploadImpact.isPending && deleteConfirmId === upload.id
                            ? <div className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* REGRESS TAB */}
          <TabsContent value="regress" className="mt-8 outline-none">
            <Card className="border-amber-500/20 shadow-[0_10px_50px_rgba(255,180,0,0.03)] bg-card/40 backdrop-blur-md rounded-2xl overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-amber-500 to-transparent" />
              <CardHeader className="pb-4 sm:pb-8 pt-6 sm:pt-10 px-4 sm:px-10">
                <CardTitle className="font-serif text-xl sm:text-3xl font-bold flex items-center gap-3">
                  <RotateCcw className="w-6 h-6 text-amber-400" />
                  Regress to Date
                </CardTitle>
                <CardDescription className="text-base mt-2 font-light text-foreground/70">
                  Roll back the entire report to the state it was in at a chosen date. All sections will revert to their most recent version on or before that date; wiki pages and contributions created after that date will be permanently removed.
                </CardDescription>
              </CardHeader>

              <CardContent className="px-4 sm:px-10 pb-6 sm:pb-10 space-y-8">
                <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5">
                  <div className="flex gap-3">
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <p className="text-xs text-foreground/70 leading-relaxed">
                      <span className="font-medium text-destructive">This action is irreversible.</span> All contributions, section versions, and wiki pages created after the chosen date will be permanently deleted. Use the preview to review the impact before confirming.
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 space-y-6">
                  <div>
                    <label className="font-display text-[10px] uppercase tracking-widest text-amber-400 block mb-3">
                      Target Date
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40 pointer-events-none" />
                        <Input
                          type="date"
                          value={regressDate}
                          onChange={(e) => {
                            setRegressDate(e.target.value);
                            setRegressPreviewData(null);
                          }}
                          max={new Date().toISOString().split("T")[0]}
                          className="pl-10 bg-background/50 border-amber-500/30 focus:border-amber-500/60 text-foreground/90 font-mono w-52"
                        />
                      </div>
                      <Button
                        onClick={handleRegressPreview}
                        disabled={!regressDate || regressPreview.isPending}
                        variant="outline"
                        className="font-display uppercase tracking-[0.15em] text-[11px] border-amber-500/30 text-amber-400 hover:bg-amber-500/10 rounded-xl h-10 px-5"
                      >
                        {regressPreview.isPending
                          ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Previewing…</>
                          : "Preview Impact"}
                      </Button>
                    </div>
                  </div>

                  {regressPreviewData && (
                    <div className="space-y-4">
                      <div className="font-display text-[10px] uppercase tracking-widest text-foreground/60 mb-3">Impact Preview</div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: "Sections Reverted", value: regressPreviewData.sectionsAffected, color: "text-amber-400" },
                          { label: "Versions Removed", value: regressPreviewData.versionsRemoved, color: "text-orange-400" },
                          { label: "Wiki Pages Deleted", value: regressPreviewData.wikiPagesRemoved, color: "text-red-400" },
                          { label: "Contributions Deleted", value: regressPreviewData.uploadsRemoved, color: "text-destructive" },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="rounded-lg border border-border/40 bg-background/40 p-4 text-center">
                            <div className={`text-3xl font-bold font-serif ${color}`}>{value}</div>
                            <div className="text-[10px] font-display uppercase tracking-widest text-foreground/50 mt-1">{label}</div>
                          </div>
                        ))}
                      </div>

                      {regressPreviewData.sectionsAffected === 0 && regressPreviewData.wikiPagesRemoved === 0 && regressPreviewData.uploadsRemoved === 0 ? (
                        <div className="flex items-center gap-2 p-4 rounded-lg bg-green-500/5 border border-green-500/20">
                          <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                          <p className="text-sm text-foreground/70">No changes — the report is already at or before this date.</p>
                        </div>
                      ) : (
                        <Button
                          onClick={() => setRegressConfirmOpen(true)}
                          className="font-display uppercase tracking-[0.15em] text-[11px] bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/30 rounded-xl h-11 px-6"
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-2" />
                          Regress to {regressDate}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* IMAGE GENERATION TAB */}
          <TabsContent value="images" className="mt-8 outline-none">
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
                          Style Prompt (optional)
                        </label>
                        <Input
                          value={promptExtra}
                          onChange={(e) => setPromptExtra(e.target.value)}
                          placeholder="e.g. neon, minimalist, watercolor"
                          className="bg-background/50 border-accent/20 focus:border-accent/50 text-foreground/90 text-xs h-9 rounded-lg"
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <h4 className="font-display tracking-[0.2em] text-[10px] uppercase text-foreground/70 mb-3">Select Section</h4>
                    {sections?.map((section) => (
                      <button
                        key={section.id}
                        onClick={() => setSelectedSectionId(section.id === selectedSectionId ? null : section.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-display tracking-wide transition-all border ${
                          selectedSectionId === section.id
                            ? "bg-accent/10 text-accent border-accent/30"
                            : "text-foreground/60 border-transparent hover:bg-card/50 hover:text-foreground/80"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{section.title}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            {section.imageUrl ? (
                              <CheckCircle2 className={`w-3 h-3 ${selectedSectionId === section.id ? "text-accent" : "text-green-500/70"}`} />
                            ) : (
                              <UploadCloud className={`w-3 h-3 ${selectedSectionId === section.id ? "text-accent/70" : "text-foreground/30"}`} />
                            )}
                            {imageProgress?.completedSlugs.has(section.slug) && (
                              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                            )}
                            {imageProgress?.failedSlugs.has(section.slug) && (
                              <div className="w-1.5 h-1.5 rounded-full bg-destructive" />
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 p-4 sm:p-10 overflow-y-auto">
                  {!selectedSectionId && (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                      <div className="w-20 h-20 rounded-2xl border border-dashed border-accent/30 flex items-center justify-center">
                        <ImageIcon className="w-8 h-8 text-accent/50" />
                      </div>
                      <p className="font-display text-xs uppercase tracking-widest text-foreground/70">Select a section to manage its image</p>
                    </div>
                  )}

                  {selectedSectionId && (
                    <div>
                      <div className="mb-10">
                        <h3 className="font-serif text-3xl font-bold text-foreground/90">
                          {sections?.find((s) => s.id === selectedSectionId)?.title}
                        </h3>
                        <p className="font-display tracking-[0.2em] uppercase text-[10px] text-accent mt-3">Image Management</p>
                      </div>

                      <div className="space-y-6">
                        {sections?.find((s) => s.id === selectedSectionId)?.imageUrl && (
                          <div>
                            <div className="font-display tracking-[0.15em] text-[10px] uppercase text-foreground/60 mb-3">Current Image</div>
                            <img
                              src={sections.find((s) => s.id === selectedSectionId)?.imageUrl ?? ""}
                              alt="Section"
                              className="rounded-xl border border-border/30 max-w-full max-h-64 object-cover"
                            />
                          </div>
                        )}

                        <div className="rounded-xl border border-accent/20 bg-accent/5 p-6">
                          <div className="font-display tracking-[0.15em] text-[10px] uppercase text-accent mb-3">Upload Custom Image</div>
                          <p className="text-sm text-foreground/70 mb-4">PNG, JPEG, or WebP · max 10 MB</p>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            id={`img-upload-${selectedSectionId}`}
                            className="hidden"
                            onChange={(e) => handleImageUpload(selectedSectionId, e.target.files?.[0])}
                          />
                          <Button
                            asChild
                            variant="outline"
                            disabled={uploadingSectionId === selectedSectionId}
                            className="border-accent/30 text-accent hover:bg-accent/10 font-display uppercase tracking-widest text-[10px] h-10"
                          >
                            <label htmlFor={`img-upload-${selectedSectionId}`} className="cursor-pointer">
                              {uploadingSectionId === selectedSectionId
                                ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Uploading…</>
                                : <><UploadCloud className="w-3.5 h-3.5 mr-2" />Choose Image</>}
                            </label>
                          </Button>
                        </div>

                        <div className="rounded-xl border border-border/40 bg-background/30 p-6">
                          <div className="font-display tracking-[0.15em] text-[10px] uppercase text-foreground/60 mb-3">Version Matrix</div>
                          {versions?.length === 0 && <p className="text-foreground/70 font-light italic text-sm">No version history found for this section.</p>}
                          <div className="space-y-4">
                            {versions?.map((version, idx) => (
                              <div key={version.id} className="relative pl-8 pb-4 border-l border-border/30 last:pb-0 last:border-transparent">
                                <div className="absolute left-0 top-0 w-2.5 h-2.5 -translate-x-[5px] rounded-full bg-background border-2 border-accent" />
                                <div className="bg-card/50 border border-border/40 rounded-xl p-5">
                                  {idx === 0 && (
                                    <span className="inline-block mb-2 text-[9px] font-display uppercase tracking-widest bg-accent/10 text-accent px-2 py-0.5 rounded">Active</span>
                                  )}
                                  <div className="flex items-center gap-3 mb-3">
                                    <div className="font-display text-sm text-foreground/80">v.{version.id}.0</div>
                                    <div className="text-xs text-foreground/50 font-mono">{format(new Date(version.createdAt), "yyyy.MM.dd HH:mm")}</div>
                                  </div>
                                  {version.keyInsights && version.keyInsights.length > 0 && (
                                    <ul className="space-y-1">
                                      {version.keyInsights.slice(0, 3).map((ki, i) => (
                                        <li key={i} className="flex items-start text-xs text-foreground/60 leading-relaxed">
                                          <span className="text-accent/40 mr-2 mt-0.5">›</span>{ki}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* DELETE CONTRIBUTION DIALOG */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={(open) => { if (!open) { setDeleteConfirmId(null); setDeleteImpact(null); } }}>
        <DialogContent className="bg-card border-border/50 rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Delete Contribution?</DialogTitle>
            <DialogDescription className="text-foreground/70 mt-2 leading-relaxed">
              Permanently remove contribution <span className="font-mono text-foreground/90">#{deleteTarget?.id}</span>
              {deleteTarget && (
                <> ({deleteTarget.contentType.replace(/_/g, " ")} by {deleteTarget.contributorName || "Anonymous"})</>
              )}.
            </DialogDescription>
          </DialogHeader>

          {/* Impact preview */}
          {uploadImpact.isPending ? (
            <div className="flex items-center gap-2 text-xs text-foreground/60 py-1">
              <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              Checking impact…
            </div>
          ) : deleteImpact ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border/40 bg-background/40 p-3 text-center">
                <div className="text-2xl font-bold font-serif text-amber-400">{deleteImpact.sectionsReverted}</div>
                <div className="text-[9px] font-display uppercase tracking-widest text-foreground/50 mt-0.5">Section(s) Reverted</div>
              </div>
              <div className="rounded-lg border border-border/40 bg-background/40 p-3 text-center">
                <div className="text-2xl font-bold font-serif text-orange-400">{deleteImpact.versionsDeleted}</div>
                <div className="text-[9px] font-display uppercase tracking-widest text-foreground/50 mt-0.5">Version(s) Removed</div>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-foreground/70 flex gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            Sections updated by this contribution will roll back to their previous version. Wiki sources will be cleaned up. This cannot be undone.
          </div>
          <DialogFooter className="gap-3">
            <Button
              variant="ghost"
              onClick={() => { setDeleteConfirmId(null); setDeleteImpact(null); }}
              className="font-display uppercase tracking-widest text-[11px] text-foreground/60"
            >
              <X className="w-3.5 h-3.5 mr-1" />Cancel
            </Button>
            <Button
              onClick={() => deleteConfirmId !== null && handleDeleteUpload(deleteConfirmId)}
              disabled={deleteUpload.isPending}
              className="font-display uppercase tracking-widest text-[11px] bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/30 rounded-xl"
            >
              {deleteUpload.isPending
                ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Deleting…</>
                : <><Trash2 className="w-3.5 h-3.5 mr-2" />Delete Contribution</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REGRESS CONFIRM DIALOG */}
      <Dialog open={regressConfirmOpen} onOpenChange={setRegressConfirmOpen}>
        <DialogContent className="bg-card border-border/50 rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Confirm Regression</DialogTitle>
            <DialogDescription className="text-foreground/70 mt-2 leading-relaxed">
              You are about to roll back the entire report to <span className="font-mono text-foreground/90">{regressDate}</span>.
            </DialogDescription>
          </DialogHeader>
          {regressPreviewData && (
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Sections Reverted", value: regressPreviewData.sectionsAffected },
                { label: "Versions Removed", value: regressPreviewData.versionsRemoved },
                { label: "Wiki Pages Deleted", value: regressPreviewData.wikiPagesRemoved },
                { label: "Contributions Deleted", value: regressPreviewData.uploadsRemoved },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-border/40 bg-background/40 p-3 text-center">
                  <div className="text-2xl font-bold font-serif text-destructive">{value}</div>
                  <div className="text-[9px] font-display uppercase tracking-widest text-foreground/50 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-foreground/70 flex gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            This cannot be undone. All affected data will be permanently deleted.
          </div>
          <DialogFooter className="gap-3">
            <Button
              variant="ghost"
              onClick={() => setRegressConfirmOpen(false)}
              className="font-display uppercase tracking-widest text-[11px] text-foreground/60"
            >
              <X className="w-3.5 h-3.5 mr-1" />Cancel
            </Button>
            <Button
              onClick={handleRegressConfirm}
              disabled={regress.isPending}
              className="font-display uppercase tracking-widest text-[11px] bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/30 rounded-xl"
            >
              {regress.isPending
                ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Reverting…</>
                : <><RotateCcw className="w-3.5 h-3.5 mr-2" />Confirm Regression</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
