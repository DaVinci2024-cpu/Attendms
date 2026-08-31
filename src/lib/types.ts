// Mirrors the Firestore schema in the spec (Section 4).

export interface ConsentRecord {
  consentedAt: string; // ISO timestamp
  policyVersion: string;
  recordedBy: string;
}

export interface FaceDescriptor {
  // Firestore rejects arrays nested directly inside arrays, so each 128-d
  // descriptor is wrapped in an object instead of being a bare number[].
  values: number[];
}

export interface Employee {
  employeeId: string;
  fullName: string;
  // PBKDF2-SHA256 hash + per-employee salt (see src/lib/pin.ts) — never
  // the plaintext PIN.
  pinHash: string;
  pinSalt: string;
  // One descriptor per enrollment snapshot (1-3 typical).
  faceDescriptors: FaceDescriptor[];
  role: "employee" | "admin";
  active: boolean;
  createdAt: string;
  consent: ConsentRecord;
  // Self-service portal login (separate from the kiosk PIN). Absent until
  // an admin sets one up via /admin/employees.
  portalUsername?: string;
  authUid?: string;
  // True after an admin creates/resets the portal account with a temporary
  // password, until the employee sets their own on first login.
  mustChangePassword?: boolean;
}

export type PunchType = "punch_in" | "punch_out";

// One correction made to a punch after the fact — appended, never
// overwritten, so the full history of edits survives alongside the
// current values.
export interface AttendanceEdit {
  editedBy: string; // uid of whoever made the edit
  editedByName: string;
  reason: string;
  editedAt: string; // ISO
  previousTimestamp: string;
  previousType: PunchType;
}

export interface AttendanceLog {
  logId: string;
  employeeId: string;
  employeeName: string;
  timestamp: string; // ISO
  type: PunchType;
  matchConfidence: number; // Euclidean distance of the accepted match
  pinConfirmed: boolean;
  kioskId: string;
  syncedOffline: boolean;
  edits?: AttendanceEdit[];
}

export interface SuspiciousEvent {
  eventId: string;
  employeeId: string;
  employeeName: string;
  timestamp: string;
  reason: "wrong_pin";
  attempts: number;
  kioskId: string;
}

// A spreadsheet-style weekly schedule: rows are days, columns are
// admin-defined time blocks, and each cell is free text (typically an
// employee name) — both rows and columns can be renamed, added, or
// removed, so this deliberately doesn't model shifts as structured
// per-employee records.
export interface ScheduleColumn {
  columnId: string;
  label: string;
}

export interface ScheduleRow {
  rowId: string;
  label: string;
  cells: Record<string, string>; // keyed by columnId
}

export interface WeekSchedule {
  weekId: string; // Monday of the week, YYYY-MM-DD
  columns: ScheduleColumn[];
  rows: ScheduleRow[];
  updatedAt: string;
}

export interface Company {
  companyId: string;
  companyName: string;
  adminEmail: string;
  createdAt: string;
  // Firebase Auth UIDs recognized as admin — how Firestore rules tell an
  // admin login apart from an employee portal login now that both exist.
  adminUids?: string[];
}

// Public-readable (no login) so the kiosk screen can show it — deliberately
// kept in its own document, separate from the main Company doc, so this
// stays world-readable without exposing adminEmail/adminUids too.
export interface KioskDisplaySettings {
  headline: string; // e.g. the business name/greeting shown big on the kiosk
  notice: string;
  noticeActive: boolean;
  updatedAt: string;
}

// The permission catalog. `adminUids` on Company remain permanent
// superusers regardless of this — grants here are the additive layer for
// giving someone (another admin, or an employee's own portal account) a
// specific subset of capabilities, optionally time-limited.
export type Permission =
  | "manage_employees"
  | "manage_schedule"
  | "edit_attendance"
  | "manage_kiosk_settings"
  | "view_reports"
  | "manage_permissions";

export interface PermissionGrant {
  uid: string;
  displayName: string;
  permissions: Permission[];
  expiresAtMillis: number | null; // null = permanent
  grantedBy: string;
  grantedAt: string; // ISO, display only
}

export interface Kiosk {
  kioskId: string;
  label: string;
  pairedAt: string;
  lastSeenAt: string;
  active: boolean;
}
