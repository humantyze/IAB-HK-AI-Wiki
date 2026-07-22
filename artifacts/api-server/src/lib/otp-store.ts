import { createHash, randomInt } from "crypto";

interface OtpEntry {
  name: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

const store = new Map<string, OtpEntry>();
const sendHistory = new Map<string, number[]>();

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
  const now = Date.now();
  const history = sendHistory.get(email) ?? [];
  const recent = history.filter((t) => now - t < RATE_WINDOW_MS);
  return recent.length >= MAX_SENDS;
}

export function recordSend(email: string): void {
  const now = Date.now();
  const history = sendHistory.get(email) ?? [];
  const recent = history.filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  sendHistory.set(email, recent);
}

export function createOtp(email: string, name: string, codeHash: string): void {
  store.set(email, {
    name,
    codeHash,
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
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
