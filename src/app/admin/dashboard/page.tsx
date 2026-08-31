"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Users } from "lucide-react";
import { RequireAdmin } from "@/components/RequireAdmin";
import { fetchAllAttendance, fetchAllEmployees } from "@/lib/firestoreRepo";
import { pairSessions, formatDuration } from "@/lib/hours";
import type { AttendanceLog, Employee } from "@/lib/types";

export default function AdminDashboardPage() {
  return (
    <RequireAdmin>
      <Dashboard />
    </RequireAdmin>
  );
}

function localDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA"); // YYYY-MM-DD, sorts naturally
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Dashboard() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [employeeFilter, setEmployeeFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAllEmployees(), fetchAllAttendance()])
      .then(([emps, attendance]) => {
        if (cancelled) return;
        setEmployees(emps);
        setLogs(attendance);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load data");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const allSessions = useMemo(() => pairSessions(logs), [logs]);

  const currentlyIn = useMemo(
    () => allSessions.filter((s) => s.punchOut === null),
    [allSessions]
  );

  const filteredSessions = useMemo(() => {
    return allSessions.filter((s) => {
      if (employeeFilter && s.employeeId !== employeeFilter) return false;
      const date = localDate(s.punchIn.timestamp);
      if (startDate && date < startDate) return false;
      if (endDate && date > endDate) return false;
      return true;
    });
  }, [allSessions, employeeFilter, startDate, endDate]);

  const totalMs = filteredSessions.reduce(
    (sum, s) => sum + (s.durationMs ?? 0),
    0
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <Link
          href="/admin/employees"
          className="flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200"
        >
          <Users className="h-4 w-4" /> Manage employees
        </Link>
      </div>

      <h1 className="text-2xl font-semibold">Attendance dashboard</h1>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : (
        <>
          <section className="rounded-xl bg-neutral-900 p-4">
            <h2 className="mb-2 font-medium">
              Currently clocked in ({currentlyIn.length})
            </h2>
            {currentlyIn.length === 0 ? (
              <p className="text-sm text-neutral-400">
                Nobody is currently clocked in.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {currentlyIn.map((s) => (
                  <li
                    key={s.punchIn.logId}
                    className="flex justify-between text-sm"
                  >
                    <span>{s.employeeName}</span>
                    <span className="text-neutral-400">
                      since {localTime(s.punchIn.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-wrap items-end gap-3 rounded-xl bg-neutral-900 p-4">
            <label className="flex flex-col gap-1 text-sm">
              Employee
              <select
                className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
                value={employeeFilter}
                onChange={(e) => setEmployeeFilter(e.target.value)}
              >
                <option value="">All employees</option>
                {employees.map((e) => (
                  <option key={e.employeeId} value={e.employeeId}>
                    {e.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              From
              <input
                type="date"
                className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              To
              <input
                type="date"
                className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
            <p className="ml-auto text-sm text-neutral-400">
              Total: {formatDuration(totalMs)} across {filteredSessions.length}{" "}
              session{filteredSessions.length === 1 ? "" : "s"}
            </p>
          </section>

          <div className="overflow-x-auto rounded-xl bg-neutral-900">
            <table className="w-full text-left text-sm">
              <thead className="text-neutral-400">
                <tr>
                  <th className="px-4 py-2">Employee</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Punch in</th>
                  <th className="px-4 py-2">Punch out</th>
                  <th className="px-4 py-2">Duration</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((s) => (
                  <tr key={s.punchIn.logId} className="border-t border-neutral-800">
                    <td className="px-4 py-2">{s.employeeName}</td>
                    <td className="px-4 py-2">{localDate(s.punchIn.timestamp)}</td>
                    <td className="px-4 py-2">{localTime(s.punchIn.timestamp)}</td>
                    <td className="px-4 py-2">
                      {s.punchOut ? (
                        localTime(s.punchOut.timestamp)
                      ) : (
                        <span className="text-emerald-400">still in</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {s.durationMs !== null ? formatDuration(s.durationMs) : "—"}
                    </td>
                  </tr>
                ))}
                {filteredSessions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                      No attendance records match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
