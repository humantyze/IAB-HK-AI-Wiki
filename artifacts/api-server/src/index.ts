import cron from "node-cron";
import app from "./app";
import { logger } from "./lib/logger";
import { seedWikiIfEmpty } from "./lib/wiki-seed";
import { indexKnowledgeIfEmpty, cleanupLegacyChunks } from "./lib/knowledge-index";
import { embed } from "./lib/embeddings";
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

  // Remove any knowledge chunks from removed source types (e.g. legacy "section" rows).
  cleanupLegacyChunks().catch((e) => {
    logger.error({ err: e }, "Unexpected error during legacy chunk cleanup");
  });

  seedWikiIfEmpty().catch((e) => {
    logger.error({ err: e }, "Unexpected error during wiki auto-seed");
  });

  // Pre-warm the local embedding model so the first user search doesn't
  // trigger a slow model-load that times out or returns empty results.
  embed("knowledge base pre-warm").then(() => {
    logger.info("Embedding model pre-warmed");
  }).catch((e) => {
    logger.warn({ err: e }, "Embedding model pre-warm failed — first search may be slow");
  });

  // Backfill the semantic knowledge index in the background if it is empty.
  // Runs after wiki auto-seed kicks off so a fresh DB indexes seeded pages too.
  setTimeout(() => {
    indexKnowledgeIfEmpty().catch((e) => {
      logger.error({ err: e }, "Unexpected error during knowledge backfill");
    });
  }, 30_000);

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
