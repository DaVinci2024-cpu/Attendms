"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Trophy } from "lucide-react";
import { RequireAdmin, usePermissions } from "@/components/RequireAdmin";
import { fetchAllAttendance, fetchAllEmployees, fetchWeekSchedule } from "@/lib/firestoreRepo";
import { averageScore, computeEmployeePerformance, type EmployeePerformance } from "@/lib/performance";
import { weekIdsBack } from "@/lib/week";
import type { Employee, WeekSchedule } from "@/lib/types";

const PERIOD_OPTIONS = [
  { weeks: 4, label: "Last 4 weeks" },
  { weeks: 8, label: "Last 8 weeks" },
  { weeks: 12, label: "Last 12 weeks" },
];

export default function AdminPerformancePage() {
  return (
    <RequireAdmin>
      <PerformancePage />
    </RequireAdmin>
  );
}

function PerformancePage() {
  const { has } = usePermissions();
  const canView = has("view_reports");

  const [weeksBack, setWeeksBack] = useState(4);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<EmployeePerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const weekIds = weekIdsBack(weeksBack);
        const periodStart = new Date(`${weekIds[weekIds.length - 1]}T00:00:00`).getTime();

        const [emps, schedulesRaw, attendance] = await Promise.all([
          fetchAllEmployees(),
          Promise.all(weekIds.map((id) => fetchWeekSchedule(id))),
          fetchAllAttendance(),
        ]);
        if (cancelled) return;

        const schedules = schedulesRaw.filter((s): s is WeekSchedule => s !== null);
        const periodAttendance = attendance.filter(
          (log) => new Date(log.timestamp).getTime() >= periodStart
        );

        setEmployees(emps.filter((e) => e.active));
        setRows(computeEmployeePerformance(emps.filter((e) => e.active), schedules, periodAttendance));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load performance data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [weeksBack, canView]);

  if (!canView) {
    return (
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-2 px-4 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-400" />
        <p className="text-sm text-neutral-300">
          You don&apos;t have permission to view performance reports.
        </p>
      </div>
    );
  }

  const scored = rows.filter((r) => r.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const unscored = rows.filter((r) => r.score === null);
  const avg = averageScore(rows);

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Performance</h1>
          <p className="text-sm text-neutral-400">
            Attendance vs. the posted schedule, and how often records needed a
            correction.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-neutral-900 p-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.weeks}
              type="button"
              onClick={() => setWeeksBack(opt.weeks)}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                weeksBack === opt.weeks
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <p className="rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-500">
        Score = attendance rate (days worked ÷ days scheduled) minus a penalty
        for how often a record needed a supervisor correction. Employees with
        no scheduled shifts in this period aren&apos;t scored.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : employees.length === 0 ? (
        <p className="text-sm text-neutral-500">No active employees yet.</p>
      ) : (
        <>
          <div className="rounded-xl bg-neutral-900 p-4">
            <p className="text-xs text-neutral-400">Business average</p>
            <p className="text-3xl font-semibold">
              {avg !== null ? `${avg.toFixed(0)}` : "—"}
              {avg !== null && <span className="text-base text-neutral-500">/100</span>}
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl bg-neutral-900">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b border-neutral-800 px-3 py-2 text-neutral-400">
                    Rank
                  </th>
                  <th className="border-b border-neutral-800 px-3 py-2 text-neutral-400">
                    Employee
                  </th>
                  <th className="border-b border-neutral-800 px-3 py-2 text-neutral-400">
                    Scheduled
                  </th>
                  <th className="border-b border-neutral-800 px-3 py-2 text-neutral-400">
                    Worked
                  </th>
                  <th className="border-b border-neutral-800 px-3 py-2 text-neutral-400">
                    Attendance
                  </th>
                  <th className="border-b border-neutral-800 px-3 py-2 text-neutral-400">
                    Edits
                  </th>
                  <th className="border-b border-neutral-800 px-3 py-2 text-neutral-400">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody>
                {scored.map((row, i) => (
                  <tr key={row.employeeId} className="border-b border-neutral-800">
                    <td className="px-3 py-2 text-neutral-400">
                      {i === 0 ? <Trophy className="h-4 w-4 text-amber-400" /> : `#${i + 1}`}
                    </td>
                    <td className="px-3 py-2 font-medium">{row.employeeName}</td>
                    <td className="px-3 py-2">{row.scheduledDays}</td>
                    <td className="px-3 py-2">{row.workedDays}</td>
                    <td className="px-3 py-2">{row.attendanceRate?.toFixed(0)}%</td>
                    <td className="px-3 py-2">{row.editsCount}</td>
                    <td className="px-3 py-2 font-semibold">{row.score?.toFixed(0)}</td>
                  </tr>
                ))}
                {unscored.map((row) => (
                  <tr key={row.employeeId} className="border-b border-neutral-800 text-neutral-500">
                    <td className="px-3 py-2">—</td>
                    <td className="px-3 py-2">{row.employeeName}</td>
                    <td className="px-3 py-2" colSpan={5}>
                      No scheduled shifts in this period
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
