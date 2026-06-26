import { useListUploads } from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";

export function useUploads() {
  return useListUploads();
}

interface UploadData {
  uploaderName: string;
  uploaderEmail: string;
  contributorName?: string;
  contentType: string;
  rawText?: string;
  files?: File[];
}

export class UploadError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly uploadId: number | null = null,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export function useSubmitUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: UploadData): Promise<{ id: number; status: string; [key: string]: unknown }> => {
      const formData = new FormData();
      formData.append("uploaderName", data.uploaderName);
      formData.append("uploaderEmail", data.uploaderEmail);
      if (data.contributorName) formData.append("contributorName", data.contributorName);
      formData.append("contentType", data.contentType);
      if (data.rawText) formData.append("rawText", data.rawText);
      if (data.files) {
        for (const f of data.files) {
          formData.append("files", f);
        }
      }

      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/uploads`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        const hasErrorCode = typeof body.errorCode === "string";
        if ((res.status === 422 || res.status === 400) && hasErrorCode) {
          throw new UploadError(
            body.errorCode as string,
            typeof body.message === "string" ? body.message : "Upload processing failed",
            typeof body.uploadId === "number" ? body.uploadId : null,
          );
        }
        throw new Error(typeof body.error === "string" ? body.error : "Upload failed");
      }
      return res.json() as Promise<{ id: number; status: string; [key: string]: unknown }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/uploads"] });
    },
  });
}

export interface UploadImpact {
  sectionsReverted: number;
  versionsDeleted: number;
  sectionsRevertedList: Array<{ slug: string; title: string }>;
}

export function useUploadImpact() {
  return useMutation({
    mutationFn: async (uploadId: number): Promise<UploadImpact> => {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/uploads/${uploadId}/impact`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Impact check failed" }));
        throw new Error(err.error || "Impact check failed");
      }
      return res.json() as Promise<UploadImpact>;
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
      qc.invalidateQueries({ queryKey: ["/api/wiki"] });
    },
  });
}

export interface RegressPreview {
  wikiPagesRemoved: number;
  uploadsRemoved: number;
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
      qc.invalidateQueries({ queryKey: ["/api/wiki"] });
    },
  });
}
