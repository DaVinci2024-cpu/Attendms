import type { ScheduleAssignment } from "./types";

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
