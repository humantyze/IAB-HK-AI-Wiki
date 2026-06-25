import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link, useLocation } from "wouter";
import {
  LogOut, History, Settings,
  CheckCircle2, BookOpen, RefreshCw, AlertCircle,
  Trash2, RotateCcw, Calendar, X, DatabaseBackup, CloudUpload, ImagePlay,
} from "lucide-react";

import { useSuperAuth } from "@/hooks/use-super-auth";
import { useUploads, useDeleteUpload, useUploadImpact, useRegressPreview, useRegress, type UploadImpact } from "@/hooks/use-uploads";
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
  const { data: uploads, refetch: refetchUploads } = useUploads();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [wikiPageCount, setWikiPageCount] = useState<number | null>(null);
  const [wikiSeeding, setWikiSeeding] = useState(false);
  const [wikiSeedResult, setWikiSeedResult] = useState<{ pagesCreated: number; pagesUpdated: number } | null>(null);

  const [imageBackfilling, setImageBackfilling] = useState(false);
  const [imageBackfillResult, setImageBackfillResult] = useState<{ pagesUpdated: number; uploadsProcessed: number; message?: string } | null>(null);

  interface BackupEntry {
    id: number;
    createdAt: string;
    backedUpAt: string;
    storageObjectPath: string | null;
    fileName: string;
  }
  const [lastBackup, setLastBackup] = useState<BackupEntry | null | undefined>(undefined);
  const [backupHistory, setBackupHistory] = useState<BackupEntry[]>([]);
  const [backupRunning, setBackupRunning] = useState(false);

  const deleteUpload = useDeleteUpload();
  const uploadImpact = useUploadImpact();
  const regressPreview = useRegressPreview();
  const regress = useRegress();

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<UploadImpact | null>(null);
  const [regressDate, setRegressDate] = useState("");
  const [regressPreviewData, setRegressPreviewData] = useState<{
    wikiPagesRemoved: number;
    uploadsRemoved: number;
  } | null>(null);
  const [regressConfirmOpen, setRegressConfirmOpen] = useState(false);
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false);
  const [wiping, setWiping] = useState(false);

  const fetchBackupStatus = async () => {
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/super-admin/backup/status`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { last: BackupEntry | null; history: BackupEntry[] };
        setLastBackup(data.last);
        setBackupHistory(data.history ?? []);
      }
    } catch {
      setLastBackup(null);
    }
  };

  const handleBackupNow = async () => {
    setBackupRunning(true);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/super-admin/backup/run`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as { fileName?: string; storageObjectPath?: string; error?: string; skipped?: boolean };
      if (!res.ok) {
        toast({ title: "Backup Failed", description: String(data.error ?? "Unknown error"), variant: "destructive" });
      } else if (data.skipped) {
        toast({ title: "Backup Skipped", description: "No new data since last backup." });
      } else {
        toast({ title: "Backup Complete", description: data.fileName ?? "Backup saved to object storage." });
        await fetchBackupStatus();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      toast({ title: "Backup Failed", description: message, variant: "destructive" });
    } finally {
      setBackupRunning(false);
    }
  };

  const handleImageBackfill = async () => {
    setImageBackfilling(true);
    setImageBackfillResult(null);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/wiki/backfill-images`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json() as { pagesUpdated: number; uploadsProcessed: number; message?: string };
        setImageBackfillResult(data);
        toast({
          title: "Image Backfill Complete",
          description: data.message ?? `${data.pagesUpdated} page(s) received images from ${data.uploadsProcessed} PDF(s).`,
        });
      } else {
        toast({ title: "Backfill Failed", description: "Image backfill encountered an error.", variant: "destructive" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      toast({ title: "Backfill Failed", description: message, variant: "destructive" });
    } finally {
      setImageBackfilling(false);
    }
  };

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
        toast({ title: "Wiki Reindexed", description: `${data.pagesCreated} pages created, ${data.pagesUpdated} updated.` });
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
      fetchBackupStatus();
    }
  }, [authLoading, isAuthenticated, setLocation]);

  if (authLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!isAuthenticated) return null;

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
      await deleteUpload.mutateAsync(uploadId);
      setDeleteConfirmId(null);
      setDeleteImpact(null);
      toast({ title: "Contribution Deleted", description: "Upload and associated wiki sources removed." });
      await refetchUploads();
      fetchWikiCount();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      toast({ title: "Delete Failed", description: message, variant: "destructive" });
    }
  };

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

  const handleWipe = async () => {
    setWiping(true);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/admin/wipe`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as { wikiPagesDeleted?: number; uploadsDeleted?: number; chunksDeleted?: number; error?: string };
      if (!res.ok) {
        toast({ title: "Wipe Failed", description: String(data.error ?? "Unknown error"), variant: "destructive" });
      } else {
        setWipeConfirmOpen(false);
        await refetchUploads();
        fetchWikiCount();
        toast({
          title: "Database Wiped",
          description: `${data.wikiPagesDeleted} wiki page(s) · ${data.uploadsDeleted} upload(s) · ${data.chunksDeleted} chunk(s) removed.`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      toast({ title: "Wipe Failed", description: message, variant: "destructive" });
    } finally {
      setWiping(false);
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
        description: `${result.wikiPagesDeleted} wiki page(s) deleted · ${result.uploadsDeleted} upload(s) removed.`,
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
            <TabsTrigger value="backup" className="flex-1 py-3 px-2 sm:px-4 rounded-lg font-display tracking-tight sm:tracking-[0.12em] uppercase text-[10px] sm:text-xs data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-400 transition-all">
              <DatabaseBackup className="hidden sm:inline-flex w-4 h-4 sm:mr-2" />Backup
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
                      Monitor the public Knowledge Base. Wiki pages are created automatically each time a contributor uploads a PDF.
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
                        <p className="text-sm text-foreground/70">Run a rebuild to see results.</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-6">
                  <h3 className="font-display text-sm tracking-widest uppercase text-green-400 mb-2">Rebuild Wiki Index</h3>
                  <p className="text-sm text-foreground/70 mb-4 leading-relaxed">
                    Use this to reindex wiki pages — for example after manually editing pages or to recover from sync issues. Wiki pages are generated from uploaded PDFs via the contributor portal.
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
                </div>

                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-6">
                  <h3 className="font-display text-sm tracking-widest uppercase text-violet-400 mb-2">Backfill Images from PDFs</h3>
                  <p className="text-sm text-foreground/70 mb-4 leading-relaxed">
                    Retroactively extract images from archived PDFs and assign the most relevant image to each wiki page that currently has none. Already-imaged pages are skipped. This may take a few minutes.
                  </p>
                  {imageBackfillResult && (
                    <div className="mb-4 space-y-1">
                      {imageBackfillResult.message ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                          <span className="text-sm text-foreground/80">{imageBackfillResult.message}</span>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-violet-400" />
                            <span className="text-sm text-foreground/80">
                              <strong>{imageBackfillResult.pagesUpdated}</strong> page(s) received images
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <ImagePlay className="w-4 h-4 text-violet-400/60" />
                            <span className="text-sm text-foreground/80">
                              from <strong>{imageBackfillResult.uploadsProcessed}</strong> PDF(s) processed
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <Button
                    onClick={handleImageBackfill}
                    disabled={imageBackfilling}
                    className="font-display uppercase tracking-[0.15em] text-[11px] bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/30 rounded-xl h-11 px-6 transition-all"
                  >
                    {imageBackfilling
                      ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Processing…</>
                      : <><ImagePlay className="w-3.5 h-3.5 mr-2" />Backfill Images</>}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* CONTRIBUTIONS TAB */}
          <TabsContent value="history" className="mt-8 outline-none">
            <Card className="border-secondary/20 shadow-[0_10px_50px_rgba(255,100,255,0.03)] bg-card/40 backdrop-blur-md rounded-2xl overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-secondary to-transparent" />
              <CardHeader className="pb-4 sm:pb-8 pt-6 sm:pt-10 px-4 sm:px-10">
                <CardTitle className="font-serif text-xl sm:text-3xl font-bold flex items-center gap-3">
                  <History className="w-6 h-6 text-secondary" />
                  Contribution History
                </CardTitle>
                <CardDescription className="text-sm sm:text-base mt-2 font-light text-foreground/70">
                  All data payloads submitted for AI synthesis. Deleting a contribution removes its wiki sources.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 sm:px-10 pb-6 sm:pb-10">
                {!uploads || uploads.length === 0 ? (
                  <div className="text-center py-16 text-foreground/40">
                    <History className="w-8 h-8 mx-auto mb-3 opacity-50" />
                    <p className="font-display text-xs uppercase tracking-widest">No contributions yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {uploads.map((upload) => (
                      <div key={upload.id} className="flex items-start gap-4 p-4 rounded-xl border border-border/30 bg-background/30 hover:bg-background/50 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-mono text-xs text-foreground/40">#{upload.id}</span>
                            <Badge variant="outline" className="text-[10px] font-display tracking-widest uppercase border-secondary/30 text-secondary/70">
                              {upload.contentType.replace(/_/g, " ")}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={`text-[10px] font-display tracking-widest uppercase ${
                                upload.status === "processed"
                                  ? "border-green-500/30 text-green-400/70"
                                  : upload.status === "error"
                                  ? "border-destructive/30 text-destructive/70"
                                  : "border-border/30 text-foreground/40"
                              }`}
                            >
                              {upload.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-foreground/80 font-medium truncate">
                            {upload.contributorName ?? "Anonymous"}
                          </p>
                          <p className="text-xs text-foreground/50 mt-0.5">
                            {format(new Date(upload.createdAt), "d MMM yyyy, HH:mm")}
                          </p>
                          {upload.rawText && (
                            <p className="text-xs text-foreground/40 mt-1 line-clamp-2 font-mono">{upload.rawText.slice(0, 120)}…</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteButtonClick(upload.id)}
                          className="text-foreground/30 hover:text-destructive transition-colors p-1 shrink-0 mt-1"
                          title="Delete contribution"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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
                  Time-based Regression
                </CardTitle>
                <CardDescription className="text-sm sm:text-base mt-2 font-light text-foreground/70">
                  Roll back the knowledge base to a chosen date. Wiki pages and contributions created after that date will be permanently removed.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 sm:px-10 pb-6 sm:pb-10 space-y-6">
                <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-foreground/70 flex gap-3">
                  <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-destructive">This action is irreversible.</span> All contributions and wiki pages created after the chosen date will be permanently deleted. Use the preview to review the impact before confirming.
                  </div>
                </div>

                <div className="flex items-end gap-4 flex-wrap">
                  <div className="flex-1 min-w-[220px]">
                    <label className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/70 block mb-2">
                      <Calendar className="w-3 h-3 inline mr-1" />Target Date
                    </label>
                    <Input
                      type="date"
                      value={regressDate}
                      onChange={(e) => { setRegressDate(e.target.value); setRegressPreviewData(null); }}
                      className="bg-background/50 border-border/50 h-12 rounded-xl focus-visible:ring-amber-500/30"
                    />
                  </div>
                  <Button
                    onClick={handleRegressPreview}
                    disabled={regressPreview.isPending || !regressDate}
                    className="font-display uppercase tracking-[0.15em] text-[11px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl h-12 px-6"
                  >
                    {regressPreview.isPending
                      ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Loading…</>
                      : "Preview Impact"}
                  </Button>
                </div>

                {regressPreviewData && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { label: "Wiki Pages Deleted", value: regressPreviewData.wikiPagesRemoved, color: "text-destructive" },
                        { label: "Contributions Deleted", value: regressPreviewData.uploadsRemoved, color: "text-orange-400" },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="rounded-xl border border-border/40 bg-background/40 p-4 text-center">
                          <div className={`text-3xl font-bold font-serif ${color}`}>{value}</div>
                          <div className="text-[10px] font-display uppercase tracking-widest text-foreground/50 mt-1">{label}</div>
                        </div>
                      ))}
                    </div>

                    {regressPreviewData.wikiPagesRemoved === 0 && regressPreviewData.uploadsRemoved === 0 ? (
                      <div className="flex items-center gap-2 text-sm text-foreground/60 rounded-xl border border-border/30 bg-background/30 p-4">
                        <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                        No data found after this date — nothing would be removed.
                      </div>
                    ) : (
                      <Button
                        onClick={() => setRegressConfirmOpen(true)}
                        className="font-display uppercase tracking-[0.15em] text-[11px] bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/30 rounded-xl h-11 px-6"
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-2" />Revert to {regressDate}
                      </Button>
                    )}
                  </div>
                )}
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 mt-2">
                  <h3 className="font-display text-sm tracking-widest uppercase text-destructive mb-2">Wipe All Data</h3>
                  <p className="text-sm text-foreground/70 mb-4 leading-relaxed">
                    Permanently delete every wiki page, contribution upload, and knowledge chunk from the database. This cannot be undone. Use only to clear seed or test data before going live.
                  </p>
                  <Button
                    onClick={() => setWipeConfirmOpen(true)}
                    className="font-display uppercase tracking-[0.15em] text-[11px] bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/30 rounded-xl h-11 px-6"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-2" />Wipe Database
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* BACKUP TAB */}
          <TabsContent value="backup" className="mt-8 outline-none">
            <Card className="border-sky-500/20 shadow-[0_10px_50px_rgba(0,180,255,0.03)] bg-card/40 backdrop-blur-md rounded-2xl overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-sky-500 to-transparent" />
              <CardHeader className="pb-4 sm:pb-8 pt-6 sm:pt-10 px-4 sm:px-10">
                <CardTitle className="font-serif text-xl sm:text-3xl font-bold flex items-center gap-3">
                  <DatabaseBackup className="w-6 h-6 text-sky-400" />
                  Database Backup
                </CardTitle>
                <CardDescription className="text-sm sm:text-base mt-2 font-light text-foreground/70">
                  Manual and automated backups of the knowledge base. Daily automatic backup runs at 02:00 HKT.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 sm:px-10 pb-6 sm:pb-10 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-border/50 bg-background/50 p-6">
                    <div className="text-[10px] font-display uppercase tracking-widest text-foreground/70 mb-2">Last Backup</div>
                    {lastBackup === undefined ? (
                      <div className="w-4 h-4 border border-foreground/30 border-t-transparent rounded-full animate-spin" />
                    ) : lastBackup === null ? (
                      <p className="text-sm text-foreground/50">No backups yet</p>
                    ) : (
                      <>
                        <p className="text-sm font-mono text-foreground/80 truncate">{lastBackup.fileName}</p>
                        <p className="text-xs text-foreground/50 mt-1">{format(new Date(lastBackup.backedUpAt), "d MMM yyyy, HH:mm")}</p>
                      </>
                    )}
                  </div>
                  <div className="rounded-xl border border-border/50 bg-background/50 p-6 flex flex-col justify-between">
                    <div className="text-[10px] font-display uppercase tracking-widest text-foreground/70 mb-3">Run Backup Now</div>
                    <Button
                      onClick={handleBackupNow}
                      disabled={backupRunning}
                      className="font-display uppercase tracking-[0.15em] text-[11px] bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 rounded-xl h-11 px-6"
                    >
                      {backupRunning
                        ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Backing up…</>
                        : <><CloudUpload className="w-3.5 h-3.5 mr-2" />Run Backup</>}
                    </Button>
                  </div>
                </div>

                {backupHistory.length > 0 && (
                  <div className="rounded-xl border border-border/30 bg-background/30 overflow-hidden">
                    <div className="px-5 py-3 border-b border-border/30">
                      <span className="font-display text-[10px] uppercase tracking-widest text-foreground/60">Backup History</span>
                    </div>
                    <div className="divide-y divide-border/20">
                      {backupHistory.slice(0, 10).map((b) => (
                        <div key={b.id} className="px-5 py-3 flex items-center gap-3">
                          <DatabaseBackup className="w-3.5 h-3.5 text-sky-400/60 shrink-0" />
                          <span className="text-xs font-mono text-foreground/60 flex-1 truncate">{b.fileName}</span>
                          <span className="text-xs text-foreground/40 shrink-0">{format(new Date(b.backedUpAt), "d MMM, HH:mm")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
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

          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-foreground/70 flex gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            Wiki pages sourced exclusively from this contribution will be removed. This cannot be undone.
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

      {/* WIPE CONFIRM DIALOG */}
      <Dialog open={wipeConfirmOpen} onOpenChange={setWipeConfirmOpen}>
        <DialogContent className="bg-card border-border/50 rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Wipe Entire Database?</DialogTitle>
            <DialogDescription className="text-foreground/70 mt-2 leading-relaxed">
              This will permanently delete <strong>all</strong> wiki pages, contribution uploads, and knowledge chunks. The backup log is preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-foreground/70 flex gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            This cannot be undone. The database will be completely empty after this operation.
          </div>
          <DialogFooter className="gap-3">
            <Button
              variant="ghost"
              onClick={() => setWipeConfirmOpen(false)}
              className="font-display uppercase tracking-widest text-[11px] text-foreground/60"
            >
              <X className="w-3.5 h-3.5 mr-1" />Cancel
            </Button>
            <Button
              onClick={handleWipe}
              disabled={wiping}
              className="font-display uppercase tracking-widest text-[11px] bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/30 rounded-xl"
            >
              {wiping
                ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Wiping…</>
                : <><Trash2 className="w-3.5 h-3.5 mr-2" />Wipe Everything</>}
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
              You are about to roll back the knowledge base to <span className="font-mono text-foreground/90">{regressDate}</span>.
            </DialogDescription>
          </DialogHeader>
          {regressPreviewData && (
            <div className="grid grid-cols-2 gap-3">
              {[
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
