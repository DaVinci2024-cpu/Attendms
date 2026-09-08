import { EARLY_PUNCH_OUT_GRACE_MS, LATE_PUNCH_IN_GRACE_MS } from "./constants";
import { companyFields, companyTimeToUtc } from "./companyTime";
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

// Day index (0 = the week's Monday .. 6 = Sunday) that `now` falls on,
// counted by Kampala calendar days — not the viewing device's own
// timezone, so which schedule row is "today" doesn't depend on where
// whoever's looking happens to be.
export function dayIndexOf(weekStart: Date, now: Date): number {
  const start = companyFields(weekStart);
  const startMid = companyTimeToUtc(start.year, start.month, start.day);
  const n = companyFields(now);
  const nowMid = companyTimeToUtc(n.year, n.month, n.day);
  return Math.round((nowMid.getTime() - startMid.getTime()) / 86400000);
}

// A real instant for "hh:mm on `date`'s calendar day", both read in
// Kampala time — e.g. a shift's 08:00 start time anchored onto today,
// regardless of the browser's own timezone.
export function timeOnDate(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const { year, month, day } = companyFields(date);
  return companyTimeToUtc(year, month, day, h, m);
}

// A shift's start+end anchored onto `date`'s Kampala calendar day — end
// rolls onto the NEXT calendar day whenever it isn't after start (an
// overnight shift, e.g. "19:00"-"08:00"), so the window always runs
// forward in time instead of coming out backwards/empty.
export function shiftWindowOnDate(
  date: Date,
  startHHMM: string,
  endHHMM: string
): { start: Date; end: Date } {
  const start = timeOnDate(date, startHHMM);
  let end = timeOnDate(date, endHHMM);
  if (end.getTime() <= start.getTime()) {
    const { year, month, day } = companyFields(date);
    const [h, m] = endHHMM.split(":").map(Number);
    end = companyTimeToUtc(year, month, day + 1, h, m);
  }
  return { start, end };
}

export function todayRow(schedule: WeekSchedule | null, weekStart: Date, now: Date) {
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
  const { start, end } = shiftWindowOnDate(now, col.startTime, col.endTime);
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
    const { start, end } = shiftWindowOnDate(now, col.startTime, col.endTime);
    if (now.getTime() >= start.getTime() && now.getTime() < end.getTime()) {
      return supervisor;
    }
  }
  return null;
}
