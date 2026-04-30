import path from "path";
import { fileURLToPath } from "url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import app from "./app";
import { db } from "@workspace/db";
import { logger } from "./lib/logger";
import { seedWikiIfEmpty } from "./lib/wiki-seed";

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
}

main().catch((e) => {
  logger.error({ err: e }, "Fatal startup error");
  process.exit(1);
});
