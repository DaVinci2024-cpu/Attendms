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
// current values. previousTimestamp/previousType are null when the record
// didn't exist before this entry — i.e. a forgotten shift being closed,
// not a correction to an existing punch.
export interface AttendanceEdit {
  editedBy: string; // uid of whoever made the edit
  editedByName: string;
  reason: string;
  editedAt: string; // ISO
  previousTimestamp: string | null;
  previousType: PunchType | null;
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
// admin-defined time blocks (both renameable/addable/removable), and each
// cell holds zero or more real employees assigned to that day+block —
// picked from the employee list, not typed as free text, so a cell can
// have multiple people covering the same slot.
export interface ScheduleColumn {
  columnId: string;
  label: string;
}

// employeeName is denormalized (copied in at assignment time) purely for
// display without an extra employee lookup per cell — it isn't kept in
// sync if the employee is later renamed.
export interface ScheduleAssignment {
  employeeId: string;
  employeeName: string;
}

export interface ScheduleRow {
  rowId: string;
  label: string;
  cells: Record<string, ScheduleAssignment[]>; // keyed by columnId
}

// The standard set of shift columns, shared across every week that hasn't
// been explicitly split off from it (see WeekSchedule.customColumns below).
// Editing columns on a normal week edits this document; only a week marked
// customColumns writes its own columns instead.
export interface ScheduleColumnTemplate {
  columns: ScheduleColumn[];
  updatedAt: string;
}

export interface WeekSchedule {
  weekId: string; // Monday of the week, YYYY-MM-DD
  // Resolved columns as of the last save — for a week that isn't
  // customColumns, this mirrors the standard template at that time and
  // gets refreshed from it on next load; for a customColumns week, this is
  // the authoritative, week-only column set.
  columns: ScheduleColumn[];
  // True once an admin has explicitly split this week's columns off from
  // the standard template ("keep this week separate"). Absent/false means
  // this week always follows the template.
  customColumns?: boolean;
  rows: ScheduleRow[];
  updatedAt: string;
  updatedBy?: string; // uid of whoever last saved this week
  updatedByName?: string;
  createdBy?: string; // uid of whoever first saved this week
  createdByName?: string;
  createdAt?: string;
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

// How the kiosk identifies whoever is punching. PIN confirmation is always
// required regardless of method — this only controls whether/when face
// matching is used to find the candidate first.
export type AuthMethod = "face_and_pin" | "pin_only" | "face_with_pin_fallback";

// Public-readable for the same reason as KioskDisplaySettings above — kept
// as its own document so the kiosk can read it with no login.
export interface AuthPolicy {
  method: AuthMethod;
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
  | "manage_permissions"
  | "manage_announcements";

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

// One-way admin -> employee updates shown in the employee portal (e.g.
// "staff meeting Friday at 3pm"). Deliberately a plain feed, not a chat —
// only manage_announcements holders can post, everyone signed in can read.
export interface Announcement {
  announcementId: string;
  message: string;
  postedBy: string; // uid
  postedByName: string;
  postedAt: string; // ISO
}

// An employee's self-reported availability for one week, so an admin has
// something to reference while building the schedule. Independent of
// whether that week's WeekSchedule has been created yet — slots are keyed
// by calendar date (YYYY-MM-DD) and the standard column template's
// columnIds, not by a specific week doc's rowIds, precisely so an employee
// can submit availability before the admin has drafted that week at all.
// One doc per employee per week (doc id `${weekId}_${employeeId}`) —
// resubmitting overwrites the previous entry rather than appending.
export interface AvailabilityEntry {
  weekId: string;
  employeeId: string;
  employeeName: string;
  availableSlots: Record<string, string[]>; // date (YYYY-MM-DD) -> columnIds
  note: string;
  submittedAt: string;
}
