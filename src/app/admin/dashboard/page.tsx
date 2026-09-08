"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  LogOut,
  Loader2,
  MapPin,
  MapPinOff,
  Pencil,
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
  editAttendanceLog,
  fetchAllAttendance,
  fetchAllEmployees,
  fetchWeekSchedule,
} from "@/lib/firestoreRepo";
import { pairSessions, formatDuration } from "@/lib/hours";
import { punchStatus } from "@/lib/attendanceStatus";
import { LATE_PUNCH_IN_GRACE_MS } from "@/lib/constants";
import { mondayOf, toWeekId } from "@/lib/week";
import {
  activeShifts,
  mostRecentlyEndedShift,
  noShowsToday,
  presentDuringWindow,
  summarizeShiftAttendance,
} from "@/lib/shiftStats";
import type { AttendanceLog, Employee, WeekSchedule } from "@/lib/types";

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
  }

  function handleShiftClosed(newLog: AttendanceLog) {
    setLogs((prev) => [...prev, newLog]);
    setClosingShiftFor(null);
  }

  const allSessions = useMemo(() => pairSessions(logs), [logs]);

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
      presentDuringWindow(logs, previousShiftWindow.start, previousShiftWindow.end)
    );
  }, [previousShiftWindow, logs]);

  const todaysNoShows = useMemo(
    () => noShowsToday(schedule, weekStart, now, logs, LATE_PUNCH_IN_GRACE_MS),
    [schedule, weekStart, now, logs]
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
              <thead>
                <tr className="bg-neutral-800/50 text-xs uppercase tracking-wide text-neutral-400">
                  <th className="px-4 py-2.5 font-medium">Employee</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Punch in</th>
                  <th className="px-4 py-2.5 font-medium">Punch out</th>
                  <th className="px-4 py-2.5 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((s) => (
                  <tr
                    key={s.punchIn.logId}
                    className="border-t border-neutral-800 transition hover:bg-neutral-800/40"
                  >
                    <td className="px-4 py-2.5">{s.employeeName}</td>
                    <td className="px-4 py-2.5">{localDate(s.punchIn.timestamp)}</td>
                    <td className="px-4 py-2.5">
                      <TimeCell
                        log={s.punchIn}
                        canEdit={canEdit}
                        onEditClick={() => setEditingLog(s.punchIn)}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      {s.punchOut ? (
                        <TimeCell
                          log={s.punchOut}
                          canEdit={canEdit}
                          onEditClick={() => setEditingLog(s.punchOut)}
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
                    </td>
                    <td className="px-4 py-2.5">
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
}: {
  log: AttendanceLog;
  canEdit: boolean;
  onEditClick: () => void;
}) {
  const editCount = log.edits?.length ?? 0;
  const status = punchStatus(log);
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
      {canEdit && (
        <button
          type="button"
          onClick={onEditClick}
          className="text-neutral-500 hover:text-neutral-200"
          title="Edit this punch"
        >
          <Pencil className="h-3 w-3" />
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
