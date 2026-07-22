import { Router, type IRouter } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { Resend } from "resend";
import { requireAuth } from "../middlewares/auth";
import {
  hashCode,
  generateCode,
  isRateLimited,
  createOtp,
  getOtp,
  incrementAttempts,
  deleteOtp,
  MAX_ATTEMPTS,
} from "../lib/otp-store";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SendSchema = z.object({
  email: z.string().email("Must be a valid email"),
  name: z.string().min(1, "Name is required"),
});

const VerifySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

function getSessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is required");
  return s;
}

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is required");
  return new Resend(key);
}

router.post("/otp/send", requireAuth, async (req, res) => {
  const parse = SendSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Validation failed", details: parse.error.flatten().fieldErrors });
    return;
  }
  const { email, name } = parse.data;

  if (isRateLimited(email)) {
    res.status(429).json({ error: "Too many codes requested. Please wait 15 minutes before trying again." });
    return;
  }

  const code = generateCode();
  const codeHash = hashCode(code);
  createOtp(email, name, codeHash);

  try {
    const resend = getResend();
    await resend.emails.send({
      from: "noreply@humantyze.com",
      to: email,
      subject: "Your verification code",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <h2 style="margin-bottom:8px;color:#111">Contributor Portal</h2>
          <p style="color:#444;margin-bottom:24px">Hi ${name},</p>
          <p style="color:#444;margin-bottom:24px">Your one-time verification code is:</p>
          <div style="font-size:40px;font-weight:700;letter-spacing:12px;text-align:center;padding:24px;background:#f5f5f5;border-radius:8px;color:#111">${code}</div>
          <p style="color:#888;font-size:13px;margin-top:24px">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
        </div>
      `,
    });
    logger.info({ email }, "OTP sent via Resend");
  } catch (err) {
    logger.error({ err, email }, "Failed to send OTP email");
    res.status(500).json({ error: "Failed to send verification email. Please try again." });
    return;
  }

  res.json({ sent: true });
});

router.post("/otp/verify", requireAuth, async (req, res) => {
  const parse = VerifySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { email, code } = parse.data;

  const entry = getOtp(email);
  if (!entry) {
    res.status(400).json({ error: "No pending verification for this email. Please request a new code." });
    return;
  }

  if (Date.now() > entry.expiresAt) {
    deleteOtp(email);
    res.status(400).json({ error: "Code expired. Please request a new one." });
    return;
  }

  const attempts = incrementAttempts(email);
  if (attempts > MAX_ATTEMPTS) {
    deleteOtp(email);
    res.status(400).json({ error: "Too many incorrect attempts. Please request a new code." });
    return;
  }

  const submittedHash = hashCode(code);
  if (submittedHash !== entry.codeHash) {
    const remaining = MAX_ATTEMPTS - attempts;
    res.status(400).json({ error: `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.` });
    return;
  }

  deleteOtp(email);

  const secret = getSessionSecret();
  const token = jwt.sign(
    { email, name: entry.name },
    secret,
    { expiresIn: "1h" },
  );

  logger.info({ email }, "OTP verified, JWT issued");
  res.json({ token });
});

export default router;
