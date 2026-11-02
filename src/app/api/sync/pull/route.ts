// Returns everything changed since `lastSyncTime` across the requested
// tables. Ported from retailrp/src/controllers/syncController.ts's
// pullData, with one deliberate change: this requires *some* authenticated
// session (any signed-in uid — admin, a permission grant, or a shift
// supervisor window), where the old Firestore rules let anyone who merely
// had the project's public web config read employees' face descriptors and
// hashed PINs with no login of any kind (documented as an accepted
// tradeoff in firestore.rules, because the kiosk itself never signs in).
// That tradeoff is exactly what firebase-admin + a local server closes:
// the kiosk no longer reads Firestore live over the internet at all — it
// reads local Dexie, kept fresh by this same device's own sync loop, which
// only needs ONE admin sign-in during initial kiosk setup, since a
// Firebase Auth session persists (with silent token refresh) until
// explicitly signed out. See requireAuth.ts's top comment for the full
// reasoning.
import { SYNCED_TABLES, type SyncedTableName } from "@/lib/db";
import { db as firestore } from "@/lib/server/firebaseAdmin";
import { resolveAccess, unauthorized } from "@/lib/server/requireAuth";

export async function GET(request: Request) {
  const access = await resolveAccess(request);
  if (!access) return unauthorized();

  const url = new URL(request.url);
  const lastSyncTimeParam = url.searchParams.get("lastSyncTime");
  const collectionsParam = url.searchParams.get("collections") ?? "";

  const parsed = lastSyncTimeParam ? new Date(lastSyncTimeParam) : new Date(0);
  const lastSync = Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;

  const requested = collectionsParam.split(",").filter(Boolean) as SyncedTableName[];
  const changes: Record<string, unknown[]> = {};

  for (const table of requested) {
    if (!SYNCED_TABLES.includes(table)) continue;
    const snapshot = await firestore
      .collection(table)
      .where("updated_at", ">", lastSync.toISOString())
      .get();
    changes[table] = snapshot.docs.map((d) => d.data());
  }

  return Response.json({ changes, serverTime: new Date().toISOString() });
}
