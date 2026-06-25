import { useListUploads } from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";

export function useUploads() {
  return useListUploads();
}

interface AnalyzeData {
  contentType: string;
  rawText?: string;
  file?: File | null;
}

export interface SectionSuggestion {
  slug: string;
  title: string;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export interface AnalysisResult {
  summary: string;
  suggestions: SectionSuggestion[];
  taskList: string[];
}

export function useAnalyzeUpload() {
  return useMutation({
    mutationFn: async (data: AnalyzeData): Promise<AnalysisResult> => {
      const formData = new FormData();
      formData.append("contentType", data.contentType);
      if (data.rawText) formData.append("rawText", data.rawText);
      if (data.file) formData.append("file", data.file);

      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/uploads/analyze`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(err.error || "Analysis failed");
      }
      return res.json() as Promise<AnalysisResult>;
    },
  });
}

interface UploadData {
  uploaderName?: string;
  contributorName?: string;
  contentType: string;
  targetSections: string[];
  rawText?: string;
  file?: File | null;
}

export function useSubmitUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: UploadData) => {
      const formData = new FormData();
      if (data.uploaderName) formData.append("uploaderName", data.uploaderName);
      if (data.contributorName) formData.append("contributorName", data.contributorName);
      formData.append("contentType", data.contentType);
      formData.append("targetSections", JSON.stringify(data.targetSections));
      if (data.rawText) formData.append("rawText", data.rawText);
      if (data.file) formData.append("file", data.file);

      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/uploads`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/uploads"] });
      qc.invalidateQueries({ queryKey: ["/api/sections"] });
    },
  });
}

export interface DeleteUploadResult {
  deleted: boolean;
  sectionsReverted: number;
  versionsDeleted: number;
}

export function useDeleteUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (uploadId: number): Promise<DeleteUploadResult> => {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/uploads/${uploadId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Delete failed" }));
        throw new Error(err.error || "Delete failed");
      }
      return res.json() as Promise<DeleteUploadResult>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/uploads"] });
      qc.invalidateQueries({ queryKey: ["/api/sections"] });
      qc.invalidateQueries({ queryKey: ["/api/wiki"] });
    },
  });
}

export interface RegressPreview {
  sectionsAffected: number;
  wikiPagesRemoved: number;
  uploadsRemoved: number;
  versionsRemoved: number;
}

export function useRegressPreview() {
  return useMutation({
    mutationFn: async (targetDate: string): Promise<RegressPreview> => {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/admin/regress/preview?targetDate=${encodeURIComponent(targetDate)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Preview failed" }));
        throw new Error(err.error || "Preview failed");
      }
      return res.json() as Promise<RegressPreview>;
    },
  });
}

export interface RegressResult {
  sectionsReverted: number;
  versionsDeleted: number;
  wikiPagesDeleted: number;
  uploadsDeleted: number;
}

export function useRegress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (targetDate: string): Promise<RegressResult> => {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/admin/regress`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDate }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Regression failed" }));
        throw new Error(err.error || "Regression failed");
      }
      return res.json() as Promise<RegressResult>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/uploads"] });
      qc.invalidateQueries({ queryKey: ["/api/sections"] });
      qc.invalidateQueries({ queryKey: ["/api/wiki"] });
    },
  });
}
