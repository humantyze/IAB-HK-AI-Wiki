import {
  useListSections,
  useGetSectionBySlug,
  useListSectionVersions,
  getGetSectionBySlugQueryKey,
  getListSectionVersionsQueryKey,
} from "@workspace/api-client-react";

export function useSections() {
  return useListSections();
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
