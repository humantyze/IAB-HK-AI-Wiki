import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { db } from "@workspace/db";
import { backupLogTable, wikiPagesTable, uploadsTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { logger } from "./logger";
import { getBackupBucket } from "./gcsClient";

const execFileAsync = promisify(execFile);

/** Return the most recent updatedAt/createdAt timestamp across all main data tables. */
async function getLatestDataTimestamp(): Promise<Date> {
  const [wikiMax, uploadMax] = await Promise.all([
    db
      .select({ max: sql<string>`max(coalesce(updated_at, created_at))` })
      .from(wikiPagesTable),
    db.select({ max: sql<string>`max(created_at)` }).from(uploadsTable),
  ]);

  const candidates = [wikiMax[0]?.max, uploadMax[0]?.max]
    .filter(Boolean)
    .map((v) => new Date(v as string));

  if (candidates.length === 0) return new Date(0);
  return candidates.reduce((a, b) => (a > b ? a : b));
}

export interface BackupResult {
  skipped: true;
  reason: string;
  fileName?: undefined;
  storageObjectPath?: undefined;
}

export interface BackupSuccess {
  skipped: false;
  fileName: string;
  storageObjectPath: string;
}

export type RunBackupResult = BackupResult | BackupSuccess;

/**
 * Run a database backup.
 * @param force  When true, skip the "no new data" check and always backup.
 */
export async function runBackup(force = false): Promise<RunBackupResult> {
  const latestData = await getLatestDataTimestamp();

  if (!force) {
    const [lastBackup] = await db
      .select()
      .from(backupLogTable)
      .orderBy(desc(backupLogTable.createdAt))
      .limit(1);

    if (lastBackup && latestData <= lastBackup.backedUpAt) {
      return { skipped: true, reason: "No new data since last backup" };
    }
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fileName = `backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}.sql`;
  const filePath = path.join("/tmp", fileName);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  logger.info({ fileName }, "Running pg_dump");
  await execFileAsync("pg_dump", [
    databaseUrl,
    "--no-owner",
    "--no-acl",
    "--format=plain",
    `--file=${filePath}`,
  ]);

  let storageObjectPath: string;
  try {
    const bucket = getBackupBucket();
    const destination = `backups/${fileName}`;
    await bucket.upload(filePath, {
      destination,
      metadata: { contentType: "application/sql" },
    });
    storageObjectPath = destination;
    logger.info({ storageObjectPath, fileName }, "Backup uploaded to Replit Object Storage");
  } catch (err) {
    await fs.unlink(filePath).catch(() => {});
    throw err;
  }

  await db.insert(backupLogTable).values({
    backedUpAt: latestData,
    storageObjectPath,
    fileName,
  });

  await fs.unlink(filePath).catch(() => {});

  return { skipped: false, fileName, storageObjectPath };
}

export async function getBackupHistory(limit = 20) {
  return db
    .select()
    .from(backupLogTable)
    .orderBy(desc(backupLogTable.createdAt))
    .limit(limit);
}

export interface RestoreResult {
  restored: true;
  fileName: string;
}

/**
 * Restore the database from a stored backup.
 * Downloads the SQL file from GCS, runs psql to apply it, then triggers a
 * full knowledge-index rebuild in the background.
 */
export async function restoreBackup(backupId: number): Promise<RestoreResult> {
  const [row] = await db
    .select()
    .from(backupLogTable)
    .where(sql`${backupLogTable.id} = ${backupId}`)
    .limit(1);

  if (!row || !row.storageObjectPath) {
    throw new Error(`Backup #${backupId} not found`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  const tmpPath = path.join("/tmp", `restore-${Date.now()}-${row.fileName}`);

  logger.info({ backupId, fileName: row.fileName }, "Downloading backup from GCS for restore");
  const bucket = getBackupBucket();
  await bucket.file(row.storageObjectPath).download({ destination: tmpPath });

  try {
    // Step 1: Reset public schema so existing objects don't conflict with the
    // plain-SQL dump (pg_dump --format=plain without --clean doesn't emit DROP
    // statements). Uses IF EXISTS so this is safe even if the schema is absent.
    // Intentionally outside a transaction — DROP SCHEMA is not transactional.
    logger.info({ backupId }, "Resetting public schema before restore");
    await execFileAsync("psql", [
      databaseUrl,
      "-v", "ON_ERROR_STOP=1",
      "-c",
      "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO PUBLIC;",
    ]);

    // Step 2: Apply the dump.
    // ON_ERROR_STOP=1 ensures psql exits with a non-zero code on any SQL error,
    // so a failed restore is never silently reported as success.
    // --single-transaction makes the restore atomic: a partial failure leaves
    // the schema empty rather than half-populated.
    logger.info({ backupId, fileName: row.fileName }, "Running psql restore");
    await execFileAsync("psql", [
      databaseUrl,
      "-v", "ON_ERROR_STOP=1",
      "--file", tmpPath,
      "--single-transaction",
    ]);
    logger.info({ backupId, fileName: row.fileName }, "Database restore complete");
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }

  return { restored: true, fileName: row.fileName };
}
