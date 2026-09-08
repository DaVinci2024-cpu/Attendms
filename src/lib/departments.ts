import { DEPARTMENT_PRESETS } from "./constants";

// The catch-all bucket for a column or employee with no department set —
// used consistently by the dashboard's sector summary and the schedule
// page's department tabs so both agree on how to group the unassigned.
export const UNASSIGNED_DEPARTMENT = "Unassigned";

// Known departments sort first (in this order), then anything custom
// alphabetically, "Unassigned" always last.
export function departmentSortKey(department: string): string {
  const presetIndex = (DEPARTMENT_PRESETS as readonly string[]).indexOf(department);
  if (department === UNASSIGNED_DEPARTMENT) return "zzz";
  if (presetIndex >= 0) return `0${presetIndex}`;
  return `1${department}`;
}

export function sortDepartments(departments: Iterable<string>): string[] {
  return Array.from(new Set(departments)).sort((a, b) =>
    departmentSortKey(a).localeCompare(departmentSortKey(b))
  );
}
