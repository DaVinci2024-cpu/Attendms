// Full local-data export/import — the safety net for an install running
// fully offline (no Firebase connected, see firebaseAdmin.ts): without
// this, a business with no cloud project has no backup at all beyond this
// one machine's disk. Also how to move an existing install onto
// replacement/new hardware, or recover after a wipe.
//
// Deliberately all client-side: reads/writes Dexie directly, no server
// round-trip, so it works with zero internet exactly like the rest of this
// app's offline-first design.
//
// Ported from retailrp/src/lib/backup.ts.
import type { Table } from "dexie";
import { db, SYNCED_TABLES, type SyncedTableName } from "./db";

export const BACKUP_FORMAT_VERSION = 1;

export interface BackupFile {
  formatVersion: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export async function buildBackup(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const name of SYNCED_TABLES) {
    tables[name] = await db[name].toArray();
  }
  return { formatVersion: BACKUP_FORMAT_VERSION, exportedAt: new Date().toISOString(), tables };
}

export async function exportBackup(): Promise<Blob> {
  const backup = await buildBackup();
  return new Blob([JSON.stringify(backup)], { type: "application/json" });
}

// Only checks what's needed to safely proceed — not a full schema
// validator. A real export from this same app always passes; the point is
// catching "wrong kind of file entirely" before anything gets wiped.
export function validateBackupFile(data: unknown): string | null {
  if (!data || typeof data !== "object") return "Not a valid backup file";
  const obj = data as Record<string, unknown>;
  if (typeof obj.formatVersion !== "number") return "This doesn't look like an Attendms backup file";
  if (!obj.tables || typeof obj.tables !== "object") return "Backup file is missing its data";
  const recognized = Object.keys(obj.tables as object).filter((k) =>
    SYNCED_TABLES.includes(k as SyncedTableName)
  );
  if (recognized.length === 0) return "Backup file has no recognizable data in it";
  return null;
}

export async function restoreBackup(backup: BackupFile): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const tablesToTouch = SYNCED_TABLES.map((name) => db[name]);

  await db.transaction("rw", tablesToTouch, async () => {
    for (const name of SYNCED_TABLES) {
      const records = backup.tables[name];
      const table = db[name] as unknown as Table<unknown, string>;
      await table.clear();
      if (Array.isArray(records) && records.length > 0) {
        await table.bulkPut(records);
        counts[name] = records.length;
      } else {
        counts[name] = 0;
      }
    }
  });

  return counts;
}
