import cron from "node-cron";
import app from "./app";
import { logger } from "./lib/logger";
import { ensureIndexUpToDate, cleanupLegacyChunks, ensureWikiSchema } from "./lib/knowledge-index";
import { runBackup } from "./lib/backup";
import { recoverPendingUploads } from "./lib/upload-processing";
import { generateAndStoreQuiz, getStoredQuiz, invalidateStaleQuizCache } from "./lib/quiz-generator";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

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
  // Additively self-heal the wiki_pages schema (body_segments column) BEFORE
  // accepting traffic, so no upload/extraction write can run against a DB that
  // is missing the column.
  try {
    await ensureWikiSchema();
  } catch (e) {
    logger.error({ err: e }, "ensureWikiSchema failed — wiki body-segment tracking may be unavailable");
  }

  // One-time data back-fill: all wiki pages that pre-date the Responsible AI
  // feature launch (2026-07-17) should be flagged responsible_ai = true.
  // This runs on every startup but is a no-op once all legacy rows are updated.
  try {
    const result = await db.execute(
      sql`UPDATE wiki_pages SET responsible_ai = true WHERE responsible_ai = false AND created_at < '2026-07-18'::date`
    );
    const count = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (count > 0) {
      logger.info({ count }, "Responsible AI back-fill: updated legacy wiki pages");
    }
  } catch (e) {
    logger.error({ err: e }, "Responsible AI back-fill failed — some legacy pages may remain un-flagged");
  }

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

  // Rebuild the semantic knowledge index in the background when it is empty OR
  // when the embedding-model / chunking version changed (one-time forced
  // reindex). Runs after wiki auto-seed kicks off so a fresh DB indexes seeded
  // pages too.
  setTimeout(() => {
    ensureIndexUpToDate().catch((e) => {
      logger.error({ err: e }, "Unexpected error during knowledge reindex check");
    });
  }, 30_000);

  // Purge any quiz cache rows that contain upload-derived citations (pre-fix
  // stale data). Must run before the empty-check below so the purge causes
  // the empty-check to schedule a fresh wiki-only generation automatically.
  setTimeout(() => {
    invalidateStaleQuizCache().catch((e) => {
      logger.error({ err: e }, "Unexpected error during stale quiz cache invalidation");
    });
  }, 40_000);

  // Populate the MCQ quiz cache on startup if it is empty (e.g. first deploy
  // after the feature shipped, after a DB wipe, or after stale-cache purge).
  // Runs 45s after boot so the knowledge index check and purge above have had
  // time to settle first.
  setTimeout(() => {
    getStoredQuiz()
      .then((entries) => {
        if (entries.length === 0) {
          logger.info("Quiz cache empty — generating MCQ entries in background");
          return generateAndStoreQuiz();
        }
        logger.info({ count: entries.length }, "Quiz cache already populated — skipping startup generation");
        return;
      })
      .catch((e) => {
        logger.error({ err: e }, "Unexpected error during startup quiz cache check");
      });
  }, 45_000);

  // Recover uploads stranded in "pending" by a crash/restart during the
  // fire-and-forget finalize window. Run shortly after boot, then periodically.
  setTimeout(() => {
    recoverPendingUploads().catch((e) => {
      logger.error({ err: e }, "Unexpected error during pending-upload recovery");
    });
  }, 20_000);
  cron.schedule("*/15 * * * *", () => {
    recoverPendingUploads().catch((e) => {
      logger.error({ err: e }, "Unexpected error during pending-upload recovery cron");
    });
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
