import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  type CollectionReference,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { COMPANY_ID, COMPANY_NAME, ADMIN_EMAIL } from "./constants";
import type { Employee, AttendanceLog, SuspiciousEvent, Company } from "./types";

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

export async function createEmployee(employee: Employee): Promise<void> {
  await setDoc(doc(employeesCol(), employee.employeeId), employee);
}

export async function fetchAllEmployees(): Promise<Employee[]> {
  const snapshot = await getDocs(employeesCol());
  return snapshot.docs.map((d) => d.data() as Employee);
}

// Employee-initiated deletion path (spec Section 5): removes the
// descriptors and consent record entirely, independent of just flipping
// active:false. Historical attendance logs (name + timestamp only, no
// biometric data) are left in place.
export async function deleteEmployee(employeeId: string): Promise<void> {
  await deleteDoc(doc(employeesCol(), employeeId));
}

// Every attendance record is fetched (served from the local IndexedDB cache
// when offline) and filtered/sorted client-side in lib/punchLogic.ts, rather
// than via a `where` + `orderBy` composite query — this keeps punch-direction
// decisions working correctly on a kiosk that has never had a network
// connection since its last cache clear, with no Firestore index requirement.
export async function fetchAllAttendance(): Promise<AttendanceLog[]> {
  const snapshot = await getDocs(attendanceCol());
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
