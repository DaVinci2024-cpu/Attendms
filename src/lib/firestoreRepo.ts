import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  orderBy,
  updateDoc,
  arrayUnion,
  type CollectionReference,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { COMPANY_ID, COMPANY_NAME, ADMIN_EMAIL } from "./constants";
import type {
  Employee,
  AttendanceLog,
  AttendanceEdit,
  SuspiciousEvent,
  Company,
  WeekSchedule,
  ScheduleColumnTemplate,
  KioskDisplaySettings,
  AuthPolicy,
  PermissionGrant,
  Announcement,
  AvailabilityEntry,
  ShiftNote,
  ShiftSupervisorPermissionSettings,
  ShiftSupervisorGrant,
} from "./types";

function companyDoc() {
  return doc(getDb(), "companies", COMPANY_ID);
}

function employeesCol(): CollectionReference {
  return collection(getDb(), "companies", COMPANY_ID, "employees");
}

function attendanceCol(): CollectionReference {
  return collection(getDb(), "companies", COMPANY_ID, "attendance");
}

function suspiciousEventsCol(): CollectionReference {
  return collection(getDb(), "companies", COMPANY_ID, "suspiciousEvents");
}

function scheduleDoc(weekId: string) {
  return doc(getDb(), "companies", COMPANY_ID, "schedules", weekId);
}

function scheduleColumnsDoc() {
  return doc(getDb(), "companies", COMPANY_ID, "settings", "scheduleColumns");
}

function kioskDisplayDoc() {
  return doc(getDb(), "companies", COMPANY_ID, "settings", "kioskDisplay");
}

function authPolicyDoc() {
  return doc(getDb(), "companies", COMPANY_ID, "settings", "authPolicy");
}

function permissionsCol(): CollectionReference {
  return collection(getDb(), "companies", COMPANY_ID, "permissions");
}

function announcementsCol(): CollectionReference {
  return collection(getDb(), "companies", COMPANY_ID, "announcements");
}

function availabilityCol(): CollectionReference {
  return collection(getDb(), "companies", COMPANY_ID, "availability");
}

function availabilityDocId(weekId: string, employeeId: string): string {
  return `${weekId}_${employeeId}`;
}

function shiftNotesCol(): CollectionReference {
  return collection(getDb(), "companies", COMPANY_ID, "shiftNotes");
}

function shiftSupervisorPermissionsDoc() {
  return doc(getDb(), "companies", COMPANY_ID, "settings", "shiftSupervisorPermissions");
}

function shiftSupervisorGrantsCol(): CollectionReference {
  return collection(getDb(), "companies", COMPANY_ID, "shiftSupervisorGrants");
}

// Called once the admin is signed in (rules require auth to write the
// company doc); safe to call repeatedly, it just overwrites with the same
// current config each time.
export async function ensureCompanyDoc(): Promise<void> {
  const company: Company = {
    companyId: COMPANY_ID,
    companyName: COMPANY_NAME,
    adminEmail: ADMIN_EMAIL,
    createdAt: new Date().toISOString(),
  };
  await setDoc(companyDoc(), company, { merge: true });
}

export async function fetchCompany(): Promise<Company | null> {
  const snapshot = await getDoc(companyDoc());
  return snapshot.exists() ? (snapshot.data() as Company) : null;
}

// Adds the currently-signed-in admin's UID to the company's adminUids the
// first time they sign in after this feature shipped. See the bootstrap
// comment in firestore.rules — this only succeeds while adminUids hasn't
// been set yet, or for a UID already in it.
export async function ensureAdminBootstrap(uid: string): Promise<void> {
  await setDoc(companyDoc(), { adminUids: arrayUnion(uid) }, { merge: true });
}

export async function createEmployee(employee: Employee): Promise<void> {
  await setDoc(doc(employeesCol(), employee.employeeId), employee);
}

export async function fetchAllEmployees(): Promise<Employee[]> {
  const snapshot = await getDocs(employeesCol());
  return snapshot.docs.map((d) => d.data() as Employee);
}

export async function fetchEmployee(
  employeeId: string
): Promise<Employee | null> {
  const snapshot = await getDoc(doc(employeesCol(), employeeId));
  return snapshot.exists() ? (snapshot.data() as Employee) : null;
}

export async function fetchEmployeeByPortalUsername(
  portalUsername: string
): Promise<Employee | null> {
  const q = query(employeesCol(), where("portalUsername", "==", portalUsername), limit(1));
  const snapshot = await getDocs(q);
  return snapshot.empty ? null : (snapshot.docs[0].data() as Employee);
}

export async function fetchEmployeeByAuthUid(
  authUid: string
): Promise<Employee | null> {
  const q = query(employeesCol(), where("authUid", "==", authUid), limit(1));
  const snapshot = await getDocs(q);
  return snapshot.empty ? null : (snapshot.docs[0].data() as Employee);
}

// Links a newly-created Firebase Auth account to an employee record, with
// a temporary-password flag the employee must clear by setting their own
// password on first login.
export async function linkEmployeePortalAccount(
  employeeId: string,
  portalUsername: string,
  authUid: string
): Promise<void> {
  await updateDoc(doc(employeesCol(), employeeId), {
    portalUsername,
    authUid,
    mustChangePassword: true,
  });
}

export async function clearMustChangePassword(employeeId: string): Promise<void> {
  await updateDoc(doc(employeesCol(), employeeId), { mustChangePassword: false });
}

// Employee-initiated deletion path (spec Section 5): removes the
// descriptors and consent record entirely, independent of just flipping
// active:false. Historical attendance logs (name + timestamp only, no
// biometric data) are left in place.
export async function deleteEmployee(employeeId: string): Promise<void> {
  await deleteDoc(doc(employeesCol(), employeeId));
}

// Every attendance record is fetched (served from the local IndexedDB cache
// when offline) rather than via a `where` + `orderBy` composite query — the
// kiosk uses this to look up an employee's last punch-in for the worked-hours
// display on punch-out, and the admin dashboard pairs it all into sessions
// (src/lib/hours.ts). Works with no Firestore index requirement even on a
// kiosk that has never had a network connection since its last cache clear.
export async function fetchAllAttendance(): Promise<AttendanceLog[]> {
  const snapshot = await getDocs(attendanceCol());
  return snapshot.docs.map((d) => d.data() as AttendanceLog);
}

// Scoped to one employee via a `where` clause so the Firestore rule (which
// checks each matched doc's employeeId against the caller's linked
// authUid) can actually be satisfied for a non-admin employee reading
// their own history.
export async function fetchAttendanceForEmployee(
  employeeId: string
): Promise<AttendanceLog[]> {
  const q = query(attendanceCol(), where("employeeId", "==", employeeId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as AttendanceLog);
}

export async function recordPunch(log: AttendanceLog): Promise<void> {
  await setDoc(doc(attendanceCol(), log.logId), log);
}

export async function recordSuspiciousEvent(
  event: SuspiciousEvent
): Promise<void> {
  await setDoc(doc(suspiciousEventsCol(), event.eventId), event);
}

export async function fetchWeekSchedule(
  weekId: string
): Promise<WeekSchedule | null> {
  const snapshot = await getDoc(scheduleDoc(weekId));
  return snapshot.exists() ? (snapshot.data() as WeekSchedule) : null;
}

export async function saveWeekSchedule(schedule: WeekSchedule): Promise<void> {
  await setDoc(scheduleDoc(schedule.weekId), schedule);
}

// The standard column set shared by every week that hasn't been split off
// via WeekSchedule.customColumns.
export async function fetchScheduleColumnTemplate(): Promise<ScheduleColumnTemplate | null> {
  const snapshot = await getDoc(scheduleColumnsDoc());
  return snapshot.exists() ? (snapshot.data() as ScheduleColumnTemplate) : null;
}

export async function saveScheduleColumnTemplate(
  template: ScheduleColumnTemplate
): Promise<void> {
  await setDoc(scheduleColumnsDoc(), template);
}

export async function fetchKioskDisplaySettings(): Promise<KioskDisplaySettings | null> {
  const snapshot = await getDoc(kioskDisplayDoc());
  return snapshot.exists() ? (snapshot.data() as KioskDisplaySettings) : null;
}

export async function saveKioskDisplaySettings(
  settings: KioskDisplaySettings
): Promise<void> {
  await setDoc(kioskDisplayDoc(), settings);
}

export async function fetchAuthPolicy(): Promise<AuthPolicy | null> {
  const snapshot = await getDoc(authPolicyDoc());
  return snapshot.exists() ? (snapshot.data() as AuthPolicy) : null;
}

export async function saveAuthPolicy(policy: AuthPolicy): Promise<void> {
  await setDoc(authPolicyDoc(), policy);
}

export async function fetchAllPermissionGrants(): Promise<PermissionGrant[]> {
  const snapshot = await getDocs(permissionsCol());
  return snapshot.docs.map((d) => d.data() as PermissionGrant);
}

export async function fetchPermissionGrant(
  uid: string
): Promise<PermissionGrant | null> {
  const snapshot = await getDoc(doc(permissionsCol(), uid));
  return snapshot.exists() ? (snapshot.data() as PermissionGrant) : null;
}

export async function savePermissionGrant(grant: PermissionGrant): Promise<void> {
  await setDoc(doc(permissionsCol(), grant.uid), grant);
}

export async function revokePermissionGrant(uid: string): Promise<void> {
  await deleteDoc(doc(permissionsCol(), uid));
}

// Appends one audit entry and applies the correction — never overwrites a
// prior edit's record, only ever adds to the history.
export async function editAttendanceLog(
  log: AttendanceLog,
  newTimestamp: string,
  newType: AttendanceLog["type"],
  reason: string,
  editedBy: string,
  editedByName: string
): Promise<void> {
  const edit: AttendanceEdit = {
    editedBy,
    editedByName,
    reason,
    editedAt: new Date().toISOString(),
    previousTimestamp: log.timestamp,
    previousType: log.type,
  };
  await updateDoc(doc(attendanceCol(), log.logId), {
    timestamp: newTimestamp,
    type: newType,
    edits: arrayUnion(edit),
  });
}

// Closes a forgotten shift: creates the missing punch_out directly (not an
// edit to an existing record — there isn't one), with the reason baked in
// as the record's first audit entry so it's clear this was a manual close,
// not a real kiosk punch.
export async function closeShift(
  employeeId: string,
  employeeName: string,
  timestamp: string,
  reason: string,
  editedBy: string,
  editedByName: string
): Promise<AttendanceLog> {
  const log: AttendanceLog = {
    logId: `log_${crypto.randomUUID()}`,
    employeeId,
    employeeName,
    timestamp,
    type: "punch_out",
    matchConfidence: 0,
    pinConfirmed: false,
    kioskId: "admin_correction",
    syncedOffline: false,
    edits: [
      {
        editedBy,
        editedByName,
        reason,
        editedAt: new Date().toISOString(),
        previousTimestamp: null,
        previousType: null,
      },
    ],
  };
  await setDoc(doc(attendanceCol(), log.logId), log);
  return log;
}

// Most recent first. limitCount keeps the portal/admin feed from pulling
// the whole history every load — older announcements just scroll off.
export async function fetchAnnouncements(limitCount = 20): Promise<Announcement[]> {
  const q = query(announcementsCol(), orderBy("postedAt", "desc"), limit(limitCount));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as Announcement);
}

export async function postAnnouncement(announcement: Announcement): Promise<void> {
  await setDoc(doc(announcementsCol(), announcement.announcementId), announcement);
}

export async function deleteAnnouncement(announcementId: string): Promise<void> {
  await deleteDoc(doc(announcementsCol(), announcementId));
}

export async function fetchMyAvailability(
  weekId: string,
  employeeId: string
): Promise<AvailabilityEntry | null> {
  const snapshot = await getDoc(doc(availabilityCol(), availabilityDocId(weekId, employeeId)));
  return snapshot.exists() ? (snapshot.data() as AvailabilityEntry) : null;
}

export async function saveAvailability(entry: AvailabilityEntry): Promise<void> {
  await setDoc(doc(availabilityCol(), availabilityDocId(entry.weekId, entry.employeeId)), entry);
}

// Scoped to one week via a `where` clause (single-field, no composite
// index needed) so an admin building that week's schedule can see
// everyone's submitted availability for it.
export async function fetchAvailabilityForWeek(weekId: string): Promise<AvailabilityEntry[]> {
  const q = query(availabilityCol(), where("weekId", "==", weekId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as AvailabilityEntry);
}

// One query per week (single where clause, no composite index needed),
// grouped client-side by rowId+columnId — a week's total note count is
// small enough that this is simpler than a query per cell.
export async function fetchShiftNotesForWeek(weekId: string): Promise<ShiftNote[]> {
  const q = query(shiftNotesCol(), where("weekId", "==", weekId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as ShiftNote);
}

export async function postShiftNote(note: ShiftNote): Promise<void> {
  await setDoc(doc(shiftNotesCol(), note.noteId), note);
}

export async function fetchShiftSupervisorPermissionSettings(): Promise<ShiftSupervisorPermissionSettings | null> {
  const snapshot = await getDoc(shiftSupervisorPermissionsDoc());
  return snapshot.exists() ? (snapshot.data() as ShiftSupervisorPermissionSettings) : null;
}

export async function saveShiftSupervisorPermissionSettings(
  settings: ShiftSupervisorPermissionSettings
): Promise<void> {
  await setDoc(shiftSupervisorPermissionsDoc(), settings);
}

export async function saveShiftSupervisorGrant(grant: ShiftSupervisorGrant): Promise<void> {
  await setDoc(doc(shiftSupervisorGrantsCol(), grant.uid), grant);
}

export async function fetchShiftSupervisorGrant(
  uid: string
): Promise<ShiftSupervisorGrant | null> {
  const snapshot = await getDoc(doc(shiftSupervisorGrantsCol(), uid));
  return snapshot.exists() ? (snapshot.data() as ShiftSupervisorGrant) : null;
}
