import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link, useLocation } from "wouter";
import {
  LogOut, Settings,
  CheckCircle2, BookOpen, AlertCircle,
  Trash2, RotateCcw, Calendar, X, DatabaseBackup, CloudUpload, ImagePlay, Layers,
  ChevronDown, ChevronUp, Sparkles, ImageOff, GitMerge, Search,
} from "lucide-react";

import { useSuperAuth } from "@/hooks/use-super-auth";
import { useUploads, useDeleteUpload, useUploadImpact, useRegressPreview, useRegress, useClearFlag, useRemoveUploadPages, type UploadImpact } from "@/hooks/use-uploads";
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
  const [imageBackfilling, setImageBackfilling] = useState(false);
  const [imageBackfillResult, setImageBackfillResult] = useState<{ pagesUpdated: number; uploadsProcessed: number; message?: string } | null>(null);

  const [synthesizing, setSynthesizing] = useState(false);
  const [synthesizeResult, setSynthesizeResult] = useState<{ created: number } | null>(null);

  const [deletePagesPanelOpen, setDeletePagesPanelOpen] = useState(false);
  const [wikiPageList, setWikiPageList] = useState<Array<{ slug: string; title: string; synthesized: boolean }>>([]);
  const [wikiPageListLoading, setWikiPageListLoading] = useState(false);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [deletingPages, setDeletingPages] = useState(false);
  const [deletePageResult, setDeletePageResult] = useState<{ deleted: number } | null>(null);

  const [regenQuizRunning, setRegenQuizRunning] = useState(false);
  const [regenQuizResult, setRegenQuizResult] = useState<{ count: number } | null>(null);

  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessResult, setReprocessResult] = useState<{ count: number } | null>(null);
  const [reprocessingIds, setReprocessingIds] = useState<Set<number>>(new Set());
  const [singleReprocessResults, setSingleReprocessResults] = useState<Map<number, string>>(new Map());

  const [regenQuestionsRunning, setRegenQuestionsRunning] = useState(false);
  const [regenQuestionsResult, setRegenQuestionsResult] = useState<{ count: number } | null>(null);

  const [regenTitlesRunning, setRegenTitlesRunning] = useState(false);
  const [regenTitlesResult, setRegenTitlesResult] = useState<{ updated: number } | null>(null);

  interface DuplicatePage { id: number; slug: string; title: string; updatedAt: string }
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicatePage[][]>([]);
  const [duplicateScanLoading, setDuplicateScanLoading] = useState(false);
  const [duplicateScanned, setDuplicateScanned] = useState(false);
  const [mergeSelections, setMergeSelections] = useState<Map<number, { keepSlug: string; deleteSlug: string }>>(new Map());
  const [mergeContentFlags, setMergeContentFlags] = useState<Map<number, boolean>>(new Map());
  const [mergingGroups, setMergingGroups] = useState<Set<number>>(new Set());
  const [mergedGroups, setMergedGroups] = useState<Set<number>>(new Set());

  const [clearImageSlug, setClearImageSlug] = useState("");
  const [clearImageRunning, setClearImageRunning] = useState(false);
  const [clearImageResult, setClearImageResult] = useState<{ ok: boolean; title?: string; error?: string } | null>(null);

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
  const [restoreConfirmId, setRestoreConfirmId] = useState<number | null>(null);
  const [restoreAcknowledged, setRestoreAcknowledged] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const deleteUpload = useDeleteUpload();
  const uploadImpact = useUploadImpact();
  const regressPreview = useRegressPreview();
  const regress = useRegress();
  const clearFlag = useClearFlag();
  const removeUploadPages = useRemoveUploadPages();

  const [removePageConfirmId, setRemovePageConfirmId] = useState<number | null>(null);

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<UploadImpact | null>(null);
  const [expandedWikiUploadId, setExpandedWikiUploadId] = useState<number | null>(null);
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

  const handleReprocess = async () => {
    setReprocessing(true);
    setReprocessResult(null);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/admin/reprocess-uploads`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as { count?: number; message?: string; error?: string };
      if (!res.ok) {
        toast({ title: "Reprocess Failed", description: String(data.error ?? "Unknown error"), variant: "destructive" });
      } else {
        const count = data.count ?? 0;
        setReprocessResult({ count });
        toast({
          title: "Reprocess Started",
          description: `${count} upload(s) queued. Wiki pages will appear over the next few minutes.`,
        });
        void refetchUploads();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      toast({ title: "Reprocess Failed", description: message, variant: "destructive" });
    } finally {
      setReprocessing(false);
    }
  };

  const handleReprocessSingle = async (uploadId: number) => {
    setReprocessingIds((prev) => new Set(prev).add(uploadId));
    setSingleReprocessResults((prev) => { const next = new Map(prev); next.delete(uploadId); return next; });
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/admin/reprocess-uploads/${uploadId}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as { status?: string; error?: string };
      if (!res.ok) {
        toast({ title: "Reprocess Failed", description: String(data.error ?? "Unknown error"), variant: "destructive" });
        setSingleReprocessResults((prev) => { const next = new Map(prev); next.set(uploadId, "error"); return next; });
      } else {
        const status = data.status ?? "processed";
        setSingleReprocessResults((prev) => { const next = new Map(prev); next.set(uploadId, status); return next; });
        void refetchUploads();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      toast({ title: "Reprocess Failed", description: message, variant: "destructive" });
      setSingleReprocessResults((prev) => { const next = new Map(prev); next.set(uploadId, "error"); return next; });
    } finally {
      setReprocessingIds((prev) => { const next = new Set(prev); next.delete(uploadId); return next; });
    }
  };

  const handleRegenTitles = async () => {
    setRegenTitlesRunning(true);
    setRegenTitlesResult(null);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/knowledge/regen-titles`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as { updated?: number; error?: string };
      if (!res.ok) {
        toast({ title: "Regeneration Failed", description: String(data.error ?? "Unknown error"), variant: "destructive" });
      } else {
        const updated = data.updated ?? 0;
        setRegenTitlesResult({ updated });
        toast({
          title: "Titles Regenerated",
          description: `${updated} wiki page title${updated !== 1 ? "s" : ""} updated.`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      toast({ title: "Regeneration Failed", description: message, variant: "destructive" });
    } finally {
      setRegenTitlesRunning(false);
    }
  };

  const handleRegenQuestions = async () => {
    setRegenQuestionsRunning(true);
    setRegenQuestionsResult(null);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/knowledge/regen-questions`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as { questions?: string[]; error?: string };
      if (!res.ok) {
        toast({ title: "Regeneration Failed", description: String(data.error ?? "Unknown error"), variant: "destructive" });
      } else {
        const count = data.questions?.length ?? 0;
        setRegenQuestionsResult({ count });
        toast({
          title: "Questions Regenerated",
          description: `${count} sample question${count !== 1 ? "s" : ""} generated from current content.`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      toast({ title: "Regeneration Failed", description: message, variant: "destructive" });
    } finally {
      setRegenQuestionsRunning(false);
    }
  };

  const handleScanDuplicates = async () => {
    setDuplicateScanLoading(true);
    setDuplicateScanned(false);
    setDuplicateGroups([]);
    setMergeSelections(new Map());
    setMergeContentFlags(new Map());
    setMergedGroups(new Set());
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/wiki/duplicates`, { credentials: "include" });
      const data = await res.json() as { groups?: DuplicatePage[][]; error?: string };
      if (!res.ok) {
        toast({ title: "Scan Failed", description: data.error ?? "Unknown error", variant: "destructive" });
      } else {
        const groups = data.groups ?? [];
        setDuplicateGroups(groups);
        setDuplicateScanned(true);
        const initSelections = new Map<number, { keepSlug: string; deleteSlug: string }>();
        const initFlags = new Map<number, boolean>();
        groups.forEach((group, idx) => {
          initSelections.set(idx, { keepSlug: group[0].slug, deleteSlug: group[1].slug });
          initFlags.set(idx, false);
        });
        setMergeSelections(initSelections);
        setMergeContentFlags(initFlags);
        if (groups.length === 0) {
          toast({ title: "No Duplicates Found", description: "All wiki page titles are unique." });
        }
      }
    } catch (err) {
      toast({ title: "Scan Failed", description: err instanceof Error ? err.message : "Request failed", variant: "destructive" });
    } finally {
      setDuplicateScanLoading(false);
    }
  };

  const handleMergeGroup = async (groupIdx: number) => {
    const sel = mergeSelections.get(groupIdx);
    if (!sel) return;
    setMergingGroups((prev) => new Set(prev).add(groupIdx));
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/wiki/merge`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keepSlug: sel.keepSlug,
          deleteSlug: sel.deleteSlug,
          mergeContent: mergeContentFlags.get(groupIdx) ?? false,
        }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) {
        toast({ title: "Merge Failed", description: data.error ?? "Unknown error", variant: "destructive" });
      } else {
        setMergedGroups((prev) => new Set(prev).add(groupIdx));
        fetchWikiCount();
        toast({ title: "Pages Merged", description: `Duplicate removed — kept "${sel.keepSlug}".` });
      }
    } catch (err) {
      toast({ title: "Merge Failed", description: err instanceof Error ? err.message : "Request failed", variant: "destructive" });
    } finally {
      setMergingGroups((prev) => { const next = new Set(prev); next.delete(groupIdx); return next; });
    }
  };

  const handleClearImage = async () => {
    const slug = clearImageSlug.trim();
    if (!slug) return;
    setClearImageRunning(true);
    setClearImageResult(null);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/wiki/${encodeURIComponent(slug)}/image`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json() as { ok?: boolean; title?: string; error?: string };
      if (!res.ok) {
        setClearImageResult({ ok: false, error: data.error ?? "Unknown error" });
        toast({ title: "Clear Failed", description: data.error ?? "Unknown error", variant: "destructive" });
      } else {
        setClearImageResult({ ok: true, title: data.title });
        setClearImageSlug("");
        toast({ title: "Image Cleared", description: `Image removed from "${data.title ?? slug}".` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      setClearImageResult({ ok: false, error: message });
      toast({ title: "Clear Failed", description: message, variant: "destructive" });
    } finally {
      setClearImageRunning(false);
    }
  };

  const handleOpenDeletePanel = async () => {
    setDeletePagesPanelOpen(true);
    setDeletePageResult(null);
    setSelectedSlugs(new Set());
    if (wikiPageList.length > 0) return;
    setWikiPageListLoading(true);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/wiki`, { credentials: "include" });
      const data = await res.json() as Array<{ slug: string; title: string; synthesized?: boolean }>;
      setWikiPageList(data.map((p) => ({ slug: p.slug, title: p.title, synthesized: p.synthesized ?? false })));
    } catch (err) {
      toast({ title: "Failed to load pages", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setWikiPageListLoading(false);
    }
  };

  const handleDeletePages = async () => {
    if (selectedSlugs.size === 0) return;
    setDeletingPages(true);
    setDeletePageResult(null);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/wiki/pages`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs: Array.from(selectedSlugs) }),
      });
      const data = await res.json() as { deleted?: number; error?: string };
      if (!res.ok) {
        toast({ title: "Deletion Failed", description: String(data.error ?? "Unknown error"), variant: "destructive" });
      } else {
        setDeletePageResult({ deleted: data.deleted ?? 0 });
        setWikiPageList((prev) => prev.filter((p) => !selectedSlugs.has(p.slug)));
        setSelectedSlugs(new Set());
        toast({ title: "Pages Deleted", description: `${data.deleted ?? 0} page${(data.deleted ?? 0) !== 1 ? "s" : ""} removed from the knowledge base.` });
      }
    } catch (err) {
      toast({ title: "Deletion Failed", description: err instanceof Error ? err.message : "Request failed", variant: "destructive" });
    } finally {
      setDeletingPages(false);
    }
  };

  const handleRegenQuiz = async () => {
    setRegenQuizRunning(true);
    setRegenQuizResult(null);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/knowledge/regen-quiz`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as { count?: number; error?: string };
      if (!res.ok) {
        toast({ title: "Quiz Regeneration Failed", description: String(data.error ?? "Unknown error"), variant: "destructive" });
      } else {
        const count = data.count ?? 0;
        setRegenQuizResult({ count });
        toast({ title: "Quiz Regenerated", description: `${count} question${count !== 1 ? "s" : ""} ready.` });
      }
    } catch (err) {
      toast({ title: "Quiz Regeneration Failed", description: err instanceof Error ? err.message : "Request failed", variant: "destructive" });
    } finally {
      setRegenQuizRunning(false);
    }
  };

  const handleSynthesizeGaps = async () => {
    setSynthesizing(true);
    setSynthesizeResult(null);
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/wiki/synthesize-gaps`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as { created?: number; error?: string };
      if (!res.ok) {
        toast({ title: "Synthesis Failed", description: String(data.error ?? "Unknown error"), variant: "destructive" });
      } else {
        const created = data.created ?? 0;
        setSynthesizeResult({ created });
        toast({
          title: "Synthesis Complete",
          description: `${created} new gap page${created !== 1 ? "s" : ""} added to the knowledge base.`,
        });
        void refetchUploads();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      toast({ title: "Synthesis Failed", description: message, variant: "destructive" });
    } finally {
      setSynthesizing(false);
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
    return new Date(`${dateStr}T23:59:59.999+08:00`).toISOString();
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
            <Link href="/" className="hidden sm:block text-[11px] font-display uppercase tracking-widest text-foreground/85 hover:text-accent transition-colors">
              View Knowledge Base
            </Link>
            <div className="hidden sm:block w-px h-6 bg-border" />
            <Button variant="ghost" size="sm" onClick={() => logout()} className="text-foreground/85 hover:text-destructive font-display uppercase tracking-widest text-[11px]">
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
                    <CardDescription className="text-sm sm:text-base mt-2 font-light text-foreground/85">
                      Monitor the public Knowledge Base. Wiki pages are created automatically each time a contributor uploads a PDF.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="px-4 sm:px-10 pb-6 sm:pb-10 space-y-4">
                <div className="rounded-xl border border-border/50 bg-background/50 p-6 block">
                  <div className="text-[10px] font-display uppercase tracking-widest text-foreground/85 mb-2">Wiki Pages</div>
                  <div className="text-4xl font-bold font-serif text-green-400">
                    {wikiPageCount === null ? "—" : wikiPageCount}
                  </div>
                  <p className="text-xs text-foreground/85 mt-1">pages in the knowledge base</p>
                </div>

                {/* Ingestion Pipeline Status */}
                {uploads && uploads.length > 0 && (() => {
                  const ingestionUploads = (uploads as Array<{
                    id: number;
                    uploaderName?: string | null;
                    filePath?: string | null;
                    status: string;
                    processingErrors?: Array<{ step: string; message: string; ts: string }>;
                    createdAt: string;
                  }>).filter((u) => u.status === "partial" || u.status === "failed" || u.status === "error");
                  if (ingestionUploads.length === 0) return null;
                  return (
                    <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 col-span-full">
                      <h3 className="font-display text-sm tracking-widest uppercase text-destructive/80 mb-1">Ingestion Pipeline Status</h3>
                      <p className="text-xs text-foreground/90 mb-4">Uploads that encountered errors during processing. Expand each row to see technical details.</p>
                      <div className="space-y-2">
                        {ingestionUploads.map((upload) => {
                          const errors = upload.processingErrors ?? [];
                          const isExpanded = expandedWikiUploadId === upload.id;
                          const statusColor = upload.status === "partial"
                            ? "border-amber-500/30 text-amber-400/70"
                            : "border-destructive/30 text-destructive/70";
                          return (
                            <div key={upload.id} className="rounded-lg border border-border/30 bg-background/30 overflow-hidden">
                              <div className="flex items-center gap-3 px-4 py-3">
                                <span className="font-mono text-xs text-foreground/65">#{upload.id}</span>
                                <Badge variant="outline" className={`text-[10px] font-display tracking-widest uppercase ${statusColor}`}>
                                  {upload.status}
                                </Badge>
                                <span className="text-xs text-foreground/90 truncate flex-1">
                                  {upload.filePath ? upload.filePath.replace(/^\d+-\d+-/, "") : (upload.uploaderName ?? "Text submission")}
                                </span>
                                <span className="text-xs text-foreground/65 shrink-0">
                                  {new Date(upload.createdAt).toLocaleDateString("en-HK", { day: "numeric", month: "short", timeZone: "Asia/Hong_Kong" })}
                                </span>
                                {errors.length > 0 && (
                                  <button
                                    onClick={() => setExpandedWikiUploadId(isExpanded ? null : upload.id)}
                                    className="text-foreground/90 hover:text-amber-400 transition-colors p-1 shrink-0"
                                    title={isExpanded ? "Hide errors" : "Show processing errors"}
                                  >
                                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDeleteButtonClick(upload.id)}
                                  className="text-foreground/90 hover:text-destructive transition-colors p-1 shrink-0"
                                  title="Delete contribution"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                              {errors.length > 0 && isExpanded && (
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
                  );
                })()}

                {uploads && (() => {
                  const flaggedUploads = (uploads as Array<{
                    id: number;
                    uploaderName?: string | null;
                    filePath?: string | null;
                    contentType: string;
                    moderationStatus?: string | null;
                    moderationReason?: string | null;
                    createdAt: string;
                  }>).filter((u) => u.moderationStatus === "flagged");
                  if (flaggedUploads.length === 0) return null;
                  return (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 col-span-full">
                      <h3 className="font-display text-sm tracking-widest uppercase text-amber-400 mb-1">Needs Review</h3>
                      <p className="text-xs text-foreground/90 mb-4">These uploads were flagged by content moderation as potentially borderline. Review the reason and either approve (clear flag) or remove the wiki pages they produced.</p>
                      <div className="space-y-2">
                        {flaggedUploads.map((upload) => (
                          <div key={upload.id} className="rounded-lg border border-amber-500/20 bg-background/30 overflow-hidden">
                            <div className="flex items-start gap-3 px-4 py-3">
                              <span className="font-mono text-xs text-foreground/65 mt-0.5 shrink-0">#{upload.id}</span>
                              <Badge variant="outline" className="text-[10px] font-display tracking-widest uppercase border-amber-500/30 text-amber-400/70 shrink-0 mt-0.5">
                                flagged
                              </Badge>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-foreground/90 truncate">
                                  {upload.filePath ? upload.filePath.replace(/^\d+-\d+-/, "") : (upload.uploaderName ?? "Text submission")}
                                </p>
                                {upload.moderationReason && (
                                  <p className="text-xs text-amber-400/80 mt-1 leading-relaxed line-clamp-2">{upload.moderationReason}</p>
                                )}
                              </div>
                              <span className="text-xs text-foreground/65 shrink-0 mt-0.5">
                                {new Date(upload.createdAt).toLocaleDateString("en-HK", { day: "numeric", month: "short", timeZone: "Asia/Hong_Kong" })}
                              </span>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  onClick={() => {
                                    clearFlag.mutate(upload.id, {
                                      onSuccess: () => toast({ title: "Flag cleared", description: `Upload #${upload.id} approved.` }),
                                      onError: (err) => toast({ title: "Failed to clear flag", description: err.message, variant: "destructive" }),
                                    });
                                  }}
                                  disabled={clearFlag.isPending}
                                  className="text-xs font-display uppercase tracking-widest text-emerald-400/80 hover:text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/40 rounded-lg px-2.5 py-1 transition-colors disabled:opacity-40"
                                  title="Clear flag — mark as approved"
                                >
                                  {clearFlag.isPending ? "…" : "Clear Flag"}
                                </button>
                                <button
                                  onClick={() => setRemovePageConfirmId(upload.id)}
                                  disabled={removeUploadPages.isPending}
                                  className="text-xs font-display uppercase tracking-widest text-destructive/70 hover:text-destructive border border-destructive/20 hover:border-destructive/40 rounded-lg px-2.5 py-1 transition-colors disabled:opacity-40"
                                  title="Remove wiki pages produced by this upload"
                                >
                                  Remove Pages
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-6 col-span-full">
                  <h3 className="font-display text-sm tracking-widest uppercase text-orange-400 mb-2">Reprocess Uploads → Wiki</h3>
                  <p className="text-sm text-foreground/85 mb-4 leading-relaxed">
                    Re-run wiki extraction for individual uploads, or all at once. Use this to regenerate wiki pages after a wipe or if pages were missing. Runs one file at a time (~2 min per upload).
                  </p>

                  {/* Per-upload list */}
                  {uploads && uploads.length > 0 && (
                    <div className="mb-5 space-y-2">
                      {uploads.map((u) => {
                        const eligible = u.rawText && u.rawText.trim().length >= 50;
                        const isRunning = reprocessingIds.has(u.id);
                        const result = singleReprocessResults.get(u.id);
                        const label = u.filePath ?? (u as unknown as { uploaderName?: string | null }).uploaderName ?? u.contentType;
                        return (
                          <div key={u.id} className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-orange-500/10 bg-background/40">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-foreground/90 truncate">{label}</p>
                              <p className="text-[10px] text-foreground/65 mt-0.5">
                                {format(new Date(u.createdAt), "d MMM yyyy")} · {u.status}
                                {!eligible && " · no stored text"}
                              </p>
                            </div>
                            {result === "processed" && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                            )}
                            {result === "partial" && (
                              <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            )}
                            {result === "error" && (
                              <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                            )}
                            <Button
                              size="sm"
                              onClick={() => handleReprocessSingle(u.id)}
                              disabled={!eligible || isRunning || reprocessing}
                              className="shrink-0 font-display uppercase tracking-[0.12em] text-[10px] bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-lg h-7 px-3 transition-all disabled:opacity-40"
                            >
                              {isRunning
                                ? <div className="w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin" />
                                : <RotateCcw className="w-3 h-3" />}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Reprocess all */}
                  {reprocessResult && (
                    <div className="mb-4 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-orange-400" />
                      <span className="text-sm text-foreground/90">
                        <strong>{reprocessResult.count}</strong> upload(s) queued — wiki pages generating in background
                      </span>
                    </div>
                  )}
                  <Button
                    onClick={handleReprocess}
                    disabled={reprocessing || reprocessingIds.size > 0}
                    className="font-display uppercase tracking-[0.15em] text-[11px] bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-xl h-11 px-6 transition-all"
                  >
                    {reprocessing
                      ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Queueing…</>
                      : <><Layers className="w-3.5 h-3.5 mr-2" />Reprocess All</>}
                  </Button>
                </div>

                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-6">
                  <h3 className="font-display text-sm tracking-widest uppercase text-violet-400 mb-2">Backfill Images from PDFs</h3>
                  <p className="text-sm text-foreground/85 mb-4 leading-relaxed">
                    Retroactively extract images from archived PDFs and assign the most relevant image to each wiki page that currently has none. Already-imaged pages are skipped. This may take a few minutes.
                  </p>
                  {imageBackfillResult && (
                    <div className="mb-4 space-y-1">
                      {imageBackfillResult.message ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                          <span className="text-sm text-foreground/90">{imageBackfillResult.message}</span>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-violet-400" />
                            <span className="text-sm text-foreground/90">
                              <strong>{imageBackfillResult.pagesUpdated}</strong> page(s) received images
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <ImagePlay className="w-4 h-4 text-violet-400/60" />
                            <span className="text-sm text-foreground/90">
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

                <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-6">
                  <h3 className="font-display text-sm tracking-widest uppercase text-sky-400 mb-2">Synthesize Gap Pages</h3>
                  <p className="text-sm text-foreground/85 mb-4 leading-relaxed">
                    Use AI to identify cross-cutting themes and frameworks implied across all uploaded content but not yet represented as dedicated wiki pages. Creates 3–8 new synthesized pages per run. Pages are clearly marked as AI-synthesized.
                  </p>
                  {synthesizeResult && (
                    <div className="mb-4 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-sky-400" />
                      <span className="text-sm text-foreground/90">
                        <strong>{synthesizeResult.created}</strong> new gap page{synthesizeResult.created !== 1 ? "s" : ""} added to the knowledge base
                      </span>
                    </div>
                  )}
                  <Button
                    onClick={handleSynthesizeGaps}
                    disabled={synthesizing}
                    className="font-display uppercase tracking-[0.15em] text-[11px] bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 rounded-xl h-11 px-6 transition-all"
                  >
                    {synthesizing
                      ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Synthesizing…</>
                      : <><Sparkles className="w-3.5 h-3.5 mr-2" />Synthesize Gap Pages</>}
                  </Button>
                </div>

                <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-6 col-span-full">
                  <h3 className="font-display text-sm tracking-widest uppercase text-teal-400 mb-2">Find &amp; Merge Duplicate Pages</h3>
                  <p className="text-sm text-foreground/85 mb-4 leading-relaxed">
                    Scan for wiki pages that share a near-identical title (case-insensitive, punctuation-agnostic). For each duplicate group, choose which page to keep and optionally merge the other page's content before deleting it.
                  </p>
                  <Button
                    onClick={handleScanDuplicates}
                    disabled={duplicateScanLoading}
                    className="font-display uppercase tracking-[0.15em] text-[11px] bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/30 rounded-xl h-11 px-6 transition-all mb-5"
                  >
                    {duplicateScanLoading
                      ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Scanning…</>
                      : <><Search className="w-3.5 h-3.5 mr-2" />Scan for Duplicates</>}
                  </Button>

                  {duplicateScanned && duplicateGroups.length === 0 && (
                    <div className="flex items-center gap-2 text-sm text-foreground/90 rounded-xl border border-border/30 bg-background/30 p-4">
                      <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                      No duplicate titles found — all pages are unique.
                    </div>
                  )}

                  {duplicateGroups.length > 0 && (
                    <div className="space-y-4">
                      <p className="text-xs text-teal-400/70 font-display uppercase tracking-widest">
                        {duplicateGroups.filter((_, i) => !mergedGroups.has(i)).length} duplicate group{duplicateGroups.filter((_, i) => !mergedGroups.has(i)).length !== 1 ? "s" : ""} found
                      </p>
                      {duplicateGroups.map((group, groupIdx) => {
                        const alreadyMerged = mergedGroups.has(groupIdx);
                        const isMerging = mergingGroups.has(groupIdx);
                        const sel = mergeSelections.get(groupIdx);
                        const mergeContent = mergeContentFlags.get(groupIdx) ?? false;
                        return (
                          <div key={groupIdx} className={`rounded-xl border p-4 space-y-3 transition-colors ${alreadyMerged ? "border-green-500/20 bg-green-500/5 opacity-60" : "border-teal-500/15 bg-background/40"}`}>
                            {alreadyMerged ? (
                              <div className="flex items-center gap-2 text-sm text-green-400">
                                <CheckCircle2 className="w-4 h-4 shrink-0" />
                                Merged — duplicate removed
                              </div>
                            ) : (
                              <>
                                <p className="text-[10px] font-display uppercase tracking-widest text-foreground/85">Duplicate group {groupIdx + 1} · {group.length} pages</p>
                                <div className="space-y-1.5">
                                  {group.map((page) => {
                                    const isKeep = sel?.keepSlug === page.slug;
                                    const isDelete = sel?.deleteSlug === page.slug;
                                    return (
                                      <div key={page.slug} className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${isKeep ? "border-teal-500/40 bg-teal-500/10" : isDelete ? "border-red-500/30 bg-red-500/5" : "border-border/20 bg-background/20"}`}>
                                        <div className="flex gap-1.5 shrink-0">
                                          <button
                                            onClick={() => {
                                              const others = group.filter((p) => p.slug !== page.slug);
                                              setMergeSelections((prev) => new Map(prev).set(groupIdx, { keepSlug: page.slug, deleteSlug: others[0]?.slug ?? "" }));
                                            }}
                                            title="Keep this page"
                                            className={`text-[10px] font-display uppercase tracking-wide px-2 py-0.5 rounded border transition-colors ${isKeep ? "bg-teal-500/20 border-teal-500/40 text-teal-400" : "border-border/30 text-foreground/90 hover:text-teal-400 hover:border-teal-500/30"}`}
                                          >
                                            Keep
                                          </button>
                                          <button
                                            onClick={() => {
                                              const others = group.filter((p) => p.slug !== page.slug);
                                              setMergeSelections((prev) => new Map(prev).set(groupIdx, { keepSlug: others[0]?.slug ?? "", deleteSlug: page.slug }));
                                            }}
                                            title="Delete this page"
                                            className={`text-[10px] font-display uppercase tracking-wide px-2 py-0.5 rounded border transition-colors ${isDelete ? "bg-red-500/10 border-red-500/30 text-red-400" : "border-border/30 text-foreground/90 hover:text-red-400 hover:border-red-500/30"}`}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs text-foreground/90 truncate">{page.title}</p>
                                          <p className="text-[10px] text-foreground/65 font-mono">{page.slug}</p>
                                        </div>
                                        <span className="text-[10px] text-foreground/90 shrink-0">{new Date(page.updatedAt).toLocaleDateString("en-HK", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Hong_Kong" })}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                                <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
                                  <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={mergeContent}
                                      onChange={(e) => setMergeContentFlags((prev) => new Map(prev).set(groupIdx, e.target.checked))}
                                      className="accent-teal-500 w-3.5 h-3.5"
                                    />
                                    <span className="text-xs text-foreground/90">Merge deleted page's content into kept page</span>
                                  </label>
                                  <Button
                                    onClick={() => handleMergeGroup(groupIdx)}
                                    disabled={isMerging || !sel?.keepSlug || !sel?.deleteSlug}
                                    className="font-display uppercase tracking-[0.12em] text-[10px] bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/30 rounded-lg h-8 px-4 transition-all"
                                  >
                                    {isMerging
                                      ? <><div className="w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin mr-1.5" />Merging…</>
                                      : <><GitMerge className="w-3 h-3 mr-1.5" />{mergeContent ? "Merge & Delete" : "Delete Duplicate"}</>}
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 col-span-full">
                  <h3 className="font-display text-sm tracking-widest uppercase text-red-400 mb-2">Delete Wiki Pages</h3>
                  <p className="text-sm text-foreground/85 mb-4 leading-relaxed">
                    Permanently remove individual wiki pages and their knowledge index entries. This cannot be undone.
                  </p>
                  {deletePageResult && (
                    <div className="mb-4 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-red-400" />
                      <span className="text-sm text-foreground/90"><strong>{deletePageResult.deleted}</strong> page{deletePageResult.deleted !== 1 ? "s" : ""} permanently deleted</span>
                    </div>
                  )}
                  {!deletePagesPanelOpen ? (
                    <Button
                      onClick={handleOpenDeletePanel}
                      className="font-display uppercase tracking-[0.15em] text-[11px] bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl h-11 px-6 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" />Select Pages to Delete
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-foreground/85">
                          {wikiPageListLoading ? "Loading pages…" : `${wikiPageList.length} pages · ${selectedSlugs.size} selected`}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setSelectedSlugs(selectedSlugs.size === wikiPageList.length ? new Set() : new Set(wikiPageList.map((p) => p.slug)))}
                            className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
                          >
                            {selectedSlugs.size === wikiPageList.length ? "Deselect all" : "Select all"}
                          </button>
                          <button
                            onClick={() => { setDeletePagesPanelOpen(false); setSelectedSlugs(new Set()); }}
                            className="text-foreground/65 hover:text-foreground/70 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      {wikiPageListLoading ? (
                        <div className="flex items-center gap-2 text-foreground/65 text-sm py-4">
                          <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />Loading…
                        </div>
                      ) : (
                        <div className="max-h-64 overflow-y-auto rounded-lg border border-border/30 divide-y divide-border/20">
                          {wikiPageList.map((page) => (
                            <label key={page.slug} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-red-500/5 transition-colors">
                              <input
                                type="checkbox"
                                checked={selectedSlugs.has(page.slug)}
                                onChange={(e) => {
                                  const next = new Set(selectedSlugs);
                                  if (e.target.checked) next.add(page.slug); else next.delete(page.slug);
                                  setSelectedSlugs(next);
                                }}
                                className="accent-red-500 w-3.5 h-3.5 shrink-0"
                              />
                              <span className="text-xs text-foreground/90 leading-snug flex-1 min-w-0">
                                {page.synthesized && <span className="text-sky-400 mr-1">✦</span>}{page.title}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                      <Button
                        onClick={handleDeletePages}
                        disabled={deletingPages || selectedSlugs.size === 0}
                        className="font-display uppercase tracking-[0.15em] text-[11px] bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl h-11 px-6 transition-all"
                      >
                        {deletingPages
                          ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Deleting…</>
                          : <><Trash2 className="w-3.5 h-3.5 mr-2" />Delete {selectedSlugs.size > 0 ? `${selectedSlugs.size} ` : ""}Page{selectedSlugs.size !== 1 ? "s" : ""}</>}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-6">
                  <h3 className="font-display text-sm tracking-widest uppercase text-indigo-400 mb-2">Regenerate Wiki Titles</h3>
                  <p className="text-sm text-foreground/85 mb-4 leading-relaxed">
                    Re-titles all existing wiki pages using the improved naming rules — concept-focused noun phrases that stand alone without the source document name. Runs AI on every page in batches; takes 1–2 minutes.
                  </p>
                  {regenTitlesResult && (
                    <div className="mb-4 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-indigo-400" />
                      <span className="text-sm text-foreground/90">
                        <strong>{regenTitlesResult.updated}</strong> page title{regenTitlesResult.updated !== 1 ? "s" : ""} updated
                      </span>
                    </div>
                  )}
                  <Button
                    onClick={handleRegenTitles}
                    disabled={regenTitlesRunning}
                    className="font-display uppercase tracking-[0.15em] text-[11px] bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded-xl h-11 px-6 transition-all"
                  >
                    {regenTitlesRunning
                      ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Regenerating…</>
                      : <><Sparkles className="w-3.5 h-3.5 mr-2" />Regenerate Titles</>}
                  </Button>
                </div>

                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-6">
                  <h3 className="font-display text-sm tracking-widest uppercase text-cyan-400 mb-2">Regenerate Sample Questions</h3>
                  <p className="text-sm text-foreground/85 mb-4 leading-relaxed">
                    Generate 10 sample questions from current wiki content, scored against the knowledge index so only questions with rich answers are shown. Runs automatically after every upload.
                  </p>
                  {regenQuestionsResult && (
                    <div className="mb-4 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                      <span className="text-sm text-foreground/90">
                        <strong>{regenQuestionsResult.count}</strong> question{regenQuestionsResult.count !== 1 ? "s" : ""} generated and live
                      </span>
                    </div>
                  )}
                  <Button
                    onClick={handleRegenQuestions}
                    disabled={regenQuestionsRunning}
                    className="font-display uppercase tracking-[0.15em] text-[11px] bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-xl h-11 px-6 transition-all"
                  >
                    {regenQuestionsRunning
                      ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Generating…</>
                      : <><Sparkles className="w-3.5 h-3.5 mr-2" />Regenerate Questions</>}
                  </Button>
                </div>

                <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-6">
                  <h3 className="font-display text-sm tracking-widest uppercase text-teal-400 mb-2">Regenerate Quiz Cache</h3>
                  <p className="text-sm text-foreground/85 mb-4 leading-relaxed">
                    Rebuild the multiple-choice quiz from current sample questions and wiki content. Runs automatically after questions are regenerated. Use this to force a refresh after prompt changes or manual edits.
                  </p>
                  {regenQuizResult && (
                    <div className="mb-4 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-teal-400" />
                      <span className="text-sm text-foreground/90">
                        <strong>{regenQuizResult.count}</strong> question{regenQuizResult.count !== 1 ? "s" : ""} generated and live
                      </span>
                    </div>
                  )}
                  <Button
                    onClick={handleRegenQuiz}
                    disabled={regenQuizRunning}
                    className="font-display uppercase tracking-[0.15em] text-[11px] bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/30 rounded-xl h-11 px-6 transition-all"
                  >
                    {regenQuizRunning
                      ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Generating…</>
                      : <><Sparkles className="w-3.5 h-3.5 mr-2" />Regenerate Quiz</>}
                  </Button>
                </div>

                <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-6">
                  <h3 className="font-display text-sm tracking-widest uppercase text-rose-400 mb-2">Clear Page Image</h3>
                  <p className="text-sm text-foreground/85 mb-4 leading-relaxed">
                    Remove the header image from a specific wiki page. Paste the page slug from its URL (the part after <span className="font-mono text-xs">/wiki/</span>).
                  </p>
                  {clearImageResult && (
                    <div className="mb-4 flex items-center gap-2">
                      {clearImageResult.ok
                        ? <><CheckCircle2 className="w-4 h-4 text-rose-400" /><span className="text-sm text-foreground/90">Image cleared from <strong>{clearImageResult.title}</strong></span></>
                        : <><AlertCircle className="w-4 h-4 text-destructive" /><span className="text-sm text-foreground/90">{clearImageResult.error}</span></>
                      }
                    </div>
                  )}
                  <div className="flex gap-3 flex-wrap">
                    <Input
                      value={clearImageSlug}
                      onChange={(e) => { setClearImageSlug(e.target.value); setClearImageResult(null); }}
                      placeholder="iab-ai-intellectual-property-and-transactions-playbook-2025"
                      className="flex-1 min-w-[260px] bg-background/50 border-border/50 h-11 rounded-xl focus-visible:ring-rose-500/30 font-mono text-xs"
                    />
                    <Button
                      onClick={handleClearImage}
                      disabled={clearImageRunning || !clearImageSlug.trim()}
                      className="font-display uppercase tracking-[0.15em] text-[11px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl h-11 px-6 transition-all shrink-0"
                    >
                      {clearImageRunning
                        ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Clearing…</>
                        : <><ImageOff className="w-3.5 h-3.5 mr-2" />Clear Image</>}
                    </Button>
                  </div>
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
                  Time-based Regression
                </CardTitle>
                <CardDescription className="text-sm sm:text-base mt-2 font-light text-foreground/85">
                  Roll back the knowledge base to a chosen date. Wiki pages and contributions created after that date will be permanently removed.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 sm:px-10 pb-6 sm:pb-10 space-y-6">
                <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-foreground/85 flex gap-3">
                  <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-destructive">This action is irreversible.</span> All contributions and wiki pages created after the chosen date will be permanently deleted. Use the preview to review the impact before confirming.
                  </div>
                </div>

                <div className="flex items-end gap-4 flex-wrap">
                  <div className="flex-1 min-w-[220px]">
                    <label className="font-display tracking-[0.2em] uppercase text-[10px] text-foreground/85 block mb-2">
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
                          <div className="text-[10px] font-display uppercase tracking-widest text-foreground/85 mt-1">{label}</div>
                        </div>
                      ))}
                    </div>

                    {regressPreviewData.wikiPagesRemoved === 0 && regressPreviewData.uploadsRemoved === 0 ? (
                      <div className="flex items-center gap-2 text-sm text-foreground/90 rounded-xl border border-border/30 bg-background/30 p-4">
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
                  <p className="text-sm text-foreground/85 mb-4 leading-relaxed">
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
                <CardDescription className="text-sm sm:text-base mt-2 font-light text-foreground/85">
                  Manual and automated backups of the knowledge base. Daily automatic backup runs at 02:00 HKT.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 sm:px-10 pb-6 sm:pb-10 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-border/50 bg-background/50 p-6">
                    <div className="text-[10px] font-display uppercase tracking-widest text-foreground/85 mb-2">Last Backup</div>
                    {lastBackup === undefined ? (
                      <div className="w-4 h-4 border border-foreground/30 border-t-transparent rounded-full animate-spin" />
                    ) : lastBackup === null ? (
                      <p className="text-sm text-foreground/85">No backups yet</p>
                    ) : (
                      <>
                        <p className="text-sm font-mono text-foreground/90 truncate">{lastBackup.fileName}</p>
                        <p className="text-xs text-foreground/85 mt-1">{format(new Date(lastBackup.backedUpAt), "d MMM yyyy, HH:mm")}</p>
                      </>
                    )}
                  </div>
                  <div className="rounded-xl border border-border/50 bg-background/50 p-6 flex flex-col justify-between">
                    <div className="text-[10px] font-display uppercase tracking-widest text-foreground/85 mb-3">Run Backup Now</div>
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
                      <span className="font-display text-[10px] uppercase tracking-widest text-foreground/90">Backup History</span>
                    </div>
                    <div className="divide-y divide-border/20">
                      {backupHistory.slice(0, 10).map((b) => (
                        <div key={b.id} className="px-5 py-3 flex items-center gap-3">
                          <DatabaseBackup className="w-3.5 h-3.5 text-sky-400/60 shrink-0" />
                          <span className="text-xs font-mono text-foreground/90 flex-1 truncate">{b.fileName}</span>
                          <span className="text-xs text-foreground/65 shrink-0">{format(new Date(b.backedUpAt), "d MMM, HH:mm")}</span>
                          <a
                            href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/super-admin/backup/download/${b.id}`}
                            className="text-[10px] font-display uppercase tracking-widest text-sky-400/70 hover:text-sky-400 border border-sky-500/20 hover:border-sky-500/40 rounded-lg px-2 py-1 transition-colors shrink-0"
                          >
                            Download
                          </a>
                          <button
                            onClick={() => { setRestoreConfirmId(b.id); setRestoreError(null); setRestoreAcknowledged(false); }}
                            className="text-[10px] font-display uppercase tracking-widest text-amber-400/70 hover:text-amber-400 border border-amber-500/20 hover:border-amber-500/40 rounded-lg px-2 py-1 transition-colors shrink-0"
                          >
                            Restore
                          </button>
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

      {/* RESTORE BLOCKING OVERLAY */}
      {restoring && (
        <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
          <div className="w-10 h-10 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <p className="font-display uppercase tracking-widest text-sm text-amber-400">Restoring database…</p>
          <p className="text-xs text-foreground/65 max-w-xs text-center">This includes rebuilding the knowledge index and may take up to 2 minutes. Do not close the page.</p>
        </div>
      )}

      {/* RESTORE CONFIRM DIALOG */}
      {(() => {
        const restoreTarget = restoreConfirmId !== null ? backupHistory.find((b) => b.id === restoreConfirmId) : null;
        return (
          <Dialog open={restoreConfirmId !== null} onOpenChange={(open) => { if (!open && !restoring) { setRestoreConfirmId(null); setRestoreError(null); setRestoreAcknowledged(false); } }}>
            <DialogContent className="bg-card border-border/50 rounded-2xl max-w-md">
              <DialogHeader>
                <DialogTitle className="font-serif text-xl">Restore from Backup?</DialogTitle>
                <DialogDescription className="text-foreground/85 mt-2 leading-relaxed">
                  {restoreTarget ? (
                    <>Restore to <span className="font-mono text-foreground/90">{restoreTarget.fileName}</span> ({format(new Date(restoreTarget.backedUpAt), "d MMM yyyy, HH:mm")}).</>
                  ) : "Restore this backup."}
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-foreground/85 flex gap-2 leading-relaxed">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>This will <strong>permanently replace all current data</strong> — every wiki page, upload record, and knowledge chunk will be overwritten with the backup's contents. The knowledge index will be rebuilt in the background afterwards. This cannot be undone.</span>
              </div>
              <label className="flex items-start gap-3 cursor-pointer select-none rounded-xl border border-border/30 bg-background/40 p-3 hover:bg-background/60 transition-colors">
                <input
                  type="checkbox"
                  checked={restoreAcknowledged}
                  onChange={(e) => setRestoreAcknowledged(e.target.checked)}
                  disabled={restoring}
                  className="mt-0.5 accent-amber-500 w-4 h-4 shrink-0"
                />
                <span className="text-xs text-foreground/80 leading-relaxed">
                  I understand that all current data will be <strong>permanently overwritten</strong> and this action cannot be undone.
                </span>
              </label>
              {restoreError && (
                <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive flex gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {restoreError}
                </div>
              )}
              <DialogFooter className="gap-3">
                <Button
                  variant="ghost"
                  onClick={() => { setRestoreConfirmId(null); setRestoreError(null); setRestoreAcknowledged(false); }}
                  disabled={restoring}
                  className="font-display uppercase tracking-widest text-[11px] text-foreground/90"
                >
                  <X className="w-3.5 h-3.5 mr-1" />Cancel
                </Button>
                <Button
                  disabled={restoring || restoreConfirmId === null || !restoreAcknowledged}
                  onClick={async () => {
                    if (restoreConfirmId === null) return;
                    setRestoring(true);
                    setRestoreError(null);
                    try {
                      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
                      const res = await fetch(`${baseUrl}/api/super-admin/backup/restore/${restoreConfirmId}`, {
                        method: "POST",
                        credentials: "include",
                      });
                      if (!res.ok) {
                        const body = await res.json().catch(() => ({})) as { error?: string };
                        throw new Error(body.error ?? "Restore failed");
                      }
                      window.location.reload();
                    } catch (err) {
                      setRestoreError(err instanceof Error ? err.message : "Restore failed");
                      setRestoring(false);
                    }
                  }}
                  className="font-display uppercase tracking-[0.15em] text-[11px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl"
                >
                  {restoring
                    ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Restoring…</>
                    : <><RotateCcw className="w-3.5 h-3.5 mr-2" />Restore Database</>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* DELETE CONTRIBUTION DIALOG */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={(open) => { if (!open) { setDeleteConfirmId(null); setDeleteImpact(null); } }}>
        <DialogContent className="bg-card border-border/50 rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Delete Contribution?</DialogTitle>
            <DialogDescription className="text-foreground/85 mt-2 leading-relaxed">
              Permanently remove contribution <span className="font-mono text-foreground/90">#{deleteTarget?.id}</span>
              {deleteTarget && (
                <> ({deleteTarget.contentType.replace(/_/g, " ")} by {deleteTarget.contributorName || "Anonymous"})</>
              )}.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-foreground/85 flex gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            Wiki pages sourced exclusively from this contribution will be removed. This cannot be undone.
          </div>
          <DialogFooter className="gap-3">
            <Button
              variant="ghost"
              onClick={() => { setDeleteConfirmId(null); setDeleteImpact(null); }}
              className="font-display uppercase tracking-widest text-[11px] text-foreground/90"
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
            <DialogDescription className="text-foreground/85 mt-2 leading-relaxed">
              This will permanently delete <strong>all</strong> wiki pages, contribution uploads, and knowledge chunks. The backup log is preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-foreground/85 flex gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            This cannot be undone. The database will be completely empty after this operation.
          </div>
          <DialogFooter className="gap-3">
            <Button
              variant="ghost"
              onClick={() => setWipeConfirmOpen(false)}
              className="font-display uppercase tracking-widest text-[11px] text-foreground/90"
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

      {/* REMOVE PAGES CONFIRM DIALOG */}
      <Dialog open={removePageConfirmId !== null} onOpenChange={(open) => { if (!open) setRemovePageConfirmId(null); }}>
        <DialogContent className="bg-card border-border/50 rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Remove Wiki Pages?</DialogTitle>
            <DialogDescription className="text-foreground/85 mt-2 leading-relaxed">
              This will delete all wiki pages produced by Upload #{removePageConfirmId}. The upload record will remain so you have an audit trail. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3">
            <Button
              variant="ghost"
              onClick={() => setRemovePageConfirmId(null)}
              className="font-display uppercase tracking-widest text-[11px] text-foreground/90"
            >
              <X className="w-3.5 h-3.5 mr-1" />Cancel
            </Button>
            <Button
              disabled={removeUploadPages.isPending}
              onClick={() => {
                if (removePageConfirmId === null) return;
                const id = removePageConfirmId;
                removeUploadPages.mutate(id, {
                  onSuccess: (result) => {
                    setRemovePageConfirmId(null);
                    toast({ title: "Pages removed", description: `${result.wikiPagesDeleted} page(s) deleted, ${result.wikiPagesUpdated} updated.` });
                  },
                  onError: (err) => {
                    setRemovePageConfirmId(null);
                    toast({ title: "Failed to remove pages", description: err.message, variant: "destructive" });
                  },
                });
              }}
              className="font-display uppercase tracking-widest text-[11px] bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/30 rounded-xl"
            >
              {removeUploadPages.isPending
                ? <><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2" />Removing…</>
                : <><Trash2 className="w-3.5 h-3.5 mr-2" />Remove Pages</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REGRESS CONFIRM DIALOG */}
      <Dialog open={regressConfirmOpen} onOpenChange={setRegressConfirmOpen}>
        <DialogContent className="bg-card border-border/50 rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Confirm Regression</DialogTitle>
            <DialogDescription className="text-foreground/85 mt-2 leading-relaxed">
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
                  <div className="text-[9px] font-display uppercase tracking-widest text-foreground/85 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-foreground/85 flex gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            This cannot be undone. All affected data will be permanently deleted.
          </div>
          <DialogFooter className="gap-3">
            <Button
              variant="ghost"
              onClick={() => setRegressConfirmOpen(false)}
              className="font-display uppercase tracking-widest text-[11px] text-foreground/90"
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
