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
  updateDoc,
  arrayUnion,
  type CollectionReference,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { COMPANY_ID, COMPANY_NAME, ADMIN_EMAIL } from "./constants";
import type {
  Employee,
  AttendanceLog,
  SuspiciousEvent,
  Company,
  WeekSchedule,
  KioskDisplaySettings,
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

function kioskDisplayDoc() {
  return doc(getDb(), "companies", COMPANY_ID, "settings", "kioskDisplay");
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

export async function fetchKioskDisplaySettings(): Promise<KioskDisplaySettings | null> {
  const snapshot = await getDoc(kioskDisplayDoc());
  return snapshot.exists() ? (snapshot.data() as KioskDisplaySettings) : null;
}

export async function saveKioskDisplaySettings(
  settings: KioskDisplaySettings
): Promise<void> {
  await setDoc(kioskDisplayDoc(), settings);
}
