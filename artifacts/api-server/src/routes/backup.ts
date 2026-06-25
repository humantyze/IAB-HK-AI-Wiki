import { Router, type IRouter } from "express";
import { requireSuperAuth } from "../middlewares/auth";
import { runBackup, getLastBackup } from "../lib/backup";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/super-admin/backup/status", requireSuperAuth, async (_req, res) => {
  try {
    const last = await getLastBackup();
    res.json({ last });
  } catch (err) {
    logger.error({ err }, "Failed to fetch backup status");
    res.status(500).json({ error: "Failed to fetch backup status" });
  }
});

router.post("/super-admin/backup/run", requireSuperAuth, async (_req, res) => {
  try {
    const result = await runBackup(true);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Backup failed";
    logger.error({ err }, "Manual backup failed");
    res.status(500).json({ error: message });
  }
});

export default router;
