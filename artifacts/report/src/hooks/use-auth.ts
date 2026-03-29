import { useCheckAuth, useLogin, useLogout } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

export function useAuth() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const authQuery = useCheckAuth({
    query: { retry: false, staleTime: 1000 * 60 * 5 }
  });

  const loginMutation = useLogin({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
        setLocation("/admin");
      }
    }
  });

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
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
