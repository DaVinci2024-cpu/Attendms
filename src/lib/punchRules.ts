import { EARLY_PUNCH_OUT_GRACE_MS, LATE_PUNCH_IN_GRACE_MS } from "./constants";
import { cellAssignments } from "./schedule";
import type { ScheduleColumn, ShiftSupervisor, WeekSchedule } from "./types";

export type ShiftPunchInStatus = "upcoming" | "on_time" | "late" | "unenforced";

export interface ResolvedShift {
  columnId: string;
  columnLabel: string;
  supervisor: ShiftSupervisor | null;
  // ISO timestamp of the shift's end, today — null if the column has no
  // end time set (no early-leave enforcement for that punch-out later).
  scheduledEndIso: string | null;
  status: ShiftPunchInStatus;
}

function dayIndexOf(weekStart: Date, now: Date): number {
  const startMid = new Date(weekStart);
  startMid.setHours(0, 0, 0, 0);
  const nowMid = new Date(now);
  nowMid.setHours(0, 0, 0, 0);
  return Math.round((nowMid.getTime() - startMid.getTime()) / 86400000);
}

function timeOnDate(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

function todayRow(schedule: WeekSchedule | null, weekStart: Date, now: Date) {
  if (!schedule) return null;
  const index = dayIndexOf(weekStart, now);
  if (index < 0 || index > 6) return null;
  return schedule.rows[index] ?? null;
}

function resolveColumnStatus(
  col: ScheduleColumn,
  now: Date
): Omit<ResolvedShift, "supervisor"> {
  if (!col.startTime || !col.endTime) {
    return {
      columnId: col.columnId,
      columnLabel: col.label,
      scheduledEndIso: null,
      status: "unenforced",
    };
  }
  const start = timeOnDate(now, col.startTime);
  const end = timeOnDate(now, col.endTime);
  let status: ShiftPunchInStatus;
  if (now.getTime() < start.getTime()) {
    status = "upcoming";
  } else if (now.getTime() <= start.getTime() + LATE_PUNCH_IN_GRACE_MS) {
    status = "on_time";
  } else {
    status = "late";
  }
  return { columnId: col.columnId, columnLabel: col.label, scheduledEndIso: end.toISOString(), status };
}

// Finds which of today's shifts (if any) this employee is assigned to,
// for the purpose of a punch-in right now. Returns null if they aren't
// scheduled for anything today at all. When assigned to more than one
// shift today, prefers whichever one is currently valid (upcoming/on
// time/unenforced) over one they're already late for.
export function resolveShiftForPunchIn(
  schedule: WeekSchedule | null,
  weekStart: Date,
  employeeId: string,
  now: Date
): ResolvedShift | null {
  const row = todayRow(schedule, weekStart, now);
  if (!row || !schedule) return null;

  const assignedColumns = schedule.columns.filter((col) =>
    cellAssignments(row.cells, col.columnId).some((a) => a.employeeId === employeeId)
  );
  if (assignedColumns.length === 0) return null;

  const candidates = assignedColumns.map((col) => resolveColumnStatus(col, now));
  const chosen = candidates.find((c) => c.status !== "late") ?? candidates[0];
  const supervisor = row.supervisors?.[chosen.columnId] ?? null;
  return { ...chosen, supervisor };
}

export function isPunchInAllowed(resolution: ResolvedShift | null): boolean {
  return resolution !== null && resolution.status !== "late";
}

export function isEarlyPunchOut(
  scheduledEndIso: string | null | undefined,
  now: Date
): boolean {
  if (!scheduledEndIso) return false;
  return now.getTime() < new Date(scheduledEndIso).getTime() - EARLY_PUNCH_OUT_GRACE_MS;
}

// For an unscheduled walk-in punch-in — there's no specific shift to key
// an override off, so whoever is the designated supervisor of any shift
// actually running right now (time-wise) is who approves it. Returns null
// if nothing with both a supervisor and a live time window is running.
export function findCurrentSupervisor(
  schedule: WeekSchedule | null,
  weekStart: Date,
  now: Date
): ShiftSupervisor | null {
  const row = todayRow(schedule, weekStart, now);
  if (!row || !schedule) return null;
  for (const col of schedule.columns) {
    const supervisor = row.supervisors?.[col.columnId];
    if (!supervisor || !col.startTime || !col.endTime) continue;
    const start = timeOnDate(now, col.startTime);
    const end = timeOnDate(now, col.endTime);
    if (now.getTime() >= start.getTime() && now.getTime() < end.getTime()) {
      return supervisor;
    }
  }
  return null;
}
