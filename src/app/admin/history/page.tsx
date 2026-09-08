"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarClock, CheckCircle2, Clock3, Loader2, Plus } from "lucide-react";
import { usePermissions } from "@/components/RequireAdmin";
import { PageHeader } from "@/components/PageHeader";
import { StatPill } from "@/components/StatPill";
import {
  AddPunchModal,
  CloseShiftModal,
  DayRowCard,
  EditAttendanceModal,
  VoidModal,
} from "@/components/AttendanceRecords";
import { fetchAllAttendance, fetchAllEmployees } from "@/lib/firestoreRepo";
import { averageTimeOfDay, formatDuration, groupSessionsByDay, pairSessions } from "@/lib/hours";
import { isVoided, punchStatus } from "@/lib/attendanceStatus";
import { localDate } from "@/lib/dateFormat";
import type { AttendanceLog, Employee } from "@/lib/types";

export default function AdminHistoryPage() {
  return (
    <Suspense fallback={null}>
      <History />
    </Suspense>
  );
}

function History() {
  const { has, uid, displayName } = usePermissions();
  const canEdit = has("edit_attendance");
  const initialEmployeeId = useSearchParams().get("employeeId") ?? "";

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingLog, setEditingLog] = useState<AttendanceLog | null>(null);
  const [voidingLog, setVoidingLog] = useState<AttendanceLog | null>(null);
  const [closingShiftFor, setClosingShiftFor] = useState<{
    employeeId: string;
    employeeName: string;
  } | null>(null);
  const [addingPunch, setAddingPunch] = useState(false);

  const [employeeFilter, setEmployeeFilter] = useState(initialEmployeeId);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [now] = useState(() => new Date());

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

  const activeLogs = useMemo(() => logs.filter((l) => !isVoided(l)), [logs]);
  const allSessions = useMemo(() => pairSessions(activeLogs), [activeLogs]);

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
    (sum, s) => sum + (s.durationMs ?? now.getTime() - new Date(s.punchIn.timestamp).getTime()),
    0
  );

  const dayRows = useMemo(
    () => groupSessionsByDay(filteredSessions, now),
    [filteredSessions, now]
  );

  const selectedEmployee = employees.find((e) => e.employeeId === employeeFilter) ?? null;

  // Scoped to whatever date range is picked (all-time by default), so
  // these actually reflect what's currently filtered rather than an
  // employee's entire history regardless of the filter above.
  const completedEmpSessions = filteredSessions.filter((s) => s.punchOut !== null);
  const avgCheckIn = averageTimeOfDay(filteredSessions.map((s) => s.punchIn.timestamp));
  const avgCheckOut = averageTimeOfDay(
    completedEmpSessions.map((s) => s.punchOut?.timestamp).filter((t): t is string => !!t)
  );
  const empOnTimeRate =
    filteredSessions.length === 0
      ? null
      : Math.round(
          (filteredSessions.filter((s) => punchStatus(s.punchIn).tone === "success").length /
            filteredSessions.length) *
            100
        );

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-8">
      <PageHeader
        title="Attendance history"
        subtitle="Search full punch history by employee or date range."
        accent="blue"
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : (
        <>
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
              {formatDuration(totalMs)} across {filteredSessions.length} shift
              {filteredSessions.length === 1 ? "" : "s"}
            </p>
          </section>

          {selectedEmployee && (
            <section className="rounded-xl bg-neutral-900 p-4">
              <h2 className="mb-2 font-medium">{selectedEmployee.fullName}</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatPill
                  icon={CalendarClock}
                  value={filteredSessions.length}
                  label="Total attendance"
                  tone="blue"
                />
                <StatPill
                  icon={Clock3}
                  value={avgCheckIn ?? "—"}
                  label="Avg check-in"
                  tone="emerald"
                />
                <StatPill
                  icon={Clock3}
                  value={avgCheckOut ?? "—"}
                  label="Avg check-out"
                  tone="purple"
                />
                <StatPill
                  icon={CheckCircle2}
                  value={empOnTimeRate !== null ? `${empOnTimeRate}%` : "—"}
                  label="On-time rate"
                  tone="amber"
                />
              </div>
            </section>
          )}

          {dayRows.length === 0 ? (
            <p className="rounded-xl bg-neutral-900 p-4 text-center text-sm text-neutral-400">
              No attendance records match these filters.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {dayRows.map((row) => (
                <DayRowCard
                  key={`${row.employeeId}_${row.date}`}
                  row={row}
                  canEdit={canEdit}
                  onEmployeeClick={setEmployeeFilter}
                  onEditClick={setEditingLog}
                  onVoidClick={setVoidingLog}
                  onCloseShift={(employeeId, employeeName) =>
                    setClosingShiftFor({ employeeId, employeeName })
                  }
                />
              ))}
            </div>
          )}
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
    </div>
  );
}
