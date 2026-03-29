import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const SESSION_COOKIE = "admin_session";

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is required");
  }
  return secret;
}

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function signToken(token: string): string {
  const hmac = crypto.createHmac("sha256", getSecret());
  hmac.update(token);
  const signature = hmac.digest("base64url");
  return `${token}.${signature}`;
}

function verifyToken(signedValue: string): string | false {
  const dotIndex = signedValue.lastIndexOf(".");
  if (dotIndex === -1) return false;
  const token = signedValue.slice(0, dotIndex);
  const signature = signedValue.slice(dotIndex + 1);
  const hmac = crypto.createHmac("sha256", getSecret());
  hmac.update(token);
  const expected = hmac.digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return false;
  }
  return token;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const signedToken = req.cookies?.[SESSION_COOKIE];
  if (!signedToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = verifyToken(signedToken);
  if (token === false) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function setAuthCookie(res: Response): void {
  const token = generateSessionToken();
  const signed = signToken(token);
  res.cookie(SESSION_COOKIE, signed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearAuthCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function isAuthenticated(req: Request): boolean {
  const signedToken = req.cookies?.[SESSION_COOKIE];
  if (!signedToken) return false;
  return verifyToken(signedToken) !== false;
}
