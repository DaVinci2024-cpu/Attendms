import { companyDateKey, companyFields, companyTimeToUtc } from "./companyTime";
import { cellAssignments } from "./schedule";
import { todayRow, timeOnDate, shiftWindowOnDate } from "./punchRules";
import type { AttendanceLog, ScheduleColumn, ScheduleRow, WeekSchedule } from "./types";

export interface ShiftWindow {
  column: ScheduleColumn;
  row: ScheduleRow;
  start: Date;
  end: Date;
}

function timedWindowsForRow(
  row: ScheduleRow,
  columns: ScheduleColumn[],
  date: Date
): ShiftWindow[] {
  const windows: ShiftWindow[] = [];
  for (const col of columns) {
    if (!col.startTime || !col.endTime) continue;
    const { start, end } = shiftWindowOnDate(date, col.startTime, col.endTime);
    windows.push({ column: col, row, start, end });
  }
  return windows;
}

// Every timed shift running right now — there can be more than one with
// overlapping columns. Empty if nothing's scheduled today, or nothing
// timed is currently active. Also checks yesterday's row for an overnight
// shift (e.g. 19:00-08:00) that started yesterday and hasn't ended yet —
// `now`'s own calendar day would otherwise resolve to today's row only,
// missing a shift still running into the early hours.
export function activeShifts(
  schedule: WeekSchedule | null,
  weekStart: Date,
  now: Date
): ShiftWindow[] {
  if (!schedule) return [];
  const active: ShiftWindow[] = [];

  const row = todayRow(schedule, weekStart, now);
  if (row) {
    active.push(
      ...timedWindowsForRow(row, schedule.columns, now).filter(
        (w) => now.getTime() >= w.start.getTime() && now.getTime() < w.end.getTime()
      )
    );
  }

  const nf = companyFields(now);
  const yesterday = companyTimeToUtc(nf.year, nf.month, nf.day - 1);
  const yesterdaysRow = todayRow(schedule, weekStart, yesterday);
  if (yesterdaysRow) {
    active.push(
      ...timedWindowsForRow(yesterdaysRow, schedule.columns, yesterday).filter(
        (w) => now.getTime() >= w.start.getTime() && now.getTime() < w.end.getTime()
      )
    );
  }

  return active;
}

// The single shift that most recently finished as of `now` — today's
// latest-ending column that's already over, or (before anything's ended
// yet today, e.g. early morning) yesterday's last one. Null if neither
// day has a timed shift at all. Doesn't look back further than
// yesterday, and yesterday's row only resolves within the same
// calendar week as `weekStart` — a shift ending right after midnight on
// a Monday won't find last Sunday's, which belongs to the prior week.
export function mostRecentlyEndedShift(
  schedule: WeekSchedule | null,
  weekStart: Date,
  now: Date
): ShiftWindow | null {
  if (!schedule) return null;
  const todaysRow = todayRow(schedule, weekStart, now);
  if (todaysRow) {
    const ended = timedWindowsForRow(todaysRow, schedule.columns, now)
      .filter((w) => w.end.getTime() <= now.getTime())
      .sort((a, b) => b.end.getTime() - a.end.getTime());
    if (ended.length > 0) return ended[0];
  }
  const nf = companyFields(now);
  const yesterday = companyTimeToUtc(nf.year, nf.month, nf.day - 1);
  const yesterdaysRow = todayRow(schedule, weekStart, yesterday);
  if (!yesterdaysRow) return null;
  const windows = timedWindowsForRow(yesterdaysRow, schedule.columns, yesterday).sort(
    (a, b) => b.end.getTime() - a.end.getTime()
  );
  return windows[0] ?? null;
}

export interface ShiftAttendanceSummary {
  shiftLabel: string;
  start: Date;
  end: Date;
  scheduledCount: number;
  presentCount: number;
  scheduled: { employeeId: string; employeeName: string; present: boolean }[];
}

// Headcount for one or more (concurrent) shift windows — who's scheduled
// across them (deduped) and how many of those `isPresent` says yes to.
// The caller decides what "present" means: currently clocked in, for a
// still-running shift, or "punched in at all during the window", for one
// that's already over — see the two call sites in the dashboard.
export function summarizeShiftAttendance(
  windows: ShiftWindow[],
  isPresent: (employeeId: string) => boolean
): ShiftAttendanceSummary | null {
  if (windows.length === 0) return null;
  const start = new Date(Math.min(...windows.map((w) => w.start.getTime())));
  const end = new Date(Math.max(...windows.map((w) => w.end.getTime())));
  const scheduled = new Map<
    string,
    { employeeId: string; employeeName: string; present: boolean }
  >();
  for (const w of windows) {
    for (const a of cellAssignments(w.row.cells, w.column.columnId)) {
      if (!scheduled.has(a.employeeId)) {
        scheduled.set(a.employeeId, {
          employeeId: a.employeeId,
          employeeName: a.employeeName,
          present: isPresent(a.employeeId),
        });
      }
    }
  }
  const list = Array.from(scheduled.values());
  return {
    shiftLabel: windows.map((w) => w.column.label).join(" + "),
    start,
    end,
    scheduledCount: list.length,
    presentCount: list.filter((s) => s.present).length,
    scheduled: list,
  };
}

// Whether an employeeId punched in at any point inside [start, end) —
// used to judge a shift that's already over ("did they show up at all"),
// as opposed to "currently clocked in" which only makes sense for one
// that's still running.
export function presentDuringWindow(
  logs: AttendanceLog[],
  start: Date,
  end: Date
): (employeeId: string) => boolean {
  const present = new Set<string>();
  for (const log of logs) {
    if (log.type !== "punch_in") continue;
    const t = new Date(log.timestamp).getTime();
    if (t >= start.getTime() && t < end.getTime()) present.add(log.employeeId);
  }
  return (employeeId) => present.has(employeeId);
}

export interface NoShow {
  employeeId: string;
  employeeName: string;
  columnLabel: string;
  startTime: string;
}

// Anyone on today's schedule for a shift whose start (plus the same
// late-arrival grace the kiosk itself uses) has already passed, who
// hasn't punched in at all yet today — not tied to which specific shift
// they eventually clock into if they're scheduled for more than one,
// just "have they shown up today at all". An employee already flagged
// under an earlier shift isn't listed again for a later one.
export function noShowsToday(
  schedule: WeekSchedule | null,
  weekStart: Date,
  now: Date,
  logs: AttendanceLog[],
  lateGraceMs: number
): NoShow[] {
  const row = todayRow(schedule, weekStart, now);
  if (!row || !schedule) return [];
  const todayKey = companyDateKey(now);
  const punchedInToday = new Set(
    logs
      .filter((l) => l.type === "punch_in" && companyDateKey(new Date(l.timestamp)) === todayKey)
      .map((l) => l.employeeId)
  );
  const seen = new Set<string>();
  const result: NoShow[] = [];
  for (const col of schedule.columns) {
    if (!col.startTime) continue;
    const start = timeOnDate(now, col.startTime);
    if (now.getTime() < start.getTime() + lateGraceMs) continue;
    for (const a of cellAssignments(row.cells, col.columnId)) {
      if (seen.has(a.employeeId) || punchedInToday.has(a.employeeId)) continue;
      seen.add(a.employeeId);
      result.push({
        employeeId: a.employeeId,
        employeeName: a.employeeName,
        columnLabel: col.label,
        startTime: col.startTime,
      });
    }
  }
  return result;
}

export interface DepartmentShiftSummary {
  columnLabel: string;
  start: Date;
  end: Date;
  scheduledCount: number;
  presentCount: number;
  scheduled: { employeeId: string; employeeName: string; present: boolean }[];
}

// Today's timed shifts, grouped by department — no separate "rotation
// count" config needed per department (doctors run 3 a day, nurses 2,
// etc.): the schedule itself already implies it, however many of today's
// columns actually have someone from that department assigned. Anyone
// with no department set groups under "Unassigned".
export function summarizeDayByDepartment(
  schedule: WeekSchedule | null,
  weekStart: Date,
  now: Date,
  logs: AttendanceLog[],
  departmentByEmployeeId: Map<string, string>
): Map<string, DepartmentShiftSummary[]> {
  const result = new Map<string, DepartmentShiftSummary[]>();
  const row = todayRow(schedule, weekStart, now);
  if (!row || !schedule) return result;
  for (const col of schedule.columns) {
    if (!col.startTime || !col.endTime) continue;
    const { start, end } = shiftWindowOnDate(now, col.startTime, col.endTime);
    const isPresent = presentDuringWindow(logs, start, end);
    const byDept = new Map<
      string,
      { scheduled: number; present: number; roster: DepartmentShiftSummary["scheduled"] }
    >();
    for (const a of cellAssignments(row.cells, col.columnId)) {
      const dept = departmentByEmployeeId.get(a.employeeId) ?? "Unassigned";
      const counts = byDept.get(dept) ?? { scheduled: 0, present: 0, roster: [] };
      const present = isPresent(a.employeeId);
      counts.scheduled += 1;
      if (present) counts.present += 1;
      counts.roster.push({ employeeId: a.employeeId, employeeName: a.employeeName, present });
      byDept.set(dept, counts);
    }
    for (const [dept, counts] of byDept) {
      const list = result.get(dept) ?? [];
      list.push({
        columnLabel: col.label,
        start,
        end,
        scheduledCount: counts.scheduled,
        presentCount: counts.present,
        scheduled: counts.roster,
      });
      result.set(dept, list);
    }
  }
  for (const list of result.values()) {
    list.sort((a, b) => a.start.getTime() - b.start.getTime());
  }
  return result;
}

export interface UpcomingShift {
  columnLabel: string;
  start: Date;
  end: Date;
  dayLabel: string;
}

// The next timed shift this employee is assigned to, starting from
// `now` — the rest of today first, then each following day within the
// same posted week (doesn't look into next week's schedule). Null if
// nothing timed remains this week, or nothing's assigned to them at all.
export function nextScheduledShift(
  schedule: WeekSchedule | null,
  weekStart: Date,
  now: Date,
  employeeId: string
): UpcomingShift | null {
  if (!schedule) return null;
  const nf = companyFields(now);
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const date = companyTimeToUtc(nf.year, nf.month, nf.day + dayOffset);
    const row = todayRow(schedule, weekStart, date);
    if (!row) continue;
    const windows = timedWindowsForRow(row, schedule.columns, date)
      .filter((w) =>
        cellAssignments(row.cells, w.column.columnId).some((a) => a.employeeId === employeeId)
      )
      .filter((w) => dayOffset > 0 || w.start.getTime() > now.getTime())
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    if (windows.length > 0) {
      const w = windows[0];
      return { columnLabel: w.column.label, start: w.start, end: w.end, dayLabel: row.label };
    }
  }
  return null;
}
