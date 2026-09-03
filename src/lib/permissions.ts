import type { Permission, PermissionGrant, ScheduleExemption } from "./types";

// Shared by anything with a PermissionGrant-shaped temporary-access
// window (a null expiresAtMillis means permanent; a null/absent
// startsAtMillis means "already started").
export function isWithinWindow(
  startsAtMillis: number | null | undefined,
  expiresAtMillis: number | null | undefined
): boolean {
  const now = Date.now();
  const started = startsAtMillis == null || startsAtMillis <= now;
  const notExpired = expiresAtMillis == null || expiresAtMillis > now;
  return started && notExpired;
}

export function grantIsActive(grant: PermissionGrant | null): boolean {
  return grant !== null && isWithinWindow(grant.startsAtMillis, grant.expiresAtMillis);
}

export function grantHas(grant: PermissionGrant | null, permission: Permission): boolean {
  return grantIsActive(grant) && (grant?.permissions.includes(permission) ?? false);
}

export function scheduleExemptionIsActive(exemption: ScheduleExemption | null): boolean {
  return (
    exemption !== null && isWithinWindow(exemption.startsAtMillis, exemption.expiresAtMillis)
  );
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  manage_employees: "Manage employees (enroll, delete, portal logins)",
  manage_schedule: "Manage schedule",
  edit_attendance: "Edit attendance records",
  manage_kiosk_settings: "Manage kiosk display",
  view_reports: "View reports",
  manage_permissions: "Manage roles & permissions",
  manage_announcements: "Post announcements",
  manage_schedule_exemptions: "Let employees punch in without a schedule",
};

export const ALL_PERMISSIONS: Permission[] = [
  "manage_employees",
  "manage_schedule",
  "edit_attendance",
  "manage_kiosk_settings",
  "view_reports",
  "manage_permissions",
  "manage_announcements",
  "manage_schedule_exemptions",
];

// Named permission bundles offered as a starting point when granting
// someone temporary or permanent access — picking one just fills in the
// permission checkboxes below it, still freely editable afterwards. Not
// a stored/managed entity of its own; the grant that gets saved is a
// flat permissions array either way, same as picking permissions by hand.
export interface RolePreset {
  id: string;
  label: string;
  description: string;
  permissions: Permission[];
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    id: "scheduler",
    label: "Scheduler",
    description: "Build and edit the weekly schedule.",
    permissions: ["manage_schedule"],
  },
  {
    id: "supervisor",
    label: "Supervisor",
    description: "Manage the schedule, correct attendance, and view reports.",
    permissions: ["manage_schedule", "edit_attendance", "view_reports"],
  },
  {
    id: "attendance_editor",
    label: "Attendance editor",
    description: "Correct punch records and let specific employees punch in without a schedule.",
    permissions: ["edit_attendance", "manage_schedule_exemptions"],
  },
  {
    id: "viewer",
    label: "Viewer",
    description: "Read-only access to reports.",
    permissions: ["view_reports"],
  },
  {
    id: "full_manager",
    label: "Full manager",
    description: "Everything except managing other people's permissions.",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "manage_permissions"),
  },
];
