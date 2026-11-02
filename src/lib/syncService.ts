// Push/pull sync between local Dexie (db.ts) and this device's own local
// server (which relays to Firestore via firebase-admin — see
// src/app/api/sync/*). Ported structurally from
// retailrp/src/services/syncService.ts: same push()/pull()/sync()/init()
// shape, same last-write-wins-by-updated_at merge rule, same
// online/offline-driven cadence — adapted to call Next.js API routes with
// `fetch` + a Firebase ID token instead of axios + a self-issued JWT (see
// requireAuth.ts for why), and with no separate tryRegisterCurrentUser()
// bootstrap step, since that deadlock doesn't apply here the same way
// (see requireAuth.ts's bootstrap-exception comment).
import type { Table } from "dexie";
import { getAuthClient } from "./auth";
import { db, SYNCED_TABLES, ID_FIELD, type SyncedTableName } from "./db";

type SyncStatus = { isSyncing: boolean; lastSuccess: Date | null; error: string | null };
// A row from any synced table is at minimum this shape — every push()/pull()
// operation here only ever touches the sync-plumbing fields generically, so
// a precise per-table type isn't needed and (per the union-of-incompatible-
// overloads errors below without it) actively gets in the way.
type AnySyncedRow = { updated_at: string; synced: boolean; [key: string]: unknown };

async function authHeaders(): Promise<Record<string, string> | undefined> {
  const user = getAuthClient().currentUser;
  if (!user) return undefined;
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

function tableOf(name: SyncedTableName): Table<AnySyncedRow, string> {
  return db[name] as unknown as Table<AnySyncedRow, string>;
}

export const syncService = {
  isSyncing: false,
  lastSuccess: null as Date | null,
  error: null as string | null,
  statusListeners: [] as ((status: SyncStatus) => void)[],

  subscribe(listener: (status: SyncStatus) => void) {
    this.statusListeners.push(listener);
    listener({ isSyncing: this.isSyncing, lastSuccess: this.lastSuccess, error: this.error });
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  },

  setSyncing(val: boolean) {
    this.isSyncing = val;
    this.notify();
  },
  setLastSuccess(date: Date) {
    this.lastSuccess = date;
    this.error = null;
    this.notify();
  },
  setError(err: string | null) {
    this.error = err;
    this.notify();
  },
  notify() {
    const status = { isSyncing: this.isSyncing, lastSuccess: this.lastSuccess, error: this.error };
    this.statusListeners.forEach((l) => l(status));
  },

  async push() {
    const changes: Record<string, unknown[]> = {};
    let hasChanges = false;

    for (const tableName of SYNCED_TABLES) {
      const table = tableOf(tableName);
      const unsynced = await table.filter((r) => r.synced === false).toArray();
      if (unsynced.length > 0) {
        changes[tableName] = unsynced;
        hasChanges = true;
      }
    }

    if (!hasChanges) return;

    const headers = await authHeaders();
    const res = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ changes }),
    });
    if (!res.ok) throw new Error(`Push failed: ${res.status}`);
    const data = await res.json();

    if (data.success) {
      for (const [tableName, records] of Object.entries(changes)) {
        const name = tableName as SyncedTableName;
        const idField = idFieldOf(name);
        const ids = (records as Record<string, unknown>[])
          .map((r) => r[idField])
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        if (ids.length === 0) continue;
        await tableOf(name).where(idField).anyOf(ids).modify({ synced: true });
      }
    }
  },

  // Shared by pull() (Firestore) and pullLan() (a LAN peer's own local
  // store, Phase 4) — both hand it the same {table: [...]} shape.
  async applyIncomingChanges(changes: Record<string, unknown[]>): Promise<number> {
    let total = 0;
    for (const [tableName, records] of Object.entries(changes)) {
      if (!SYNCED_TABLES.includes(tableName as SyncedTableName)) continue;
      const table = tableOf(tableName as SyncedTableName);
      const idField = idFieldOf(tableName as SyncedTableName);
      total += records.length;

      for (const record of records as Record<string, unknown>[]) {
        const id = record[idField];
        if (typeof id !== "string" || id.length === 0) continue;
        try {
          const local = await table.get(id);
          const serverDate = new Date(record.updated_at as string);
          const localDate = local ? new Date(local.updated_at) : new Date(0);
          if (Number.isNaN(serverDate.getTime())) continue;
          if (!local || serverDate > localDate) {
            await table.put({ ...record, synced: true } as AnySyncedRow);
          }
        } catch {
          continue; // skip this one record rather than failing the whole pull
        }
      }
    }
    return total;
  },

  async pull() {
    const lastSyncTime = localStorage.getItem("attendms_lastSyncTime") || new Date(0).toISOString();
    const headers = await authHeaders();
    const res = await fetch(
      `/api/sync/pull?lastSyncTime=${encodeURIComponent(lastSyncTime)}&collections=${SYNCED_TABLES.join(",")}`,
      { headers }
    );
    if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
    const { changes, serverTime } = await res.json();
    await this.applyIncomingChanges(changes);
    localStorage.setItem("attendms_lastSyncTime", serverTime);
  },

  // --- Local-network sync (Phase 4) — independent of push()/pull() above,
  // which are gated on Firestore reachability (see sync() below). LAN sync
  // only ever talks to this same device's own local server, always
  // reachable regardless of internet; that server relays to/from other
  // peers on the network (see src/lib/server/lanGossip.ts).
  async pushLan() {
    const since = localStorage.getItem("attendms_lastLanPushTime") || new Date(0).toISOString();
    const changes: Record<string, unknown[]> = {};
    let hasChanges = false;
    let newest = since;

    for (const tableName of SYNCED_TABLES) {
      const table = tableOf(tableName);
      const records = await table.where("updated_at").above(since).toArray();
      if (records.length > 0) {
        changes[tableName] = records;
        hasChanges = true;
        for (const r of records) if (r.updated_at > newest) newest = r.updated_at;
      }
    }
    if (!hasChanges) return;

    await fetch("/api/lan/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes }),
    });
    localStorage.setItem("attendms_lastLanPushTime", newest);
  },

  async pullLan() {
    const lastSyncTime = localStorage.getItem("attendms_lastLanPullTime") || new Date(0).toISOString();
    const res = await fetch(
      `/api/lan/pull?lastSyncTime=${encodeURIComponent(lastSyncTime)}&collections=${SYNCED_TABLES.join(",")}`
    );
    const { changes, serverTime } = await res.json();
    await this.applyIncomingChanges(changes);
    localStorage.setItem("attendms_lastLanPullTime", serverTime);
  },

  async syncLan() {
    try {
      await this.pushLan();
      await this.pullLan();
    } catch {
      // Expected/harmless with no reachable peers yet — retried next tick.
    }
  },

  async sync() {
    if (this.isSyncing) return;
    this.setSyncing(true);
    try {
      if (!navigator.onLine) return;

      try {
        const res = await fetch("/api/ping", { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error("ping failed");
      } catch {
        throw new Error("Cannot reach the local server. Is the app running?");
      }

      if (!getAuthClient().currentUser) {
        this.setError("Not signed in — sync will resume after your next sign-in");
        return;
      }

      const healthRes = await fetch("/api/health");
      const health = await healthRes.json();
      if (!health.dbConnected) {
        this.setError(health.message || "Cloud data disconnected");
        return;
      }

      await this.push();
      await this.pull();
      this.setLastSuccess(new Date());
    } catch (err) {
      this.setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      this.setSyncing(false);
    }
  },

  init() {
    window.addEventListener("online", () => this.sync());
    window.addEventListener("offline", () => this.setError("Working offline"));

    setTimeout(() => this.sync(), 5000);
    setInterval(() => {
      if (navigator.onLine) this.sync();
    }, 30 * 1000);

    // LAN sync runs on its own schedule unconditionally — see pushLan/
    // pullLan above for why this never checks navigator.onLine.
    setTimeout(() => this.syncLan(), 2000);
    setInterval(() => this.syncLan(), 5 * 1000);

    this.sync();
  },
};

function idFieldOf(tableName: SyncedTableName): string {
  return ID_FIELD[tableName];
}
