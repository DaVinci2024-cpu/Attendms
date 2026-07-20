import {
  collection,
  doc,
  setDoc,
  getDocs,
  type CollectionReference,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { DEMO_COMPANY_ID } from "./constants";
import type { Employee, AttendanceLog, SuspiciousEvent } from "./types";

function employeesCol(): CollectionReference {
  return collection(getDb(), "companies", DEMO_COMPANY_ID, "employees");
}

function attendanceCol(): CollectionReference {
  return collection(getDb(), "companies", DEMO_COMPANY_ID, "attendance");
}

function suspiciousEventsCol(): CollectionReference {
  return collection(
    getDb(),
    "companies",
    DEMO_COMPANY_ID,
    "suspiciousEvents"
  );
}

export async function createEmployee(employee: Employee): Promise<void> {
  await setDoc(doc(employeesCol(), employee.employeeId), employee);
}

export async function fetchAllEmployees(): Promise<Employee[]> {
  const snapshot = await getDocs(employeesCol());
  return snapshot.docs.map((d) => d.data() as Employee);
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
