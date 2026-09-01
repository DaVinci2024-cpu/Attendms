import { cellAssignments } from "./schedule";
import { toWeekId } from "./week";
import type { AttendanceLog, Employee, WeekSchedule } from "./types";

// How much an edited/corrected record counts against the attendance rate.
// e.g. 0.3 means an employee whose every session needed a correction loses
// up to 30 points even with perfect attendance.
const EDIT_PENALTY_WEIGHT = 0.3;

export interface EmployeePerformance {
  employeeId: string;
  employeeName: string;
  scheduledDays: number;
  workedDays: number;
  missedDays: number;
  sessionsWorked: number; // total punch_ins in the period, schedule or not
  editsCount: number; // total correction events across their records
  attendanceRate: number | null; // 0-100; null if never scheduled this period
  score: number | null; // 0-100; null if never scheduled this period
}

// Simple, explainable v1: no shift-level start/end times exist yet, so
// "performance" here means day-level schedule coverage (did they show up
// on a day they were assigned to any shift) plus how often their records
// needed a supervisor correction — not minute-level lateness.
//
// A schedule row's real calendar date is assumed to be its week's Monday
// plus its index (0 = Monday .. 6 = Sunday), matching how rows are
// auto-generated — true unless an admin has reordered days or added rows
// beyond the standard 7, in which case index >= 7 is skipped rather than
// guessed at.
export function computeEmployeePerformance(
  employees: Employee[],
  schedules: WeekSchedule[],
  attendanceLogs: AttendanceLog[]
): EmployeePerformance[] {
  const scheduledByDate = new Map<string, Set<string>>();
  for (const schedule of schedules) {
    const weekStart = new Date(`${schedule.weekId}T00:00:00`);
    schedule.rows.forEach((row, index) => {
      if (index > 6) return;
      const date = new Date(weekStart);
      date.setDate(date.getDate() + index);
      const dateKey = toWeekId(date);
      for (const columnId of Object.keys(row.cells)) {
        for (const assignment of cellAssignments(row.cells, columnId)) {
          let set = scheduledByDate.get(dateKey);
          if (!set) {
            set = new Set();
            scheduledByDate.set(dateKey, set);
          }
          set.add(assignment.employeeId);
        }
      }
    });
  }

  const workedByDate = new Map<string, Set<string>>();
  const sessionsWorked = new Map<string, number>();
  const editsCount = new Map<string, number>();
  for (const log of attendanceLogs) {
    if (log.type === "punch_in") {
      const dateKey = toWeekId(new Date(log.timestamp));
      let set = workedByDate.get(dateKey);
      if (!set) {
        set = new Set();
        workedByDate.set(dateKey, set);
      }
      set.add(log.employeeId);
      sessionsWorked.set(log.employeeId, (sessionsWorked.get(log.employeeId) ?? 0) + 1);
    }
    if (log.edits && log.edits.length > 0) {
      editsCount.set(
        log.employeeId,
        (editsCount.get(log.employeeId) ?? 0) + log.edits.length
      );
    }
  }

  return employees.map((emp) => {
    let scheduledDays = 0;
    let workedDays = 0;
    for (const [dateKey, scheduledIds] of scheduledByDate) {
      if (!scheduledIds.has(emp.employeeId)) continue;
      scheduledDays += 1;
      if (workedByDate.get(dateKey)?.has(emp.employeeId)) workedDays += 1;
    }

    const sessions = sessionsWorked.get(emp.employeeId) ?? 0;
    const edits = editsCount.get(emp.employeeId) ?? 0;
    const attendanceRate = scheduledDays > 0 ? (workedDays / scheduledDays) * 100 : null;
    const editRate = sessions > 0 ? edits / sessions : 0;
    const score =
      attendanceRate === null
        ? null
        : Math.max(0, Math.min(100, attendanceRate - editRate * 100 * EDIT_PENALTY_WEIGHT));

    return {
      employeeId: emp.employeeId,
      employeeName: emp.fullName,
      scheduledDays,
      workedDays,
      missedDays: scheduledDays - workedDays,
      sessionsWorked: sessions,
      editsCount: edits,
      attendanceRate,
      score,
    };
  });
}

export function averageScore(rows: EmployeePerformance[]): number | null {
  const scored = rows.filter((r): r is EmployeePerformance & { score: number } => r.score !== null);
  if (scored.length === 0) return null;
  return scored.reduce((sum, r) => sum + r.score, 0) / scored.length;
}
