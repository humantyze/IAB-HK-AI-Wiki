import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { db } from "@workspace/db";
import { backupLogTable, wikiPagesTable, uploadsTable, sectionVersionsTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { logger } from "./logger";
import { getBackupBucket } from "./gcsClient";

const execFileAsync = promisify(execFile);

/** Return the most recent updatedAt/createdAt timestamp across all main data tables. */
async function getLatestDataTimestamp(): Promise<Date> {
  const [wikiMax, uploadMax, versionMax] = await Promise.all([
    db
      .select({ max: sql<string>`max(coalesce(updated_at, created_at))` })
      .from(wikiPagesTable),
    db.select({ max: sql<string>`max(created_at)` }).from(uploadsTable),
    db.select({ max: sql<string>`max(created_at)` }).from(sectionVersionsTable),
  ]);

  const candidates = [wikiMax[0]?.max, uploadMax[0]?.max, versionMax[0]?.max]
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
