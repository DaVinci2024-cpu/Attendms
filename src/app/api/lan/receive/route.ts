// No auth, by design — this only ever runs between machines already on the
// same private network and already belonging to the same business
// (lanDiscovery only surfaces peers whose businessId matches, and a
// manually-added peer requires physically knowing its IP). The data
// involved is exactly what these two machines would otherwise exchange via
// Firestore anyway. Ported from retailrp/src/controllers/lanSyncController.ts.
import { SYNCED_TABLES, ID_FIELD, type SyncedTableName } from "@/lib/db";
import { upsertRecords } from "@/lib/server/localStore";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const changes = body?.changes as Record<string, Record<string, unknown>[]> | undefined;
  if (!changes) return Response.json({ error: "No changes provided" }, { status: 400 });

  let totalMerged = 0;
  for (const table of Object.keys(changes)) {
    if (!SYNCED_TABLES.includes(table as SyncedTableName)) continue;
    totalMerged += upsertRecords(table, changes[table], ID_FIELD[table as SyncedTableName]);
  }
  return Response.json({ success: true, merged: totalMerged });
}
