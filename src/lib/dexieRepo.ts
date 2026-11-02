// Drop-in replacement for firestoreRepo.ts — same exported function names
// and signatures, so every page that used to call firestoreRepo directly
// just changes its import. Reads/writes go to Dexie (db.ts) instead of
// Firestore; the sync engine (syncService.ts) reconciles Dexie with
// Firestore in the background. See db.ts's top comment for the
// updated_at/is_deleted/synced convention every write here follows.
//
// Two differences from firestoreRepo.ts worth knowing when reading this
// file side by side with it:
//   1. A "delete" is always a soft delete (is_deleted: true) here, never a
//      real Dexie table.delete() — the deletion itself has to sync out to
//      every other device/Firestore, not just disappear locally. Every
//      fetch* function filters is_deleted out.
//   2. The handful of functions that represent a clear "admin did X" action
//      (create/delete employee, grant/revoke permission, grant/revoke
//      schedule exemption, save schedule/kiosk settings) also append one
//      row to activityLog (Phase 6) — see recordActivity below. The actor
//      is read from whichever Firebase Auth user is currently signed in,
//      since every one of these call sites is already gated behind
//      RequireAdmin, so this never changes the function's own signature.
import { getAuthClient } from "./auth";
import { db, SINGLETON_ID, type ActivityLogEntry } from "./db";
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
  LocationPolicy,
  PermissionGrant,
  Announcement,
  AvailabilityEntry,
  ShiftNote,
  ShiftSupervisorPermissionSettings,
  ShiftSupervisorGrant,
  ScheduleExemption,
} from "./types";
import { COMPANY_ID, COMPANY_NAME, ADMIN_EMAIL } from "./constants";

function now(): string {
  return new Date().toISOString();
}

function availabilityDocId(weekId: string, employeeId: string): string {
  return `${weekId}_${employeeId}`;
}

async function recordActivity(
  action: string,
  tableName: string,
  recordId: string,
  summary: string
): Promise<void> {
  const user = getAuthClient().currentUser;
  const entry: ActivityLogEntry = {
    id: `act_${crypto.randomUUID()}`,
    actorUid: user?.uid ?? "unknown",
    actorName: user?.email ?? user?.uid ?? "unknown",
    action,
    tableName,
    recordId,
    summary,
    created_at: now(),
    updated_at: now(),
    synced: false,
  };
  await db.activityLog.put(entry);
}

// --- Company -----------------------------------------------------------

export async function ensureCompanyDoc(): Promise<void> {
  const existing = await db.company.toCollection().first();
  if (existing) return;
  const company: Company = {
    companyId: COMPANY_ID,
    companyName: COMPANY_NAME,
    adminEmail: ADMIN_EMAIL,
    createdAt: now(),
  };
  await db.company.put({ ...company, updated_at: now(), is_deleted: false, synced: false });
}

export async function fetchCompany(): Promise<Company | null> {
  const row = await db.company.toCollection().first();
  return row ?? null;
}

export async function ensureAdminBootstrap(uid: string): Promise<void> {
  const existing = await db.company.toCollection().first();
  const adminUids = Array.from(new Set([...(existing?.adminUids ?? []), uid]));
  if (existing) {
    await db.company.update(existing.companyId, { adminUids, updated_at: now(), synced: false });
  } else {
    await db.company.put({
      companyId: COMPANY_ID,
      companyName: COMPANY_NAME,
      adminEmail: ADMIN_EMAIL,
      createdAt: now(),
      adminUids,
      updated_at: now(),
      is_deleted: false,
      synced: false,
    });
  }
}

// --- Employees -----------------------------------------------------------

export async function createEmployee(employee: Employee): Promise<void> {
  await db.employees.put({ ...employee, updated_at: now(), is_deleted: false, synced: false });
  await recordActivity("employee.create", "employees", employee.employeeId, `Added ${employee.fullName}`);
}

export async function fetchAllEmployees(): Promise<Employee[]> {
  return db.employees.filter((e) => !e.is_deleted).toArray();
}

export async function fetchEmployee(employeeId: string): Promise<Employee | null> {
  const row = await db.employees.get(employeeId);
  return row && !row.is_deleted ? row : null;
}

export async function fetchEmployeeByPortalUsername(
  portalUsername: string
): Promise<Employee | null> {
  const row = await db.employees
    .where("portalUsername")
    .equals(portalUsername)
    .filter((e) => !e.is_deleted)
    .first();
  return row ?? null;
}

export async function fetchEmployeeByAuthUid(authUid: string): Promise<Employee | null> {
  const row = await db.employees
    .where("authUid")
    .equals(authUid)
    .filter((e) => !e.is_deleted)
    .first();
  return row ?? null;
}

export async function linkEmployeePortalAccount(
  employeeId: string,
  portalUsername: string,
  authUid: string
): Promise<void> {
  await db.employees.update(employeeId, {
    portalUsername,
    authUid,
    mustChangePassword: true,
    updated_at: now(),
    synced: false,
  });
}

export async function clearMustChangePassword(employeeId: string): Promise<void> {
  await db.employees.update(employeeId, { mustChangePassword: false, updated_at: now(), synced: false });
}

export async function setEmployeeSupervisorFlag(
  employeeId: string,
  isSupervisor: boolean
): Promise<void> {
  await db.employees.update(employeeId, { isSupervisor, updated_at: now(), synced: false });
}

export async function updateEmployeeName(employeeId: string, fullName: string): Promise<void> {
  await db.employees.update(employeeId, { fullName, updated_at: now(), synced: false });
}

export async function updateEmployeeDepartment(
  employeeId: string,
  department: string
): Promise<void> {
  await db.employees.update(employeeId, { department, updated_at: now(), synced: false });
}

export async function resetEmployeePin(
  employeeId: string,
  pinHash: string,
  pinSalt: string
): Promise<void> {
  await db.employees.update(employeeId, { pinHash, pinSalt, updated_at: now(), synced: false });
}

export async function deleteEmployee(employeeId: string): Promise<void> {
  const employee = await db.employees.get(employeeId);
  await db.employees.update(employeeId, { is_deleted: true, updated_at: now(), synced: false });
  await recordActivity(
    "employee.delete",
    "employees",
    employeeId,
    `Removed ${employee?.fullName ?? employeeId}`
  );
}

// --- Attendance ------------------------------------------------------------

export async function fetchAllAttendance(): Promise<AttendanceLog[]> {
  return db.attendance.filter((a) => !a.is_deleted).toArray();
}

export async function fetchAttendanceForEmployee(employeeId: string): Promise<AttendanceLog[]> {
  return db.attendance
    .where("employeeId")
    .equals(employeeId)
    .filter((a) => !a.is_deleted)
    .toArray();
}

export async function recordPunch(log: AttendanceLog): Promise<void> {
  await db.attendance.put({ ...log, updated_at: now(), is_deleted: false, synced: false });
}

export async function fetchLastAttendanceForEmployee(
  employeeId: string
): Promise<AttendanceLog | null> {
  const logs = await fetchAttendanceForEmployee(employeeId);
  if (logs.length === 0) return null;
  return logs.reduce((latest, log) => (log.timestamp > latest.timestamp ? log : latest));
}

export async function recordSuspiciousEvent(event: SuspiciousEvent): Promise<void> {
  await db.suspiciousEvents.put({ ...event, updated_at: now(), is_deleted: false, synced: false });
}

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
    editedAt: now(),
    previousTimestamp: log.timestamp,
    previousType: log.type,
  };
  await db.attendance.update(log.logId, {
    timestamp: newTimestamp,
    type: newType,
    edits: [...(log.edits ?? []), edit],
    updated_at: now(),
    synced: false,
  });
}

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
        editedAt: now(),
        previousTimestamp: null,
        previousType: null,
      },
    ],
  };
  await db.attendance.put({ ...log, updated_at: now(), is_deleted: false, synced: false });
  return log;
}

export async function createManualAttendanceLog(
  employeeId: string,
  employeeName: string,
  timestamp: string,
  type: AttendanceLog["type"],
  reason: string,
  editedBy: string,
  editedByName: string
): Promise<AttendanceLog> {
  const log: AttendanceLog = {
    logId: `log_${crypto.randomUUID()}`,
    employeeId,
    employeeName,
    timestamp,
    type,
    matchConfidence: 0,
    pinConfirmed: false,
    kioskId: "admin_correction",
    syncedOffline: false,
    edits: [
      {
        editedBy,
        editedByName,
        reason,
        editedAt: now(),
        previousTimestamp: null,
        previousType: null,
      },
    ],
  };
  await db.attendance.put({ ...log, updated_at: now(), is_deleted: false, synced: false });
  return log;
}

export async function voidAttendanceLog(
  log: AttendanceLog,
  reason: string,
  editedBy: string,
  editedByName: string
): Promise<void> {
  const edit: AttendanceEdit = {
    editedBy,
    editedByName,
    reason,
    editedAt: now(),
    previousTimestamp: log.timestamp,
    previousType: log.type,
    voided: true,
  };
  await db.attendance.update(log.logId, {
    edits: [...(log.edits ?? []), edit],
    updated_at: now(),
    synced: false,
  });
}

// --- Schedule ----------------------------------------------------------

export async function fetchWeekSchedule(weekId: string): Promise<WeekSchedule | null> {
  const row = await db.schedules.get(weekId);
  return row && !row.is_deleted ? row : null;
}

export async function saveWeekSchedule(schedule: WeekSchedule): Promise<void> {
  await db.schedules.put({ ...schedule, updated_at: now(), is_deleted: false, synced: false });
  await recordActivity("schedule.save", "schedules", schedule.weekId, `Saved schedule for week ${schedule.weekId}`);
}

export async function fetchScheduleColumnTemplate(): Promise<ScheduleColumnTemplate | null> {
  const row = await db.scheduleColumnTemplate.get(SINGLETON_ID);
  return row ?? null;
}

export async function saveScheduleColumnTemplate(
  template: ScheduleColumnTemplate
): Promise<void> {
  await db.scheduleColumnTemplate.put({
    ...template,
    id: SINGLETON_ID,
    updated_at: now(),
    is_deleted: false,
    synced: false,
  });
}

// --- Settings ------------------------------------------------------------

export async function fetchKioskDisplaySettings(): Promise<KioskDisplaySettings | null> {
  const row = await db.kioskDisplaySettings.get(SINGLETON_ID);
  return row ?? null;
}

export async function saveKioskDisplaySettings(settings: KioskDisplaySettings): Promise<void> {
  await db.kioskDisplaySettings.put({
    ...settings,
    id: SINGLETON_ID,
    updated_at: now(),
    is_deleted: false,
    synced: false,
  });
}

export async function fetchAuthPolicy(): Promise<AuthPolicy | null> {
  const row = await db.authPolicy.get(SINGLETON_ID);
  return row ?? null;
}

export async function saveAuthPolicy(policy: AuthPolicy): Promise<void> {
  await db.authPolicy.put({ ...policy, id: SINGLETON_ID, updated_at: now(), is_deleted: false, synced: false });
}

export async function fetchLocationPolicy(): Promise<LocationPolicy | null> {
  const row = await db.locationPolicy.get(SINGLETON_ID);
  return row ?? null;
}

export async function saveLocationPolicy(policy: LocationPolicy): Promise<void> {
  await db.locationPolicy.put({
    ...policy,
    id: SINGLETON_ID,
    updated_at: now(),
    is_deleted: false,
    synced: false,
  });
}

// --- Permissions -----------------------------------------------------------

export async function fetchAllPermissionGrants(): Promise<PermissionGrant[]> {
  return db.permissionGrants.filter((g) => !g.is_deleted).toArray();
}

export async function fetchPermissionGrant(uid: string): Promise<PermissionGrant | null> {
  const row = await db.permissionGrants.get(uid);
  return row && !row.is_deleted ? row : null;
}

export async function savePermissionGrant(grant: PermissionGrant): Promise<void> {
  await db.permissionGrants.put({ ...grant, updated_at: now(), is_deleted: false, synced: false });
  await recordActivity(
    "permission.grant",
    "permissionGrants",
    grant.uid,
    `Granted ${grant.permissions.join(", ")} to ${grant.displayName}`
  );
}

export async function revokePermissionGrant(uid: string): Promise<void> {
  const grant = await db.permissionGrants.get(uid);
  await db.permissionGrants.update(uid, { is_deleted: true, updated_at: now(), synced: false });
  await recordActivity(
    "permission.revoke",
    "permissionGrants",
    uid,
    `Revoked permissions from ${grant?.displayName ?? uid}`
  );
}

// --- Announcements -----------------------------------------------------

export async function fetchAnnouncements(limitCount = 20): Promise<Announcement[]> {
  const rows = await db.announcements.filter((a) => !a.is_deleted).toArray();
  return rows.sort((a, b) => b.postedAt.localeCompare(a.postedAt)).slice(0, limitCount);
}

export async function postAnnouncement(announcement: Announcement): Promise<void> {
  await db.announcements.put({
    ...announcement,
    updated_at: now(),
    is_deleted: false,
    synced: false,
  });
}

export async function deleteAnnouncement(announcementId: string): Promise<void> {
  await db.announcements.update(announcementId, { is_deleted: true, updated_at: now(), synced: false });
}

// --- Availability / shift notes ------------------------------------------

export async function fetchMyAvailability(
  weekId: string,
  employeeId: string
): Promise<AvailabilityEntry | null> {
  const row = await db.availability.get(availabilityDocId(weekId, employeeId));
  return row && !row.is_deleted ? row : null;
}

export async function saveAvailability(entry: AvailabilityEntry): Promise<void> {
  await db.availability.put({
    ...entry,
    docId: availabilityDocId(entry.weekId, entry.employeeId),
    updated_at: now(),
    is_deleted: false,
    synced: false,
  });
}

export async function fetchAvailabilityForWeek(weekId: string): Promise<AvailabilityEntry[]> {
  return db.availability
    .where("weekId")
    .equals(weekId)
    .filter((a) => !a.is_deleted)
    .toArray();
}

export async function fetchShiftNotesForWeek(weekId: string): Promise<ShiftNote[]> {
  return db.shiftNotes
    .where("weekId")
    .equals(weekId)
    .filter((n) => !n.is_deleted)
    .toArray();
}

export async function postShiftNote(note: ShiftNote): Promise<void> {
  await db.shiftNotes.put({ ...note, updated_at: now(), is_deleted: false, synced: false });
}

// --- Shift supervisors -----------------------------------------------------

export async function fetchShiftSupervisorPermissionSettings(): Promise<ShiftSupervisorPermissionSettings | null> {
  const row = await db.shiftSupervisorPermissionSettings.get(SINGLETON_ID);
  return row ?? null;
}

export async function saveShiftSupervisorPermissionSettings(
  settings: ShiftSupervisorPermissionSettings
): Promise<void> {
  await db.shiftSupervisorPermissionSettings.put({
    ...settings,
    id: SINGLETON_ID,
    updated_at: now(),
    is_deleted: false,
    synced: false,
  });
}

export async function saveShiftSupervisorGrant(grant: ShiftSupervisorGrant): Promise<void> {
  await db.shiftSupervisorGrants.put({ ...grant, updated_at: now(), is_deleted: false, synced: false });
}

export async function fetchShiftSupervisorGrant(uid: string): Promise<ShiftSupervisorGrant | null> {
  const row = await db.shiftSupervisorGrants.get(uid);
  return row && !row.is_deleted ? row : null;
}

// --- Schedule exemptions -----------------------------------------------

export async function fetchAllScheduleExemptions(): Promise<ScheduleExemption[]> {
  return db.scheduleExemptions.filter((e) => !e.is_deleted).toArray();
}

export async function saveScheduleExemption(exemption: ScheduleExemption): Promise<void> {
  await db.scheduleExemptions.put({
    ...exemption,
    updated_at: now(),
    is_deleted: false,
    synced: false,
  });
  await recordActivity(
    "schedule_exemption.grant",
    "scheduleExemptions",
    exemption.employeeId,
    `Granted a schedule exemption to ${exemption.employeeName}`
  );
}

export async function revokeScheduleExemption(employeeId: string): Promise<void> {
  const exemption = await db.scheduleExemptions.get(employeeId);
  await db.scheduleExemptions.update(employeeId, { is_deleted: true, updated_at: now(), synced: false });
  await recordActivity(
    "schedule_exemption.revoke",
    "scheduleExemptions",
    employeeId,
    `Revoked the schedule exemption for ${exemption?.employeeName ?? employeeId}`
  );
}
