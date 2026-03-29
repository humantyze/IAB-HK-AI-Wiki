import { useListUploads, useCreateUpload } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export function useUploads() {
  return useListUploads();
}

export function useSubmitUpload() {
  const qc = useQueryClient();
  return useCreateUpload({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/api/uploads"] });
        qc.invalidateQueries({ queryKey: ["/api/sections"] });
      }
    }
  });
}
