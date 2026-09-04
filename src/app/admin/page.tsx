"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { RequireAdmin, usePermissions } from "@/components/RequireAdmin";
import { PageHeader } from "@/components/PageHeader";

export default function AdminHomePage() {
  return (
    <RequireAdmin>
      <AdminHub />
    </RequireAdmin>
  );
}

const TILE_ICON_CLASSES = {
  amber: "bg-amber-500/15 text-amber-400",
  pink: "bg-pink-500/15 text-pink-400",
  blue: "bg-blue-500/15 text-blue-400",
  purple: "bg-purple-500/15 text-purple-400",
  cyan: "bg-cyan-500/15 text-cyan-400",
  rose: "bg-rose-500/15 text-rose-400",
} as const;

function HubTile({
  href,
  icon: Icon,
  color,
  title,
  description,
}: {
  href: string;
  icon: LucideIcon;
  color: keyof typeof TILE_ICON_CLASSES;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-xl bg-neutral-900 p-5 transition hover:-translate-y-0.5 hover:bg-neutral-800 hover:shadow-lg hover:shadow-black/30"
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition group-hover:scale-105 ${TILE_ICON_CLASSES[color]}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-neutral-400">{description}</p>
      </div>
    </Link>
  );
}

function AdminHub() {
  const { has } = usePermissions();

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        title="Admin"
        subtitle="Everything for running this company's attendance system."
        accent="violet"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {(has("view_reports") || has("edit_attendance")) && (
          <HubTile
            href="/admin/dashboard"
            icon={LayoutDashboard}
            color="amber"
            title="Attendance dashboard"
            description="Who's clocked in, punch history, hours worked"
          />
        )}

        {has("manage_schedule") && (
          <HubTile
            href="/admin/schedule"
            icon={CalendarDays}
            color="pink"
            title="Schedule"
            description="Spreadsheet-style weekly schedule editor"
          />
        )}

        {has("manage_employees") && (
          <HubTile
            href="/enroll"
            icon={UserPlus}
            color="blue"
            title="Enroll employee"
            description="Set a name, PIN, and optional face snapshots"
          />
        )}

        {has("manage_employees") && (
          <HubTile
            href="/admin/employees"
            icon={Users}
            color="purple"
            title="Manage employees"
            description="View enrolled employees, portal logins, delete a profile"
          />
        )}

        {has("manage_kiosk_settings") && (
          <HubTile
            href="/admin/kiosk-settings"
            icon={Settings}
            color="cyan"
            title="Kiosk display"
            description="Customize the headline and notice shown on the kiosk screen"
          />
        )}

        {has("manage_permissions") && (
          <HubTile
            href="/admin/permissions"
            icon={ShieldCheck}
            color="rose"
            title="Roles & permissions"
            description="Grant admins/employees specific capabilities, with optional time limits"
          />
        )}
      </div>
    </div>
  );
}
