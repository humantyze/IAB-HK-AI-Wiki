import { Router, type IRouter } from "express";
import { LoginBody } from "@workspace/api-zod";
import { setSuperAuthCookie, clearSuperAuthCookie, isSuperAuthenticated } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/super-auth/login", (req, res) => {
  const { password } = LoginBody.parse(req.body);
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD;

  if (!superAdminPassword) {
    res.status(500).json({ error: "SUPER_ADMIN_PASSWORD not configured" });
    return;
  }

  if (password === superAdminPassword) {
    setSuperAuthCookie(res);
    res.json({ success: true, message: "Login successful" });
  } else {
    res.status(401).json({ error: "Invalid password" });
  }
});

router.post("/super-auth/logout", (req, res) => {
  clearSuperAuthCookie(req, res);
  res.json({ success: true, message: "Logged out" });
});

router.get("/super-auth/me", (req, res) => {
  res.json({ authenticated: isSuperAuthenticated(req) });
});

export default router;
