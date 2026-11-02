// A small durable local cache, independent of Firestore, that lets this
// machine exchange data directly with other Attendms machines on the same
// WiFi/Ethernet — entirely offline, no internet involved at any point. It's
// the backing store for /api/lan/* (see lanDiscovery.ts and the lan API
// routes). Populated by this same device's own browser/renderer pushing its
// recent Dexie changes into /api/lan/receive (see syncService.ts's
// pushLan), and by every other peer doing the same when they push to us.
//
// Lives under the current user's home directory, not the app's install
// folder, same reasoning as firebaseConfigStore.ts: survives reinstalling/
// updating the app, independent of install-location permissions.
//
// Ported from retailrp/src/lib/localStore.ts.
import "server-only";
import fs from "fs";
import path from "path";
import { SYNCED_TABLES, type SyncedTableName } from "@/lib/db";
import { getStateHome } from "./stateHome";

const STORE_DIR = path.join(getStateHome(), ".attendms", "local-store");

function ensureDir() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

function fileFor(table: string): string {
  return path.join(STORE_DIR, `${table}.json`);
}

export function readCollection(table: string): Record<string, unknown>[] {
  if (!SYNCED_TABLES.includes(table as SyncedTableName)) return [];
  try {
    return JSON.parse(fs.readFileSync(fileFor(table), "utf8"));
  } catch {
    return [];
  }
}

function writeCollection(table: string, records: Record<string, unknown>[]) {
  ensureDir();
  fs.writeFileSync(fileFor(table), JSON.stringify(records));
}

// Merges incoming records, keeping whichever version (existing vs
// incoming) of each has the newer updated_at — the same last-write-wins
// rule the Firestore sync already uses. Returns how many records actually
// changed, so callers can decide whether it's worth doing anything further.
export function upsertRecords(
  table: string,
  incoming: Record<string, unknown>[],
  idField: string
): number {
  if (!SYNCED_TABLES.includes(table as SyncedTableName) || incoming.length === 0) return 0;

  const existing = readCollection(table);
  const byId = new Map(existing.map((r) => [r[idField], r]));
  let changed = 0;

  for (const record of incoming) {
    const id = record[idField];
    if (id == null) continue;
    const current = byId.get(id);
    const incomingDate = new Date((record.updated_at as string) || 0).getTime();
    const currentDate = current ? new Date((current.updated_at as string) || 0).getTime() : -1;
    if (!current || incomingDate > currentDate) {
      byId.set(id, record);
      changed++;
    }
  }

  if (changed > 0) writeCollection(table, Array.from(byId.values()));
  return changed;
}

// Everything in `table` updated after `since` — the same shape
// /api/sync/pull already returns for Firestore, so the client's existing
// applyIncomingChanges() merge logic works unchanged for LAN-sourced data.
export function recordsSince(table: string, since: string): Record<string, unknown>[] {
  const sinceTime = new Date(since || 0).getTime();
  return readCollection(table).filter(
    (r) => new Date((r.updated_at as string) || 0).getTime() > sinceTime
  );
}
