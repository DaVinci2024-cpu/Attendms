"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, Plus, Users } from "lucide-react";
import { usePermissions } from "@/components/RequireAdmin";
import { PageHeader } from "@/components/PageHeader";
import { StatPill } from "@/components/StatPill";
import { StatusBadge } from "@/components/StatusBadge";
import { DetailSheet } from "@/components/DetailSheet";
import {
  AddPunchModal,
  CloseShiftModal,
  DayRowCard,
  EditAttendanceModal,
  VoidModal,
} from "@/components/AttendanceRecords";
import { fetchAllAttendance, fetchAllEmployees, fetchWeekSchedule } from "@/lib/firestoreRepo";
import { pairSessions, formatDuration, groupSessionsByDay } from "@/lib/hours";
import { isVoided, punchStatus } from "@/lib/attendanceStatus";
import { localDate, localTime } from "@/lib/dateFormat";
import { companyEndOfDay, companyFields, companyTimeToUtc } from "@/lib/companyTime";
import { LATE_PUNCH_IN_GRACE_MS } from "@/lib/constants";
import { departmentSortKey, UNASSIGNED_DEPARTMENT } from "@/lib/departments";
import { mondayOf, toWeekId } from "@/lib/week";
import {
  activeShifts,
  mostRecentlyEndedShift,
  noShowsToday,
  nextScheduledShift,
  presentDuringWindow,
  summarizeDayByDepartment,
  summarizeShiftAttendance,
  type DepartmentShiftSummary,
} from "@/lib/shiftStats";
import type { AttendanceLog, Employee, WeekSchedule } from "@/lib/types";

// A background refresh cadence for the dashboard's "right now" pills —
// frequent enough that they don't visibly go stale while the page is
// left open, without hammering Firestore.
const DASHBOARD_REFRESH_MS = 30 * 1000;

export default function AdminDashboardPage() {
  return <Dashboard />;
}

function Dashboard() {
  const { has, uid, displayName } = usePermissions();
  const canEdit = has("edit_attendance");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [schedule, setSchedule] = useState<WeekSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingLog, setEditingLog] = useState<AttendanceLog | null>(null);
  const [closingShiftFor, setClosingShiftFor] = useState<{
    employeeId: string;
    employeeName: string;
  } | null>(null);
  const [openDetail, setOpenDetail] = useState<
    "headcount" | "noshows" | "hours" | "ontime" | null
  >(null);
  const [summaryEmployeeId, setSummaryEmployeeId] = useState<string | null>(null);
  const [openDeptShift, setOpenDeptShift] = useState<{
    dept: string;
    shift: DepartmentShiftSummary;
  } | null>(null);
  const [voidingLog, setVoidingLog] = useState<AttendanceLog | null>(null);
  const [addingPunch, setAddingPunch] = useState(false);

  // Ticks forward on its own refresh cadence so the shift-aware pills
  // notice a shift boundary (or midnight) passing while the page stays
  // open, without needing a reload.
  const [now, setNow] = useState(() => new Date());

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
    fetchWeekSchedule(toWeekId(mondayOf(new Date())))
      .then((weekSchedule) => {
        if (!cancelled) setSchedule(weekSchedule);
      })
      .catch(() => {
        // Non-critical — the shift-aware pills just fall back to their
        // "no shift right now" state until this loads.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keeps the "right now" pills honest while the page is left open: a
  // quiet background refresh of employees/attendance/schedule, and a
  // fresh `now` so a shift boundary is noticed even with no new data.
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
      Promise.all([fetchAllEmployees(), fetchAllAttendance()])
        .then(([emps, attendance]) => {
          setEmployees(emps);
          setLogs(attendance);
        })
        .catch(() => {
          // A background refresh failing just means the pills keep
          // showing the last-known numbers until the next tick succeeds.
        });
      fetchWeekSchedule(toWeekId(mondayOf(new Date())))
        .then(setSchedule)
        .catch(() => {});
    }, DASHBOARD_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  function handleLogUpdated(updated: AttendanceLog) {
    setLogs((prev) => prev.map((l) => (l.logId === updated.logId ? updated : l)));
    setEditingLog(null);
    setVoidingLog(null);
  }

  function handleShiftClosed(newLog: AttendanceLog) {
    setLogs((prev) => [...prev, newLog]);
    setClosingShiftFor(null);
  }

  function handlePunchAdded(newLog: AttendanceLog) {
    setLogs((prev) => [...prev, newLog]);
    setAddingPunch(false);
  }

  // Voided punches stay in `logs` for good (see firestore.rules — never
  // actually deleted) but are excluded here, from everything "live":
  // sessions, currently-clocked-in, today's table, hours, no-shows, the
  // sector summary. The employee summary popup below reads the full
  // `logs` instead, specifically so a voided punch still shows up there.
  const activeLogs = useMemo(() => logs.filter((l) => !isVoided(l)), [logs]);

  const allSessions = useMemo(() => pairSessions(activeLogs), [activeLogs]);

  const currentlyIn = useMemo(
    () => allSessions.filter((s) => s.punchOut === null),
    [allSessions]
  );
  const currentlyInIds = useMemo(
    () => new Set(currentlyIn.map((s) => s.employeeId)),
    [currentlyIn]
  );

  // The dashboard is a "right now" glance, not a historical browser — see
  // /admin/history for that. Today's sessions only, grouped the same way
  // (one card per employee).
  const todayKey = useMemo(() => localDate(now.toISOString()), [now]);
  const todaySessions = useMemo(
    () => allSessions.filter((s) => localDate(s.punchIn.timestamp) === todayKey),
    [allSessions, todayKey]
  );
  const todayRows = useMemo(
    () => groupSessionsByDay(todaySessions, now),
    [todaySessions, now]
  );

  const weekStart = useMemo(() => mondayOf(now), [now]);

  // The shift(s) actually running right now — drives the headcount,
  // hours, and on-time pills below; each falls back to a "today, no
  // specific shift" reading whenever nothing timed is currently active.
  const currentShiftWindows = useMemo(
    () => activeShifts(schedule, weekStart, now),
    [schedule, weekStart, now]
  );
  const previousShiftWindow = useMemo(
    () => mostRecentlyEndedShift(schedule, weekStart, now),
    [schedule, weekStart, now]
  );

  const currentHeadcount = useMemo(
    () => summarizeShiftAttendance(currentShiftWindows, (id) => currentlyInIds.has(id)),
    [currentShiftWindows, currentlyInIds]
  );
  const previousHeadcount = useMemo(() => {
    if (!previousShiftWindow) return null;
    return summarizeShiftAttendance(
      [previousShiftWindow],
      presentDuringWindow(activeLogs, previousShiftWindow.start, previousShiftWindow.end)
    );
  }, [previousShiftWindow, activeLogs]);

  const todaysNoShows = useMemo(
    () => noShowsToday(schedule, weekStart, now, activeLogs, LATE_PUNCH_IN_GRACE_MS),
    [schedule, weekStart, now, activeLogs]
  );

  const departmentByEmployeeId = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees) {
      map.set(e.employeeId, e.department?.trim() || UNASSIGNED_DEPARTMENT);
    }
    return map;
  }, [employees]);

  const departmentSummary = useMemo(
    () =>
      Array.from(
        summarizeDayByDepartment(schedule, weekStart, now, activeLogs, departmentByEmployeeId)
      ).sort(([a], [b]) => departmentSortKey(a).localeCompare(departmentSortKey(b))),
    [schedule, weekStart, now, activeLogs, departmentByEmployeeId]
  );
  const previousShiftNoShows = useMemo(
    () => previousHeadcount?.scheduled.filter((s) => !s.present) ?? [],
    [previousHeadcount]
  );

  // "Reporting window" for the hours + on-time pills: the currently
  // active shift(s) if there is one, else the whole of today.
  const reportingWindow = useMemo(() => {
    if (currentShiftWindows.length > 0 && currentHeadcount) {
      return {
        label: currentHeadcount.shiftLabel,
        start: new Date(Math.min(...currentShiftWindows.map((w) => w.start.getTime()))),
        end: new Date(Math.max(...currentShiftWindows.map((w) => w.end.getTime()))),
      };
    }
    const { year, month, day } = companyFields(now);
    const start = companyTimeToUtc(year, month, day);
    const end = companyEndOfDay(now);
    return { label: "Today", start, end };
  }, [currentShiftWindows, currentHeadcount, now]);

  const reportingSessions = useMemo(
    () =>
      allSessions.filter((s) => {
        const t = new Date(s.punchIn.timestamp).getTime();
        return t >= reportingWindow.start.getTime() && t <= reportingWindow.end.getTime();
      }),
    [allSessions, reportingWindow]
  );

  // Open sessions inside the reporting window count their elapsed time so
  // far, not zero — otherwise "hours worked this shift" would visibly
  // drop the moment someone still clocked in gets counted.
  const reportingHoursMs = reportingSessions.reduce(
    (sum, s) =>
      sum + (s.durationMs ?? now.getTime() - new Date(s.punchIn.timestamp).getTime()),
    0
  );

  // Share of this window's punch-ins that went through cleanly — no
  // supervisor override, no unscheduled walk-in, no after-the-fact
  // correction. Same classification StatusBadge uses per-row below.
  const reportingOnTimeRate =
    reportingSessions.length === 0
      ? null
      : Math.round(
          (reportingSessions.filter((s) => punchStatus(s.punchIn).tone === "success").length /
            reportingSessions.length) *
            100
        );

  const previousReportingSessions = useMemo(() => {
    if (!previousShiftWindow) return [];
    return allSessions.filter((s) => {
      const t = new Date(s.punchIn.timestamp).getTime();
      return t >= previousShiftWindow.start.getTime() && t < previousShiftWindow.end.getTime();
    });
  }, [allSessions, previousShiftWindow]);

  const previousHoursMs = previousReportingSessions.reduce(
    (sum, s) => sum + (s.durationMs ?? 0),
    0
  );
  const previousOnTimeRate =
    previousReportingSessions.length === 0
      ? null
      : Math.round(
          (previousReportingSessions.filter((s) => punchStatus(s.punchIn).tone === "success")
            .length /
            previousReportingSessions.length) *
            100
        );

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-8">
      <PageHeader
        title="Attendance dashboard"
        subtitle="Who's clocked in, punch history, hours worked."
        accent="amber"
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatPill
              icon={Users}
              value={
                currentHeadcount
                  ? `${currentHeadcount.presentCount}/${currentHeadcount.scheduledCount}`
                  : `${currentlyIn.length}/—`
              }
              label={currentHeadcount ? currentHeadcount.shiftLabel : "Clocked in now"}
              tone="emerald"
              onClick={() => setOpenDetail("headcount")}
            />
            <StatPill
              icon={AlertTriangle}
              value={todaysNoShows.length}
              label={todaysNoShows.length === 1 ? "No-show today" : "No-shows today"}
              tone={todaysNoShows.length > 0 ? "rose" : "blue"}
              onClick={() => setOpenDetail("noshows")}
            />
            <StatPill
              icon={Clock3}
              value={formatDuration(reportingHoursMs)}
              label={`Hours — ${reportingWindow.label}`}
              tone="purple"
              onClick={() => setOpenDetail("hours")}
            />
            <StatPill
              icon={CheckCircle2}
              value={reportingOnTimeRate !== null ? `${reportingOnTimeRate}%` : "—"}
              label={`On-time — ${reportingWindow.label}`}
              tone="amber"
              onClick={() => setOpenDetail("ontime")}
            />
          </div>

          <section className="rounded-xl bg-neutral-900 p-4">
            <h2 className="mb-2 font-medium">Today&apos;s rotations by department</h2>
            {departmentSummary.length === 0 ? (
              <p className="text-sm text-neutral-400">Nothing timed scheduled today.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {departmentSummary.map(([dept, shifts]) => (
                  <div key={dept} className="rounded-lg bg-neutral-800/60 p-3">
                    <p className="text-sm font-medium">{dept}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {shifts.map((s) => (
                        <button
                          key={s.columnLabel}
                          type="button"
                          onClick={() => setOpenDeptShift({ dept, shift: s })}
                          className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
                        >
                          {s.columnLabel} {s.presentCount}/{s.scheduledCount}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

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
                    <button
                      type="button"
                      onClick={() => setSummaryEmployeeId(s.employeeId)}
                      className="hover:underline"
                    >
                      {s.employeeName}
                    </button>
                    <span className="text-neutral-400">
                      since {localTime(s.punchIn.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex items-center justify-between">
            <h2 className="font-medium">Today&apos;s punches</h2>
            {canEdit && (
              <button
                type="button"
                onClick={() => setAddingPunch(true)}
                className="flex items-center gap-1.5 rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700"
              >
                <Plus className="h-4 w-4" /> Add punch
              </button>
            )}
          </div>

          {todayRows.length === 0 ? (
            <p className="rounded-xl bg-neutral-900 p-4 text-center text-sm text-neutral-400">
              No punches yet today.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {todayRows.map((row) => (
                <DayRowCard
                  key={`${row.employeeId}_${row.date}`}
                  row={row}
                  canEdit={canEdit}
                  onEmployeeClick={setSummaryEmployeeId}
                  onEditClick={setEditingLog}
                  onVoidClick={setVoidingLog}
                  onCloseShift={(employeeId, employeeName) =>
                    setClosingShiftFor({ employeeId, employeeName })
                  }
                />
              ))}
            </div>
          )}

          <Link
            href="/admin/history"
            className="text-center text-sm text-blue-400 hover:underline"
          >
            Full attendance history →
          </Link>
        </>
      )}

      {editingLog && (
        <EditAttendanceModal
          log={editingLog}
          editorUid={uid}
          editorName={displayName}
          onClose={() => setEditingLog(null)}
          onSaved={handleLogUpdated}
        />
      )}

      {closingShiftFor && (
        <CloseShiftModal
          employeeId={closingShiftFor.employeeId}
          employeeName={closingShiftFor.employeeName}
          editorUid={uid}
          editorName={displayName}
          onClose={() => setClosingShiftFor(null)}
          onSaved={handleShiftClosed}
        />
      )}

      {voidingLog && (
        <VoidModal
          log={voidingLog}
          editorUid={uid}
          editorName={displayName}
          onClose={() => setVoidingLog(null)}
          onSaved={handleLogUpdated}
        />
      )}

      {addingPunch && (
        <AddPunchModal
          employees={employees}
          editorUid={uid}
          editorName={displayName}
          onClose={() => setAddingPunch(false)}
          onSaved={handlePunchAdded}
        />
      )}

      {summaryEmployeeId && (
        <EmployeeSummaryPopup
          employeeId={summaryEmployeeId}
          employees={employees}
          logs={logs}
          schedule={schedule}
          weekStart={weekStart}
          now={now}
          onClose={() => setSummaryEmployeeId(null)}
        />
      )}

      {openDetail === "headcount" && (
        <DetailSheet
          title={currentHeadcount ? currentHeadcount.shiftLabel : "Clocked in now"}
          onClose={() => setOpenDetail(null)}
        >
          {currentHeadcount ? (
            <>
              <p className="text-sm text-neutral-400">
                {currentHeadcount.presentCount} of {currentHeadcount.scheduledCount}{" "}
                scheduled for this shift {currentHeadcount.presentCount === 1 ? "is" : "are"}{" "}
                clocked in.
              </p>
              <ul className="flex flex-col gap-1 text-sm">
                {currentHeadcount.scheduled.map((s) => (
                  <li key={s.employeeId} className="flex items-center justify-between">
                    <span>{s.employeeName}</span>
                    <span className={s.present ? "text-emerald-400" : "text-neutral-500"}>
                      {s.present ? "Clocked in" : "Not yet"}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-neutral-400">
              Nothing&apos;s scheduled right now — showing everyone currently clocked in,
              overall ({currentlyIn.length}).
            </p>
          )}
          {previousHeadcount && (
            <div className="border-t border-neutral-800 pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Previous shift — {previousHeadcount.shiftLabel}
              </p>
              <p className="mt-1 text-sm text-neutral-300">
                {previousHeadcount.presentCount} of {previousHeadcount.scheduledCount} showed
                up, ended {localTime(previousHeadcount.end.toISOString())}.
              </p>
            </div>
          )}
        </DetailSheet>
      )}

      {openDetail === "noshows" && (
        <DetailSheet title="Late / no-shows today" onClose={() => setOpenDetail(null)}>
          {todaysNoShows.length === 0 ? (
            <p className="text-sm text-neutral-400">
              Nobody&apos;s overdue right now — everyone scheduled so far has clocked in.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {todaysNoShows.map((n) => (
                <li
                  key={`${n.employeeId}-${n.columnLabel}`}
                  className="flex items-center justify-between"
                >
                  <span>{n.employeeName}</span>
                  <span className="text-rose-400">
                    {n.columnLabel} · {n.startTime}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {previousShiftWindow && (
            <div className="border-t border-neutral-800 pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Previous shift — {previousShiftWindow.column.label}
              </p>
              <p className="mt-1 text-sm text-neutral-300">
                {previousShiftNoShows.length === 0
                  ? "Everyone scheduled showed up."
                  : `${previousShiftNoShows.length} never punched in: ${previousShiftNoShows
                      .map((s) => s.employeeName)
                      .join(", ")}.`}
              </p>
            </div>
          )}
        </DetailSheet>
      )}

      {openDetail === "hours" && (
        <DetailSheet
          title={`Hours worked — ${reportingWindow.label}`}
          onClose={() => setOpenDetail(null)}
        >
          <p className="text-2xl font-semibold">{formatDuration(reportingHoursMs)}</p>
          <p className="text-sm text-neutral-400">
            Across {reportingSessions.length} session
            {reportingSessions.length === 1 ? "" : "s"}
            {reportingSessions.length > 0
              ? `, averaging ${formatDuration(
                  reportingHoursMs / reportingSessions.length
                )} each.`
              : "."}
          </p>
          {previousShiftWindow && (
            <div className="border-t border-neutral-800 pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Previous shift — {previousShiftWindow.column.label}
              </p>
              <p className="mt-1 text-sm text-neutral-300">
                {formatDuration(previousHoursMs)} across {previousReportingSessions.length}{" "}
                session{previousReportingSessions.length === 1 ? "" : "s"}.
              </p>
            </div>
          )}
        </DetailSheet>
      )}

      {openDetail === "ontime" && (
        <DetailSheet
          title={`On-time rate — ${reportingWindow.label}`}
          onClose={() => setOpenDetail(null)}
        >
          <p className="text-2xl font-semibold">
            {reportingOnTimeRate !== null ? `${reportingOnTimeRate}%` : "—"}
          </p>
          <p className="text-sm text-neutral-400">
            {reportingSessions.length === 0
              ? "No punches yet."
              : `${
                  reportingSessions.filter((s) => punchStatus(s.punchIn).tone === "success")
                    .length
                } of ${reportingSessions.length} punch-ins had no flag — no override, no late/unscheduled walk-in, no after-the-fact correction.`}
          </p>
          {previousShiftWindow && (
            <div className="border-t border-neutral-800 pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Previous shift — {previousShiftWindow.column.label}
              </p>
              <p className="mt-1 text-sm text-neutral-300">
                {previousOnTimeRate !== null ? `${previousOnTimeRate}%` : "No punches"} on time.
              </p>
            </div>
          )}
        </DetailSheet>
      )}

      {openDeptShift && (
        <DetailSheet
          title={`${openDeptShift.dept} · ${openDeptShift.shift.columnLabel}`}
          onClose={() => setOpenDeptShift(null)}
        >
          <p className="text-sm text-neutral-400">
            {localTime(openDeptShift.shift.start.toISOString())}–
            {localTime(openDeptShift.shift.end.toISOString())} ·{" "}
            {openDeptShift.shift.presentCount} of {openDeptShift.shift.scheduledCount} scheduled{" "}
            {openDeptShift.shift.presentCount === 1 ? "is" : "are"} clocked in.
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {openDeptShift.shift.scheduled.map((s) => (
              <li key={s.employeeId} className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setOpenDeptShift(null);
                    setSummaryEmployeeId(s.employeeId);
                  }}
                  className="hover:underline"
                >
                  {s.employeeName}
                </button>
                <span className={s.present ? "text-emerald-400" : "text-neutral-500"}>
                  {s.present ? "Clocked in" : "Not yet"}
                </span>
              </li>
            ))}
          </ul>
        </DetailSheet>
      )}
    </div>
  );
}

// Tap an employee's name anywhere on the dashboard to see this: their
// live status if they're currently clocked in, their last two completed
// shifts (from the full, unfiltered log — a voided one still shows up
// here, just visibly marked), a link to their full history, and their
// next scheduled shift.
function EmployeeSummaryPopup({
  employeeId,
  employees,
  logs,
  schedule,
  weekStart,
  now,
  onClose,
}: {
  employeeId: string;
  employees: Employee[];
  logs: AttendanceLog[];
  schedule: WeekSchedule | null;
  weekStart: Date;
  now: Date;
  onClose: () => void;
}) {
  const employee = employees.find((e) => e.employeeId === employeeId);

  const sessions = useMemo(
    () => pairSessions(logs.filter((l) => l.employeeId === employeeId)),
    [logs, employeeId]
  );
  const current = sessions.find((s) => s.punchOut === null) ?? null;
  const completed = sessions.filter((s) => s.punchOut !== null).slice(0, 2);
  const next = useMemo(
    () => nextScheduledShift(schedule, weekStart, now, employeeId),
    [schedule, weekStart, now, employeeId]
  );

  if (!employee) return null;

  return (
    <DetailSheet title={employee.fullName} onClose={onClose}>
      {current ? (
        <div className="rounded-lg bg-emerald-900/20 p-3">
          <p className="text-sm text-emerald-300">
            Clocked in since {localTime(current.punchIn.timestamp)}
          </p>
          <p className="text-lg font-semibold">
            {formatDuration(now.getTime() - new Date(current.punchIn.timestamp).getTime())} so
            far
          </p>
        </div>
      ) : (
        <p className="text-sm text-neutral-400">Not currently clocked in.</p>
      )}

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Previous shifts
        </p>
        {completed.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-400">No completed shifts yet.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1.5 text-sm">
            {completed.map((s) => {
              const status = punchStatus(s.punchIn);
              return (
                <li key={s.punchIn.logId} className="flex items-center justify-between gap-2">
                  <span>
                    {localDate(s.punchIn.timestamp)} · {localTime(s.punchIn.timestamp)}–
                    {s.punchOut ? localTime(s.punchOut.timestamp) : "?"}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <StatusBadge label={status.label} tone={status.tone} />
                    <span className="text-neutral-400">
                      {s.durationMs !== null ? formatDuration(s.durationMs) : "—"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Link
        href={`/admin/history?employeeId=${employee.employeeId}`}
        className="text-sm text-blue-400 hover:underline"
      >
        Full details →
      </Link>

      <div className="border-t border-neutral-800 pt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Next scheduled shift
        </p>
        <p className="mt-1 text-sm text-neutral-300">
          {next
            ? `${next.dayLabel} · ${next.columnLabel}, ${localTime(next.start.toISOString())}`
            : "Nothing scheduled this week."}
        </p>
      </div>
    </DetailSheet>
  );
}
