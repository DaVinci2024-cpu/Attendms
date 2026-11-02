// Receives this device's unsynced Dexie rows and commits them to Firestore
// via firebase-admin (bypasses security rules — see firebaseAdmin.ts's top
// comment). Ported structurally from retailrp/src/controllers/syncController.ts
// (ALLOWED_TABLES + ADMIN_ONLY_TABLES server-side gating), adapted to this
// app's actual permission catalog (src/lib/types.ts's Permission union)
// instead of a single Admin/Manager/Cashier role, and with one deliberate
// addition: the `attendance` table's old Firestore rule
// (`allow create: if true`) is preserved exactly, not just approximated —
// see REQUIRED_PERMISSIONS below for why.
import { SYNCED_TABLES, ID_FIELD, type SyncedTableName } from "@/lib/db";
import { db as firestore } from "@/lib/server/firebaseAdmin";
import { resolveAccess, hasPermission } from "@/lib/server/requireAuth";
import type { Permission } from "@/lib/types";

// The permission required to push a write to each table. `null` means any
// signed-in user may push to it (nothing here is sensitive enough to gate
// further — availability/shiftNotes are already scoped to "about myself"
// by the client, same as their old Firestore rules). `"admin"` means full
// admin only, matching retailrp's ADMIN_ONLY_TABLES. "attendance" is
// intentionally absent from this map — see pushAttendanceRecord below;
// every other table not listed here falls back to requiring the
// `manage_employees`-grade bar of "any authenticated user", same spirit as
// the old rules' `request.auth != null` default.
const REQUIRED_PERMISSIONS: Partial<Record<SyncedTableName, Permission | "admin">> = {
  company: "admin",
  employees: "manage_employees",
  permissionGrants: "manage_permissions",
  shiftSupervisorGrants: "manage_schedule",
  shiftSupervisorPermissionSettings: "manage_permissions",
  scheduleColumnTemplate: "manage_schedule",
  schedules: "manage_schedule",
  kioskDisplaySettings: "manage_kiosk_settings",
  authPolicy: "manage_kiosk_settings",
  locationPolicy: "manage_kiosk_settings",
  scheduleExemptions: "manage_schedule_exemptions",
  announcements: "manage_announcements",
  suspiciousEvents: "admin",
  activityLog: "admin",
};

function isAllowed(
  table: SyncedTableName,
  access: Awaited<ReturnType<typeof resolveAccess>>
): boolean {
  const required = REQUIRED_PERMISSIONS[table];
  if (required === undefined) return !!access; // any authenticated user
  if (required === "admin") return !!access?.isAdmin;
  return hasPermission(access, required);
}

// The kiosk never signs in (see firestore.rules' README-quoted tradeoff
// note, carried over here) — it has no Firebase session to send a token
// with at all. So a brand-new punch_in/punch_out record must be acceptable
// with no auth, exactly like the old `allow create: if true` rule.
// Editing or voiding an *existing* record (anything that grows its
// `edits[]`) still requires edit_attendance — same distinction the old
// `allow update` rule drew between a fresh create and a correction.
async function isAttendanceWriteAllowed(
  record: Record<string, unknown>,
  access: Awaited<ReturnType<typeof resolveAccess>>
): Promise<boolean> {
  const existing = await firestore.collection("attendance").doc(record.logId as string).get();
  if (!existing.exists) return true; // a genuinely new punch — always allowed
  return hasPermission(access, "edit_attendance");
}

export async function POST(request: Request) {
  const access = await resolveAccess(request);
  const body = await request.json().catch(() => null);
  const changes = body?.changes as Record<string, Record<string, unknown>[]> | undefined;
  if (!changes) return Response.json({ error: "No changes provided" }, { status: 400 });

  let totalCount = 0;

  for (const table of Object.keys(changes)) {
    if (!SYNCED_TABLES.includes(table as SyncedTableName)) continue;
    const tableName = table as SyncedTableName;
    const records = changes[table];

    const BATCH_SIZE = 500;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const chunk = records.slice(i, i + BATCH_SIZE);
      const batch = firestore.batch();

      for (const record of chunk) {
        const id = record[ID_FIELD[tableName]] as string | undefined;
        if (!id) continue;

        if (tableName === "attendance") {
          if (!(await isAttendanceWriteAllowed(record, access))) continue;
        } else if (!isAllowed(tableName, access)) {
          continue;
        }

        const { synced: _synced, ...rest } = record;
        void _synced;
        const sanitized: Record<string, unknown> = { ...rest };
        for (const key of Object.keys(sanitized)) {
          if (sanitized[key] === undefined) delete sanitized[key];
        }
        if (typeof sanitized.updated_at !== "string") {
          sanitized.updated_at = new Date().toISOString();
        }

        batch.set(firestore.collection(tableName).doc(id), sanitized, { merge: true });
        totalCount++;
      }

      await batch.commit();
    }
  }

  return Response.json({ success: true, count: totalCount });
}
