import { useListUploads } from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";

export function useUploads() {
  return useListUploads();
}

interface UploadData {
  contributorName?: string;
  contentType: string;
  targetSections: string[];
  rawText: string;
  file?: File | null;
}

export function useSubmitUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: UploadData) => {
      const formData = new FormData();
      if (data.contributorName) formData.append("contributorName", data.contributorName);
      formData.append("contentType", data.contentType);
      formData.append("targetSections", JSON.stringify(data.targetSections));
      formData.append("rawText", data.rawText);
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
