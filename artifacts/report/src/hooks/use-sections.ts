import { useListSections, useGetSectionBySlug, useListSectionVersions } from "@workspace/api-client-react";

export function useSections() {
  return useListSections();
}

export function useSection(slug: string) {
  return useGetSectionBySlug(slug, {
    query: { enabled: !!slug }
  });
}

export function useSectionVersions(sectionId: number) {
  return useListSectionVersions(sectionId, {
    query: { enabled: !!sectionId }
  });
}
