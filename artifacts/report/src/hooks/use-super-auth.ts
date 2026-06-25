import { useState, useEffect } from "react";
import { useLocation } from "wouter";

function getBaseUrl() {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

export function useSuperAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    fetch(`${getBaseUrl()}/api/super-auth/me`, { credentials: "include" })
      .then((r) => r.json())
      .then((d: { authenticated: boolean }) => {
        setIsAuthenticated(d.authenticated);
      })
      .catch(() => setIsAuthenticated(false))
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (password: string) => {
    setIsLoggingIn(true);
    try {
      const res = await fetch(`${getBaseUrl()}/api/super-auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Invalid password");
      setIsAuthenticated(true);
      setLocation("/super-admin");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logout = async () => {
    await fetch(`${getBaseUrl()}/api/super-auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    setIsAuthenticated(false);
    setLocation("/super-admin/login");
  };

  return { isAuthenticated, isLoading, login, logout, isLoggingIn };
}
