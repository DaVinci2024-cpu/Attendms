// The kiosk/admin app's local source of truth. Every screen reads and
// writes here first (see dexieRepo.ts) — Firestore is a background sync
// target (syncService.ts), not something any page talks to directly
// anymore. This is what lets a kiosk match a face and record a punch with
// zero network and zero Firestore, not "Firestore's own write queue
// happens to survive it" (the PWA branch's approach).
//
// Every table carries three sync-plumbing fields on top of its own normal
// fields (kept snake_case so they're visually unmistakable from the
// camelCase domain fields every type in src/lib/types.ts already uses):
//   - updated_at: ISO timestamp, bumped on every local write. The sync
//     engine's whole conflict-resolution rule is "newer updated_at wins" —
//     see syncService.ts/applyIncomingChanges.
//   - is_deleted: soft-delete. Nothing is ever actually removed from a
//     table locally — a delete sets this true so the deletion itself
//     syncs to every other device/Firestore instead of silently
//     resurrecting there. Readers filter it out (see dexieRepo.ts).
//   - synced: false until a push to Firestore (or a LAN peer) has
//     confirmed this exact version made it out. The sync engine's push
//     step is "find every row with synced === false".
//
// Ported structurally from retailrp/src/lib/db.ts (one Table per entity,
// versioned .stores() blocks) — flattened to top-level Firestore
// collections rather than nested under companies/{companyId}, since Phase
// 2's per-install Firebase project means each project now belongs to
// exactly one company; see the architecture note in firebase-admin.ts.
import Dexie, { type Table } from "dexie";
import type {
  Employee,
  AttendanceLog,
  SuspiciousEvent,
  Company,
  WeekSchedule,
  ScheduleColumnTemplate,
  KioskDisplaySettings,
  AuthPolicy,
  LocationPolicy,
  PermissionGrant,
  Announcement,
  AvailabilityEntry,
  ShiftNote,
  ShiftSupervisorPermissionSettings,
  ShiftSupervisorGrant,
  ScheduleExemption,
} from "./types";

export type Synced<T> = T & {
  updated_at: string;
  is_deleted: boolean;
  synced: boolean;
};

// A fixed, singleton row id for the handful of tables that only ever hold
// one document in Firestore (a single settings doc, not a collection).
export const SINGLETON_ID = "singleton";

export type DexieCompany = Synced<Company>;
export type DexieEmployee = Synced<Employee>;
export type DexieAttendanceLog = Synced<AttendanceLog>;
export type DexieSuspiciousEvent = Synced<SuspiciousEvent>;
export type DexieWeekSchedule = Synced<WeekSchedule>;
export type DexieScheduleColumnTemplate = Synced<
  ScheduleColumnTemplate & { id: string }
>;
export type DexieKioskDisplaySettings = Synced<
  KioskDisplaySettings & { id: string }
>;
export type DexieAuthPolicy = Synced<AuthPolicy & { id: string }>;
export type DexieLocationPolicy = Synced<LocationPolicy & { id: string }>;
export type DexiePermissionGrant = Synced<PermissionGrant>;
export type DexieShiftSupervisorGrant = Synced<ShiftSupervisorGrant>;
export type DexieShiftSupervisorPermissionSettings = Synced<
  ShiftSupervisorPermissionSettings & { id: string }
>;
export type DexieScheduleExemption = Synced<ScheduleExemption>;
export type DexieAnnouncement = Synced<Announcement>;
// docId = `${weekId}_${employeeId}`, same composite id Firestore already
// uses for this collection (see firestoreRepo.ts's availabilityDoc).
export type DexieAvailabilityEntry = Synced<AvailabilityEntry & { docId: string }>;
export type DexieShiftNote = Synced<ShiftNote>;

// New in this port (Phase 6) — one row per admin action, independent of
// Firestore's own append-only edit trails (AttendanceEdit etc.), which
// only cover corrections to a record, not actions like "employee added" or
// "permission granted" that don't belong to any one record's own history.
export interface ActivityLogEntry {
  id: string;
  actorUid: string;
  actorName: string;
  action: string; // e.g. "employee.create", "schedule.save", "permission.grant"
  tableName: string;
  recordId: string;
  summary: string;
  created_at: string;
  updated_at: string;
  synced: boolean;
}

export class AttendmsDatabase extends Dexie {
  company!: Table<DexieCompany, string>;
  employees!: Table<DexieEmployee, string>;
  attendance!: Table<DexieAttendanceLog, string>;
  suspiciousEvents!: Table<DexieSuspiciousEvent, string>;
  schedules!: Table<DexieWeekSchedule, string>;
  scheduleColumnTemplate!: Table<DexieScheduleColumnTemplate, string>;
  kioskDisplaySettings!: Table<DexieKioskDisplaySettings, string>;
  authPolicy!: Table<DexieAuthPolicy, string>;
  locationPolicy!: Table<DexieLocationPolicy, string>;
  permissionGrants!: Table<DexiePermissionGrant, string>;
  shiftSupervisorGrants!: Table<DexieShiftSupervisorGrant, string>;
  shiftSupervisorPermissionSettings!: Table<
    DexieShiftSupervisorPermissionSettings,
    string
  >;
  scheduleExemptions!: Table<DexieScheduleExemption, string>;
  announcements!: Table<DexieAnnouncement, string>;
  availability!: Table<DexieAvailabilityEntry, string>;
  shiftNotes!: Table<DexieShiftNote, string>;
  activityLog!: Table<ActivityLogEntry, string>;

  constructor() {
    super("AttendmsDatabase");
    this.version(1).stores({
      company: "companyId, updated_at",
      employees: "employeeId, fullName, authUid, portalUsername, department, updated_at",
      attendance: "logId, employeeId, type, timestamp, updated_at",
      suspiciousEvents: "eventId, employeeId, timestamp, updated_at",
      schedules: "weekId, updated_at",
      scheduleColumnTemplate: "id, updated_at",
      kioskDisplaySettings: "id, updated_at",
      authPolicy: "id, updated_at",
      locationPolicy: "id, updated_at",
      permissionGrants: "uid, updated_at",
      shiftSupervisorGrants: "uid, employeeId, weekId, updated_at",
      shiftSupervisorPermissionSettings: "id, updated_at",
      scheduleExemptions: "employeeId, updated_at",
      announcements: "announcementId, postedAt, updated_at",
      availability: "docId, weekId, employeeId, updated_at",
      shiftNotes: "noteId, weekId, rowId, columnId, updated_at",
      activityLog: "id, actorUid, tableName, recordId, created_at, updated_at",
    });
  }
}

export const db = new AttendmsDatabase();

// Every table name the sync engine (syncService.ts), backup/restore
// (backup.ts), and LAN gossip (Phase 4) all agree makes up "this
// business's data" — one list, not several that could silently drift
// apart. Matches retailrp's COLLECTIONS/ALLOWED_TABLES pattern exactly.
export const SYNCED_TABLES = [
  "company",
  "employees",
  "attendance",
  "suspiciousEvents",
  "schedules",
  "scheduleColumnTemplate",
  "kioskDisplaySettings",
  "authPolicy",
  "locationPolicy",
  "permissionGrants",
  "shiftSupervisorGrants",
  "shiftSupervisorPermissionSettings",
  "scheduleExemptions",
  "announcements",
  "availability",
  "shiftNotes",
  "activityLog",
] as const;

export type SyncedTableName = (typeof SYNCED_TABLES)[number];

// Which field each table uses as its id — the same Dexie primary key named
// in each table's .stores() entry above, and the field name sync (both the
// client's push()/pull() in syncService.ts and the server routes under
// src/app/api/sync and src/app/api/lan) uses as the Firestore doc id too.
// One shared source so nothing has to guess an id field from a record's
// shape.
export const ID_FIELD: Record<SyncedTableName, string> = {
  company: "companyId",
  employees: "employeeId",
  attendance: "logId",
  suspiciousEvents: "eventId",
  schedules: "weekId",
  scheduleColumnTemplate: "id",
  kioskDisplaySettings: "id",
  authPolicy: "id",
  locationPolicy: "id",
  permissionGrants: "uid",
  shiftSupervisorGrants: "uid",
  shiftSupervisorPermissionSettings: "id",
  scheduleExemptions: "employeeId",
  announcements: "announcementId",
  availability: "docId",
  shiftNotes: "noteId",
  activityLog: "id",
};
