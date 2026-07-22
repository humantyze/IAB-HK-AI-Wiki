import { createHash, randomInt } from "crypto";

interface OtpEntry {
  name: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  sentAt: number[];
}

const store = new Map<string, OtpEntry>();

const OTP_TTL_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS = 3;
const MAX_ATTEMPTS = 5;

export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function generateCode(): string {
  return String(randomInt(100000, 999999));
}

export function isRateLimited(email: string): boolean {
  const entry = store.get(email);
  if (!entry) return false;
  const now = Date.now();
  const recent = entry.sentAt.filter((t) => now - t < RATE_WINDOW_MS);
  return recent.length >= MAX_SENDS;
}

export function createOtp(email: string, name: string, codeHash: string): void {
  const now = Date.now();
  const existing = store.get(email);
  const recentSends = existing
    ? existing.sentAt.filter((t) => now - t < RATE_WINDOW_MS)
    : [];
  store.set(email, {
    name,
    codeHash,
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    sentAt: [...recentSends, now],
  });
}

export function getOtp(email: string): OtpEntry | undefined {
  return store.get(email);
}

export function incrementAttempts(email: string): number {
  const entry = store.get(email);
  if (!entry) return MAX_ATTEMPTS + 1;
  entry.attempts += 1;
  store.set(email, entry);
  return entry.attempts;
}

export function deleteOtp(email: string): void {
  store.delete(email);
}

export { MAX_ATTEMPTS };
