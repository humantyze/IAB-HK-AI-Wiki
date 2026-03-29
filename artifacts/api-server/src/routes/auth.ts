import { Router, type IRouter } from "express";
import { LoginBody } from "@workspace/api-zod";
import { setAuthCookie, clearAuthCookie, isAuthenticated } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/auth/login", (req, res) => {
  const { password } = LoginBody.parse(req.body);
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    res.status(500).json({ error: "ADMIN_PASSWORD not configured" });
    return;
  }

  if (password === adminPassword) {
    setAuthCookie(res);
    res.json({ success: true, message: "Login successful" });
  } else {
    res.status(401).json({ error: "Invalid password" });
  }
});

router.post("/auth/logout", (req, res) => {
  clearAuthCookie(req, res);
  res.json({ success: true, message: "Logged out" });
});

router.get("/auth/me", (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

export default router;
