import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const SESSION_COOKIE = "admin_session";
const activeSessions = new Set<string>();

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token && activeSessions.has(token)) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export function setAuthCookie(res: Response): string {
  const token = generateSessionToken();
  activeSessions.add(token);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 24 * 60 * 60 * 1000,
    path: "/",
  });
  return token;
}

export function clearAuthCookie(req: Request, res: Response): void {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    activeSessions.delete(token);
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function isAuthenticated(req: Request): boolean {
  const token = req.cookies?.[SESSION_COOKIE];
  return !!token && activeSessions.has(token);
}
