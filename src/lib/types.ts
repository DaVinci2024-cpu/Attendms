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
}

export type PunchType = "punch_in" | "punch_out";

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

export interface Shift {
  shiftId: string;
  employeeId: string;
  date: string; // YYYY-MM-DD, local calendar date of the shift
  startTime: string; // HH:mm, 24h
  endTime: string; // HH:mm, 24h
  notes: string;
  createdAt: string;
}

export interface Company {
  companyId: string;
  companyName: string;
  adminEmail: string;
  createdAt: string;
}

export interface Kiosk {
  kioskId: string;
  label: string;
  pairedAt: string;
  lastSeenAt: string;
  active: boolean;
}
