import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const backupLogTable = pgTable("backup_log", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  backedUpAt: timestamp("backed_up_at").notNull(),
  driveFileId: text("drive_file_id"),
  fileName: text("file_name").notNull(),
});

export type BackupLog = typeof backupLogTable.$inferSelect;
export type InsertBackupLog = typeof backupLogTable.$inferInsert;
