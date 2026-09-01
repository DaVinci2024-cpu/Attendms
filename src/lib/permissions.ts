import type { Permission, PermissionGrant } from "./types";

export function grantIsActive(grant: PermissionGrant | null): boolean {
  if (!grant) return false;
  return grant.expiresAtMillis === null || grant.expiresAtMillis > Date.now();
}

export function grantHas(grant: PermissionGrant | null, permission: Permission): boolean {
  return grantIsActive(grant) && (grant?.permissions.includes(permission) ?? false);
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  manage_employees: "Manage employees (enroll, delete, portal logins)",
  manage_schedule: "Manage schedule",
  edit_attendance: "Edit attendance records",
  manage_kiosk_settings: "Manage kiosk display",
  view_reports: "View reports",
  manage_permissions: "Manage roles & permissions",
  manage_announcements: "Post announcements",
};

export const ALL_PERMISSIONS: Permission[] = [
  "manage_employees",
  "manage_schedule",
  "edit_attendance",
  "manage_kiosk_settings",
  "view_reports",
  "manage_permissions",
  "manage_announcements",
];
