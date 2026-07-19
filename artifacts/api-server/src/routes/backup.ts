import { Router, type IRouter } from "express";
import { requireSuperAuth } from "../middlewares/auth";
import { runBackup, getBackupHistory, restoreBackup } from "../lib/backup";
import { reindexAll } from "../lib/knowledge-index";
import { logger } from "../lib/logger";
import { db } from "@workspace/db";
import { backupLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateDownloadUrl } from "../lib/gcsClient";

const router: IRouter = Router();

router.get("/super-admin/backup/status", requireSuperAuth, async (_req, res) => {
  try {
    const history = await getBackupHistory(20);
    res.json({ history, last: history[0] ?? null });
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

router.get("/super-admin/backup/download/:id", requireSuperAuth, async (req, res) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid backup ID" });
      return;
    }

    const [row] = await db
      .select()
      .from(backupLogTable)
      .where(eq(backupLogTable.id, id))
      .limit(1);

    if (!row || !row.storageObjectPath) {
      res.status(404).json({ error: "Backup not found" });
      return;
    }

    const signedUrl = await generateDownloadUrl(row.storageObjectPath);
    res.redirect(302, signedUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed";
    logger.error({ err }, "Backup download failed");
    res.status(500).json({ error: message });
  }
});

router.post("/super-admin/backup/restore/:id", requireSuperAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid backup ID" });
    return;
  }

  try {
    logger.info({ backupId: id }, "Restore requested by super-admin");
    const result = await restoreBackup(id);

    setImmediate(() => {
      void reindexAll()
        .then((counts) => logger.info({ backupId: id, counts }, "Knowledge index rebuilt after restore"))
        .catch((err: unknown) => logger.error({ err, backupId: id }, "Knowledge reindex after restore failed"));
    });

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Restore failed";
    logger.error({ err, backupId: id }, "Restore failed");
    res.status(500).json({ error: message });
  }
});

export default router;
