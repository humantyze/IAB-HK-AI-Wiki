import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { google } from "googleapis";
import { db } from "@workspace/db";
import { backupLogTable, wikiPagesTable, uploadsTable, sectionVersionsTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

const DRIVE_FOLDER_ID = "1p8l8LIQpapPyN3x22eNzkvuvYfzCMshH";

/** Fetch an OAuth2 access token from the Replit connector proxy. */
async function getDriveAccessToken(): Promise<string> {
  const connectorsHost = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const connectionId = process.env.GOOGLE_DRIVE_CONNECTION_ID;
  const replIdentity = process.env.REPL_IDENTITY;

  if (!connectorsHost || !connectionId) {
    throw new Error(
      "Google Drive is not connected. Set GOOGLE_DRIVE_CONNECTION_ID after authorising the Google Drive integration.",
    );
  }

  const url = `https://${connectorsHost}/api/v2/connection/${connectionId}/token`;
  const resp = await fetch(url, {
    headers: {
      "X-Replit-Identity": replIdentity ?? "",
    },
  });

  if (!resp.ok) {
    throw new Error(`Connector token fetch failed: ${resp.status} ${await resp.text()}`);
  }

  const body = (await resp.json()) as { access_token?: string; token?: string };
  const token = body.access_token ?? body.token;
  if (!token) throw new Error("Connector returned no access token");
  return token;
}

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
  driveFileId?: undefined;
}

export interface BackupSuccess {
  skipped: false;
  fileName: string;
  driveFileId: string | null;
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

  let driveFileId: string | null = null;
  try {
    const accessToken = await getDriveAccessToken();
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: "v3", auth });

    const fileStream = (await import("fs")).createReadStream(filePath);
    const upload = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [DRIVE_FOLDER_ID],
      },
      media: {
        mimeType: "application/sql",
        body: fileStream,
      },
      fields: "id",
    });
    driveFileId = upload.data.id ?? null;
    logger.info({ driveFileId, fileName }, "Backup uploaded to Google Drive");
  } catch (err) {
    logger.warn({ err }, "Drive upload failed — backup saved locally but not uploaded");
  }

  await db.insert(backupLogTable).values({
    backedUpAt: latestData,
    driveFileId,
    fileName,
  });

  await fs.unlink(filePath).catch(() => {});

  return { skipped: false, fileName, driveFileId };
}

export async function getLastBackup() {
  const [row] = await db
    .select()
    .from(backupLogTable)
    .orderBy(desc(backupLogTable.createdAt))
    .limit(1);
  return row ?? null;
}
