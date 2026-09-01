import type { ScheduleAssignment, ScheduleColumn } from "./types";

// A cell written before the multi-employee redesign holds a plain string
// (a typed name) instead of ScheduleAssignment[] — reading one of those
// old cells returns "no assignments" rather than crashing.
export function cellAssignments(
  cells: Record<string, ScheduleAssignment[]>,
  columnId: string
): ScheduleAssignment[] {
  const value = cells[columnId];
  return Array.isArray(value) ? value : [];
}

// Used the first time a company ever sets up a schedule — before any
// standard column template has been saved.
export function defaultColumns(): ScheduleColumn[] {
  return [{ columnId: `col_${crypto.randomUUID()}`, label: "Shift" }];
}
