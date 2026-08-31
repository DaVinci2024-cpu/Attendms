import type { AttendanceLog } from "./types";

export interface WorkSession {
  employeeId: string;
  employeeName: string;
  punchIn: AttendanceLog;
  punchOut: AttendanceLog | null; // null = still clocked in
  durationMs: number | null;
}

/**
 * Pairs each punch_in with the next punch_out for the same employee, in
 * chronological order. A trailing punch_in with no punch_out yet becomes a
 * session with punchOut: null (i.e. "currently clocked in").
 */
export function pairSessions(logs: AttendanceLog[]): WorkSession[] {
  const byEmployee = new Map<string, AttendanceLog[]>();
  for (const log of logs) {
    const list = byEmployee.get(log.employeeId) ?? [];
    list.push(log);
    byEmployee.set(log.employeeId, list);
  }

  const sessions: WorkSession[] = [];
  for (const employeeLogs of byEmployee.values()) {
    const sorted = [...employeeLogs].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    );

    let pendingIn: AttendanceLog | null = null;
    for (const log of sorted) {
      if (log.type === "punch_in") {
        // An unmatched prior punch_in (shouldn't happen with correct
        // direction logic, but don't silently drop data if it does).
        if (pendingIn) {
          sessions.push({
            employeeId: pendingIn.employeeId,
            employeeName: pendingIn.employeeName,
            punchIn: pendingIn,
            punchOut: null,
            durationMs: null,
          });
        }
        pendingIn = log;
      } else if (log.type === "punch_out" && pendingIn) {
        const durationMs =
          new Date(log.timestamp).getTime() -
          new Date(pendingIn.timestamp).getTime();
        sessions.push({
          employeeId: pendingIn.employeeId,
          employeeName: pendingIn.employeeName,
          punchIn: pendingIn,
          punchOut: log,
          durationMs,
        });
        pendingIn = null;
      }
    }

    if (pendingIn) {
      sessions.push({
        employeeId: pendingIn.employeeId,
        employeeName: pendingIn.employeeName,
        punchIn: pendingIn,
        punchOut: null,
        durationMs: null,
      });
    }
  }

  return sessions.sort((a, b) =>
    b.punchIn.timestamp.localeCompare(a.punchIn.timestamp)
  );
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}
