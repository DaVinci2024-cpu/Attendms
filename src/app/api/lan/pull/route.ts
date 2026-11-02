import { SYNCED_TABLES, type SyncedTableName } from "@/lib/db";
import { recordsSince } from "@/lib/server/localStore";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const since = url.searchParams.get("lastSyncTime") || new Date(0).toISOString();
  const collectionList = (url.searchParams.get("collections") || "")
    .split(",")
    .filter(Boolean) as SyncedTableName[];

  const changes: Record<string, unknown[]> = {};
  for (const table of collectionList) {
    if (!SYNCED_TABLES.includes(table)) continue;
    changes[table] = recordsSince(table, since);
  }

  return Response.json({ changes, serverTime: new Date().toISOString() });
}
