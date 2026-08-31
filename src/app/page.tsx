import Link from "next/link";
import {
  CalendarDays,
  LayoutDashboard,
  LogIn,
  ScanFace,
  UserPlus,
  Users,
} from "lucide-react";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-black px-6 py-12 text-white">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Attendms</h1>
        <p className="mt-2 max-w-md text-neutral-400">
          Biometric attendance system — face + PIN punches, fully
          offline-capable once loaded.
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-4">
        <Link
          href="/kiosk"
          className="flex items-center gap-3 rounded-xl bg-neutral-900 p-5 transition hover:bg-neutral-800"
        >
          <ScanFace className="h-6 w-6 text-emerald-400" />
          <div>
            <p className="font-medium">Attendance kiosk</p>
            <p className="text-sm text-neutral-400">
              Detect a face, confirm PIN, log the punch
            </p>
          </div>
        </Link>

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
          href="/portal/login"
          className="flex items-center gap-3 rounded-xl bg-neutral-900 p-5 transition hover:bg-neutral-800"
        >
          <LogIn className="h-6 w-6 text-cyan-400" />
          <div>
            <p className="font-medium">Employee portal</p>
            <p className="text-sm text-neutral-400">
              Sign in to see your own hours and schedule
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
              View enrolled employees, delete a profile
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
