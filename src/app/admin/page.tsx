"use client";

import Link from "next/link";
import {
  CalendarDays,
  LayoutDashboard,
  Settings,
  UserPlus,
  Users,
} from "lucide-react";
import { RequireAdmin } from "@/components/RequireAdmin";

export default function AdminHomePage() {
  return (
    <RequireAdmin>
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-sm text-neutral-400">
            Everything for running this company&apos;s attendance system.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/admin/dashboard"
            className="flex items-center gap-3 rounded-xl bg-neutral-900 p-5 transition hover:bg-neutral-800"
          >
            <LayoutDashboard className="h-6 w-6 text-amber-400" />
            <div>
              <p className="font-medium">Attendance dashboard</p>
              <p className="text-sm text-neutral-400">
                Who&apos;s clocked in, punch history, hours worked
              </p>
            </div>
          </Link>

          <Link
            href="/admin/schedule"
            className="flex items-center gap-3 rounded-xl bg-neutral-900 p-5 transition hover:bg-neutral-800"
          >
            <CalendarDays className="h-6 w-6 text-pink-400" />
            <div>
              <p className="font-medium">Schedule</p>
              <p className="text-sm text-neutral-400">
                Spreadsheet-style weekly schedule editor
              </p>
            </div>
          </Link>

          <Link
            href="/enroll"
            className="flex items-center gap-3 rounded-xl bg-neutral-900 p-5 transition hover:bg-neutral-800"
          >
            <UserPlus className="h-6 w-6 text-blue-400" />
            <div>
              <p className="font-medium">Enroll employee</p>
              <p className="text-sm text-neutral-400">
                Capture face snapshots, PIN, and consent
              </p>
            </div>
          </Link>

          <Link
            href="/admin/employees"
            className="flex items-center gap-3 rounded-xl bg-neutral-900 p-5 transition hover:bg-neutral-800"
          >
            <Users className="h-6 w-6 text-purple-400" />
            <div>
              <p className="font-medium">Manage employees</p>
              <p className="text-sm text-neutral-400">
                View enrolled employees, portal logins, delete a profile
              </p>
            </div>
          </Link>

          <Link
            href="/admin/kiosk-settings"
            className="flex items-center gap-3 rounded-xl bg-neutral-900 p-5 transition hover:bg-neutral-800 sm:col-span-2"
          >
            <Settings className="h-6 w-6 text-cyan-400" />
            <div>
              <p className="font-medium">Kiosk display</p>
              <p className="text-sm text-neutral-400">
                Customize the headline and notice shown on the kiosk screen
              </p>
            </div>
          </Link>
        </div>
      </div>
    </RequireAdmin>
  );
}
