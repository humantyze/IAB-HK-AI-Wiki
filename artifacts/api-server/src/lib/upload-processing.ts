import { and, asc, eq, lt } from "drizzle-orm";
import { db, uploadsTable, type ProcessingError, type Upload } from "@workspace/db";
import { extractWikiPages, moderateContent } from "./ai-service";
import { indexSource, removeSource } from "./knowledge-index";
import { logger } from "./logger";

export interface ReprocessOutcome {
  id: number;
  status: string;
  wikiPagesCreated: number;
  wikiPagesUpdated: number;
  errors: ProcessingError[];
}

/**
 * Re-drive a single upload from its stored rawText: re-run wiki extraction,
 * decide its final status, then index (eligible) or purge from the index
 * (failed). Idempotent — extraction upserts per slug and indexSource replaces
 * the source's chunks — so it is safe to call from both the admin reprocess
 * endpoint and the crash-recovery sweep.
 */
export async function reprocessUpload(upload: Upload): Promise<ReprocessOutcome> {
  const errors: ProcessingError[] = [];
  let wikiPagesCreated = 0;
  let wikiPagesUpdated = 0;
  let finalStatus = "processed";

  const sourceLabel = upload.contributorName ?? upload.contentType.replace(/_/g, " ");
  const sourceRef = `Upload #${upload.id} — ${upload.contentType.replace(/_/g, " ")}`;
  const uploadTitle = `${upload.contributorName ? `${upload.contributorName} — ` : ""}${upload.contentType.replace(/_/g, " ")}`;

  // ── Content moderation ──────────────────────────────────────────────────────
  let moderationStatus = "clear";
  let moderationReason: string | null = null;

  try {
    logger.info({ uploadId: upload.id }, "Running content moderation during reprocess");
    const modResult = await moderateContent(upload.rawText);
    moderationStatus = modResult.verdict;
    moderationReason = modResult.reason || null;
    logger.info({ uploadId: upload.id, verdict: modResult.verdict }, "Content moderation complete");
  } catch (err) {
    logger.warn({ err, uploadId: upload.id }, "Content moderation threw unexpectedly — defaulting to 'clear'");
  }

  if (moderationStatus === "rejected") {
    errors.push({
      step: "content_moderation",
      message: moderationReason ?? "Content rejected by moderation",
      ts: new Date().toISOString(),
    });
    await db
      .update(uploadsTable)
      .set({
        status: "failed",
        processedAt: new Date(),
        processingErrors: errors,
        moderationStatus: "rejected",
        moderationReason,
      })
      .where(eq(uploadsTable.id, upload.id))
      .catch((dbErr) => logger.error({ dbErr, uploadId: upload.id }, "Failed to write moderation rejection to DB"));

    return { id: upload.id, status: "failed", wikiPagesCreated: 0, wikiPagesUpdated: 0, errors };
  }

  // ── Wiki extraction ──────────────────────────────────────────────────────────
  try {
    const { created, updated } = await extractWikiPages(sourceLabel, upload.rawText, sourceRef, []);
    wikiPagesCreated = created;
    wikiPagesUpdated = updated;

    if (created === 0 && updated === 0) {
      errors.push({
        step: "wiki_extraction",
        message: "AI returned 0 pages from non-empty text during reprocess",
        ts: new Date().toISOString(),
      });
      finalStatus = "failed";
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, uploadId: upload.id }, "Wiki extraction failed during reprocess");
    errors.push({ step: "wiki_extraction", message, ts: new Date().toISOString() });
    finalStatus = "failed";
  }

  // Only index eligible uploads; a failed upload must never leave chunks behind,
  // so pull any existing ones when reprocessing ends in failure.
  if (finalStatus === "failed") {
    try {
      await removeSource("upload", upload.id);
    } catch (err) {
      logger.error({ err, uploadId: upload.id }, "Failed to remove failed upload from index during reprocess");
    }
  } else {
    try {
      await indexSource({
        sourceType: "upload",
        sourceId: upload.id,
        sourceSlug: null,
        title: uploadTitle,
        text: upload.rawText,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, uploadId: upload.id }, "Knowledge indexing failed during reprocess");
      errors.push({ step: "knowledge_indexing", message, ts: new Date().toISOString() });
      finalStatus = finalStatus === "processed" ? "partial" : finalStatus;
    }
  }

  await db
    .update(uploadsTable)
    .set({
      status: finalStatus,
      processedAt: new Date(),
      processingErrors: errors.length > 0 ? errors : null,
      moderationStatus,
      moderationReason,
    })
    .where(eq(uploadsTable.id, upload.id))
    .catch((dbErr) => logger.error({ dbErr, uploadId: upload.id }, "Failed to write reprocess result to DB"));

  return { id: upload.id, status: finalStatus, wikiPagesCreated, wikiPagesUpdated, errors };
}

let sweepRunning = false;

/**
 * Recover uploads stranded in "pending" by a crash/restart that happened during
 * the fire-and-forget finalize window (extract → status → index runs AFTER the
 * 201 response, so a restart mid-flight leaves them pending forever). Only
 * sweeps uploads older than a safety margin so an upload still being processed
 * by a live request isn't double-driven, and self-guards against overlapping
 * runs (startup + cron).
 */
export async function recoverPendingUploads(safetyMs = 2 * 60 * 1000): Promise<{ recovered: number }> {
  if (sweepRunning) return { recovered: 0 };
  sweepRunning = true;
  try {
    const cutoff = new Date(Date.now() - safetyMs);
    const stuck = await db
      .select()
      .from(uploadsTable)
      .where(and(eq(uploadsTable.status, "pending"), lt(uploadsTable.createdAt, cutoff)))
      .orderBy(asc(uploadsTable.id));

    if (stuck.length === 0) return { recovered: 0 };
    logger.warn({ count: stuck.length }, "Recovering uploads stranded in 'pending' after restart");

    let recovered = 0;
    for (const upload of stuck) {
      if (!upload.rawText || upload.rawText.trim().length === 0) {
        // No text was ever stored, so there is nothing to reprocess — mark it
        // failed instead of leaving it pending forever.
        await db
          .update(uploadsTable)
          .set({
            status: "failed",
            processedAt: new Date(),
            processingErrors: [
              { step: "recovery", message: "No stored text to reprocess — marked failed during recovery", ts: new Date().toISOString() },
            ],
          })
          .where(eq(uploadsTable.id, upload.id))
          .catch((dbErr) => logger.error({ dbErr, uploadId: upload.id }, "Failed to mark text-less pending upload failed"));
        continue;
      }
      await reprocessUpload(upload);
      recovered++;
    }

    logger.info({ recovered }, "Pending-upload recovery sweep complete");
    return { recovered };
  } catch (err) {
    logger.error({ err }, "Pending-upload recovery sweep failed");
    return { recovered: 0 };
  } finally {
    sweepRunning = false;
  }
}
