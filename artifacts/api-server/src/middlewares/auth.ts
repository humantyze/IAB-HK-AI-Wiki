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

function encrypt(plaintext: string): string {
  const secret = getSecret();
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}.${encrypted}.${authTag}`;
}

function decrypt(ciphertext: string): string | false {
  try {
    const secret = getSecret();
    const key = crypto.createHash("sha256").update(secret).digest();
    const parts = ciphertext.split(".");
    if (parts.length !== 3) return false;
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];
    const authTag = Buffer.from(parts[2], "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return false;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const encryptedToken = req.cookies?.[SESSION_COOKIE];
  if (!encryptedToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = decrypt(encryptedToken);
  if (token === false) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function setAuthCookie(res: Response): void {
  const token = generateSessionToken();
  const encrypted = encrypt(token);
  res.cookie(SESSION_COOKIE, encrypted, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearAuthCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function isAuthenticated(req: Request): boolean {
  const encryptedToken = req.cookies?.[SESSION_COOKIE];
  if (!encryptedToken) return false;
  return decrypt(encryptedToken) !== false;
}
