import path from "path";
import { fileURLToPath } from "url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import cron from "node-cron";
import app from "./app";
import { db } from "@workspace/db";
import { logger } from "./lib/logger";
import { seedWikiIfEmpty } from "./lib/wiki-seed";
import { runBackup } from "./lib/backup";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const migrationsFolder = path.resolve(__dirname, "../../../lib/db/drizzle");

  logger.info({ migrationsFolder }, "Applying pending database migrations");
  await migrate(db, { migrationsFolder });
  logger.info("Database migrations up to date");

  await new Promise<void>((resolve, reject) => {
    app.listen(port, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

  logger.info({ port }, "Server listening");

  seedWikiIfEmpty().catch((e) => {
    logger.error({ err: e }, "Unexpected error during wiki auto-seed");
  });

  cron.schedule(
    "0 2 * * *",
    async () => {
      logger.info("Daily backup cron: starting");
      try {
        const result = await runBackup(false);
        if (result.skipped) {
          logger.info({ reason: result.reason }, "Daily backup cron: skipped");
        } else {
          logger.info({ fileName: result.fileName, storageObjectPath: result.storageObjectPath }, "Daily backup cron: completed");
        }
      } catch (err) {
        logger.error({ err }, "Daily backup cron: failed");
      }
    },
    { timezone: "Asia/Hong_Kong" },
  );
  logger.info("Daily backup cron scheduled (02:00 HKT)");
}

main().catch((e) => {
  logger.error({ err: e }, "Fatal startup error");
  process.exit(1);
});
