import {
  useListSections,
  useGetSectionBySlug,
  useListSectionVersions,
  getGetSectionBySlugQueryKey,
  getListSectionVersionsQueryKey,
} from "@workspace/api-client-react";
import { useMutation } from "@tanstack/react-query";

export function useSections() {
  return useListSections();
}

export interface DeleteSectionResult {
  deleted: boolean;
  sectionId: number;
  title: string;
  versionsDeleted: number;
}

export function useDeleteSection() {
  return useMutation({
    mutationFn: async (sectionId: number): Promise<DeleteSectionResult> => {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/admin/sections/${sectionId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Delete failed" }));
        throw new Error(err.error || "Delete failed");
      }
      return res.json() as Promise<DeleteSectionResult>;
    },
  });
}

export function useSection(slug: string) {
  return useGetSectionBySlug(slug, {
    query: { queryKey: getGetSectionBySlugQueryKey(slug), enabled: !!slug }
  });
}

export function useSectionVersions(sectionId: number) {
  return useListSectionVersions(sectionId, {
    query: { queryKey: getListSectionVersionsQueryKey(sectionId), enabled: !!sectionId }
  });
}
