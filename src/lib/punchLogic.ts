import type { AttendanceLog, PunchType } from "./types";

/**
 * Punch direction is derived from the employee's most recent *locally
 * cached* log, never assumed — this is what lets it work correctly while
 * fully offline (spec Section 3, Flow B step 5). With no prior log this
 * device knows about, the employee is treated as starting a new punch_in.
 */
export function nextPunchType(
  employeeId: string,
  cachedLogs: AttendanceLog[]
): PunchType {
  const mostRecent = cachedLogs
    .filter((log) => log.employeeId === employeeId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];

  if (!mostRecent) return "punch_in";
  return mostRecent.type === "punch_in" ? "punch_out" : "punch_in";
}
