import { useCheckAuth, useLogin, useLogout, getCheckAuthQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

export function useAuth() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const authQuery = useCheckAuth({
    query: { queryKey: getCheckAuthQueryKey(), retry: false, staleTime: 1000 * 60 * 5 }
  });

  const loginMutation = useLogin({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: getCheckAuthQueryKey() });
        await qc.refetchQueries({ queryKey: getCheckAuthQueryKey() });
        setLocation("/admin");
      }
    }
  });

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: getCheckAuthQueryKey() });
        await qc.refetchQueries({ queryKey: getCheckAuthQueryKey() });
        setLocation("/admin/login");
      }
    }
  });

  return {
    isAuthenticated: authQuery.data?.authenticated ?? false,
    isLoading: authQuery.isLoading,
    login: loginMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    isLoggingIn: loginMutation.isPending
  };
}
