"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  History,
  LogOut,
  Loader2,
  MapPin,
  MapPinOff,
  Pencil,
  Plus,
  ShieldCheck,
  Smartphone,
  Users,
  X,
} from "lucide-react";
import { usePermissions } from "@/components/RequireAdmin";
import { PageHeader } from "@/components/PageHeader";
import { StatPill } from "@/components/StatPill";
import { StatusBadge } from "@/components/StatusBadge";
import { DetailSheet } from "@/components/DetailSheet";
import {
  closeShift,
  createManualAttendanceLog,
  editAttendanceLog,
  fetchAllAttendance,
  fetchAllEmployees,
  fetchWeekSchedule,
  voidAttendanceLog,
} from "@/lib/firestoreRepo";
import { pairSessions, formatDuration, type WorkSession } from "@/lib/hours";
import { isVoided, punchStatus } from "@/lib/attendanceStatus";
import { DEPARTMENT_PRESETS, LATE_PUNCH_IN_GRACE_MS } from "@/lib/constants";
import { mondayOf, toWeekId } from "@/lib/week";
import {
  activeShifts,
  mostRecentlyEndedShift,
  noShowsToday,
  nextScheduledShift,
  presentDuringWindow,
  summarizeDayByDepartment,
  summarizeShiftAttendance,
} from "@/lib/shiftStats";
import type { AttendanceLog, Employee, PunchType, WeekSchedule } from "@/lib/types";

// Known departments sort first (in this order), then anything custom
// alphabetically, "Unassigned" always last — for the sector rotation
// summary below.
function departmentSortKey(department: string): string {
  const presetIndex = (DEPARTMENT_PRESETS as readonly string[]).indexOf(department);
  if (department === "Unassigned") return "zzz";
  if (presetIndex >= 0) return `0${presetIndex}`;
  return `1${department}`;
}

// A background refresh cadence for the dashboard's "right now" pills —
// frequent enough that they don't visibly go stale while the page is
// left open, without hammering Firestore.
const DASHBOARD_REFRESH_MS = 30 * 1000;

export default function AdminDashboardPage() {
  return <Dashboard />;
}

function localDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA"); // YYYY-MM-DD, sorts naturally
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
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
  const [voidingLog, setVoidingLog] = useState<AttendanceLog | null>(null);
  const [addingPunch, setAddingPunch] = useState(false);

  const [employeeFilter, setEmployeeFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

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
  // sessions, currently-clocked-in, the daily table, hours, no-shows, the
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

  // One row per employee per day (grouping filteredSessions, which can
  // hold more than one session a day for someone covering more than one
  // rotation) instead of one row per punch pair — the table reads as
  // "how was this person's day", not a flat punch log.
  interface DayRow {
    employeeId: string;
    employeeName: string;
    date: string;
    sessions: WorkSession[];
    totalMs: number;
  }
  const dayRows = useMemo(() => {
    const map = new Map<string, DayRow>();
    for (const s of filteredSessions) {
      const date = localDate(s.punchIn.timestamp);
      const key = `${s.employeeId}_${date}`;
      const row = map.get(key) ?? {
        employeeId: s.employeeId,
        employeeName: s.employeeName,
        date,
        sessions: [],
        totalMs: 0,
      };
      row.sessions.push(s);
      row.totalMs +=
        s.durationMs ?? now.getTime() - new Date(s.punchIn.timestamp).getTime();
      map.set(key, row);
    }
    const rows = Array.from(map.values());
    for (const row of rows) {
      row.sessions.sort((a, b) => a.punchIn.timestamp.localeCompare(b.punchIn.timestamp));
    }
    rows.sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName));
    return rows;
  }, [filteredSessions, now]);

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
      map.set(e.employeeId, e.department?.trim() || "Unassigned");
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
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
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
                        <span
                          key={s.columnLabel}
                          className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300"
                        >
                          {s.columnLabel} {s.presentCount}/{s.scheduledCount}
                        </span>
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
            {canEdit && (
              <button
                type="button"
                onClick={() => setAddingPunch(true)}
                className="flex items-center gap-1.5 rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700"
              >
                <Plus className="h-4 w-4" /> Add punch
              </button>
            )}
            <p className="ml-auto text-sm text-neutral-400">
              In range: {formatDuration(totalMs)} across {filteredSessions.length}{" "}
              shift{filteredSessions.length === 1 ? "" : "s"}
            </p>
          </section>

          <div className="flex flex-col gap-3">
            {dayRows.length === 0 && (
              <p className="rounded-xl bg-neutral-900 p-4 text-center text-sm text-neutral-400">
                No attendance records match these filters.
              </p>
            )}
            {dayRows.map((row) => (
              <div key={`${row.employeeId}_${row.date}`} className="rounded-xl bg-neutral-900 p-4">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setSummaryEmployeeId(row.employeeId)}
                    className="font-medium hover:underline"
                  >
                    {row.employeeName}
                  </button>
                  <span className="text-xs text-neutral-400">{row.date}</span>
                </div>
                <div className="mt-2 flex flex-col gap-1.5">
                  {row.sessions.map((s) => (
                    <div
                      key={s.punchIn.logId}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <TimeCell
                          log={s.punchIn}
                          canEdit={canEdit}
                          onEditClick={() => setEditingLog(s.punchIn)}
                          onVoidClick={() => setVoidingLog(s.punchIn)}
                        />
                        <span className="text-neutral-600">→</span>
                        {s.punchOut ? (
                          <TimeCell
                            log={s.punchOut}
                            canEdit={canEdit}
                            onEditClick={() => setEditingLog(s.punchOut as AttendanceLog)}
                            onVoidClick={() => setVoidingLog(s.punchOut as AttendanceLog)}
                          />
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <span className="text-emerald-400">still in</span>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() =>
                                  setClosingShiftFor({
                                    employeeId: s.employeeId,
                                    employeeName: s.employeeName,
                                  })
                                }
                                className="flex items-center gap-1 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-700"
                                title="Close this shift (employee forgot to punch out)"
                              >
                                <LogOut className="h-3 w-3" /> Close shift
                              </button>
                            )}
                          </span>
                        )}
                      </span>
                      <span className="text-neutral-400">
                        {s.durationMs !== null ? formatDuration(s.durationMs) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-neutral-800 pt-2 text-sm">
                  <span className="text-neutral-400">Total</span>
                  <span className="font-medium">{formatDuration(row.totalMs)}</span>
                </div>
              </div>
            ))}
          </div>
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
    </div>
  );
}

function TimeCell({
  log,
  canEdit,
  onEditClick,
  onVoidClick,
}: {
  log: AttendanceLog;
  canEdit: boolean;
  onEditClick: () => void;
  onVoidClick: () => void;
}) {
  const editCount = log.edits?.length ?? 0;
  const status = punchStatus(log);
  const voided = isVoided(log);
  return (
    <span className="flex items-center gap-1.5">
      {localTime(log.timestamp)}
      <StatusBadge label={status.label} tone={status.tone} />
      {editCount > 0 && (
        <span
          title={`Edited ${editCount} time${editCount === 1 ? "" : "s"}`}
          className="flex items-center gap-0.5 text-xs text-amber-400"
        >
          <History className="h-3 w-3" />
        </span>
      )}
      {log.override && (
        <span
          title={`Supervisor override by ${log.override.supervisorName} at ${new Date(
            log.override.overriddenAt
          ).toLocaleString()}: "${log.override.reason}"`}
          className="flex items-center gap-0.5 text-xs text-blue-400"
        >
          <ShieldCheck className="h-3 w-3" />
        </span>
      )}
      {log.location && (
        <span
          title={
            log.location.withinRadius === false
              ? `Off-site — about ${log.location.distanceMeters}m from the workplace (${log.location.latitude.toFixed(5)}, ${log.location.longitude.toFixed(5)})`
              : log.location.withinRadius === true
                ? `On-site (${log.location.latitude.toFixed(5)}, ${log.location.longitude.toFixed(5)})`
                : `Location captured, but no workplace location is configured yet (${log.location.latitude.toFixed(5)}, ${log.location.longitude.toFixed(5)})`
          }
          className={`flex items-center gap-0.5 text-xs ${
            log.location.withinRadius === false ? "text-red-400" : "text-neutral-500"
          }`}
        >
          <MapPin className="h-3 w-3" />
        </span>
      )}
      {!log.location && (
        <span title="No location captured for this punch" className="text-neutral-600">
          <MapPinOff className="h-3 w-3" />
        </span>
      )}
      {log.device && (
        <span
          title={`${log.device.summary} · device ${log.device.deviceId.slice(0, 8)}`}
          className="flex items-center gap-0.5 text-xs text-neutral-500"
        >
          <Smartphone className="h-3 w-3" />
        </span>
      )}
      {canEdit && !voided && (
        <button
          type="button"
          onClick={onEditClick}
          className="text-neutral-500 hover:text-neutral-200"
          title="Edit this punch"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
      {canEdit && !voided && (
        <button
          type="button"
          onClick={onVoidClick}
          className="text-neutral-500 hover:text-red-400"
          title="Void this punch (mistaken/duplicate)"
        >
          <Ban className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function EditAttendanceModal({
  log,
  editorUid,
  editorName,
  onClose,
  onSaved,
}: {
  log: AttendanceLog;
  editorUid: string;
  editorName: string;
  onClose: () => void;
  onSaved: (updated: AttendanceLog) => void;
}) {
  const [newTime, setNewTime] = useState(() => toDatetimeLocalValue(log.timestamp));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const newIso = new Date(newTime).toISOString();
      await editAttendanceLog(log, newIso, log.type, reason.trim(), editorUid, editorName);
      onSaved({
        ...log,
        timestamp: newIso,
        edits: [
          ...(log.edits ?? []),
          {
            editedBy: editorUid,
            editedByName: editorName,
            reason: reason.trim(),
            editedAt: new Date().toISOString(),
            previousTimestamp: log.timestamp,
            previousType: log.type,
          },
        ],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save edit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-neutral-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Edit {log.employeeName}&apos;s {log.type === "punch_in" ? "punch in" : "punch out"}
          </h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        {log.edits && log.edits.length > 0 && (
          <div className="flex flex-col gap-1 rounded-lg bg-neutral-800 p-3 text-xs text-neutral-400">
            <p className="font-medium text-neutral-300">Edit history</p>
            {log.edits.map((edit, i) => (
              <p key={i}>
                {new Date(edit.editedAt).toLocaleString()} — {edit.editedByName}: &quot;
                {edit.reason}&quot;
                {edit.previousTimestamp
                  ? ` (was ${new Date(edit.previousTimestamp).toLocaleString()})`
                  : " (shift closed manually)"}
              </p>
            ))}
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm">
          Corrected time
          <input
            type="datetime-local"
            className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Reason (required)
          <textarea
            className="min-h-20 rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Employee forgot to punch out, confirmed with them"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg bg-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save correction
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseShiftModal({
  employeeId,
  employeeName,
  editorUid,
  editorName,
  onClose,
  onSaved,
}: {
  employeeId: string;
  employeeName: string;
  editorUid: string;
  editorName: string;
  onClose: () => void;
  onSaved: (log: AttendanceLog) => void;
}) {
  const [newTime, setNewTime] = useState(() => toDatetimeLocalValue(new Date().toISOString()));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const newIso = new Date(newTime).toISOString();
      const log = await closeShift(
        employeeId,
        employeeName,
        newIso,
        reason.trim(),
        editorUid,
        editorName
      );
      onSaved(log);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close shift");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-neutral-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Close {employeeName}&apos;s shift</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm text-neutral-400">
          Records a punch-out for a shift the employee forgot to end.
        </p>

        <label className="flex flex-col gap-1 text-sm">
          Punch-out time
          <input
            type="datetime-local"
            className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Reason (required)
          <textarea
            className="min-h-20 rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Employee forgot to punch out, confirmed they left around 5pm"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg bg-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Close shift
          </button>
        </div>
      </div>
    </div>
  );
}

// Marks a punch voided rather than deleting it — see voidAttendanceLog in
// firestoreRepo.ts and the comment on AttendanceEdit.voided. Same shape
// as EditAttendanceModal, but there's nothing to change except why.
function VoidModal({
  log,
  editorUid,
  editorName,
  onClose,
  onSaved,
}: {
  log: AttendanceLog;
  editorUid: string;
  editorName: string;
  onClose: () => void;
  onSaved: (updated: AttendanceLog) => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVoid() {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await voidAttendanceLog(log, reason.trim(), editorUid, editorName);
      onSaved({
        ...log,
        edits: [
          ...(log.edits ?? []),
          {
            editedBy: editorUid,
            editedByName: editorName,
            reason: reason.trim(),
            editedAt: new Date().toISOString(),
            previousTimestamp: log.timestamp,
            previousType: log.type,
            voided: true,
          },
        ],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to void punch");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-neutral-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Void {log.employeeName}&apos;s {log.type === "punch_in" ? "punch in" : "punch out"}
          </h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm text-neutral-400">
          Stays in {log.employeeName}&apos;s history, marked voided — it just stops counting
          toward hours, currently-clocked-in, and everything else live. It&apos;s never
          actually deleted, and this can&apos;t be undone from here.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          Reason (required)
          <textarea
            className="min-h-20 rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Duplicate punch, kiosk double-registered the tap"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg bg-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleVoid}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-neutral-700"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Void punch
          </button>
        </div>
      </div>
    </div>
  );
}

// A forgotten punch entered after the fact, either direction — same
// underlying write as CloseShiftModal (createManualAttendanceLog), just
// not locked to punch_out or to an employee already known to be missing
// one.
function AddPunchModal({
  employees,
  editorUid,
  editorName,
  onClose,
  onSaved,
}: {
  employees: Employee[];
  editorUid: string;
  editorName: string;
  onClose: () => void;
  onSaved: (log: AttendanceLog) => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState<PunchType>("punch_in");
  const [newTime, setNewTime] = useState(() => toDatetimeLocalValue(new Date().toISOString()));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const employee = employees.find((e) => e.employeeId === employeeId);
    if (!employee) {
      setError("Pick an employee.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const newIso = new Date(newTime).toISOString();
      const log = await createManualAttendanceLog(
        employee.employeeId,
        employee.fullName,
        newIso,
        type,
        reason.trim(),
        editorUid,
        editorName
      );
      onSaved(log);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add punch");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-neutral-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add a forgotten punch</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Employee
          <select
            className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">Select…</option>
            {employees.map((e) => (
              <option key={e.employeeId} value={e.employeeId}>
                {e.fullName}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Type
          <select
            className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
            value={type}
            onChange={(e) => setType(e.target.value as PunchType)}
          >
            <option value="punch_in">Punch in</option>
            <option value="punch_out">Punch out</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Time
          <input
            type="datetime-local"
            className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Reason (required)
          <textarea
            className="min-h-20 rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Forgot to punch in this morning, confirmed with them"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg bg-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Add punch
          </button>
        </div>
      </div>
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
        href={`/admin/employees?employeeId=${employee.employeeId}`}
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
            ? `${next.dayLabel} · ${next.columnLabel}, ${next.start.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : "Nothing scheduled this week."}
        </p>
      </div>
    </DetailSheet>
  );
}
