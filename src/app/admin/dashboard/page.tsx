"use client";

import { useEffect, useMemo, useState } from "react";
import { History, Loader2, Pencil, X } from "lucide-react";
import { RequireAdmin, usePermissions } from "@/components/RequireAdmin";
import {
  editAttendanceLog,
  fetchAllAttendance,
  fetchAllEmployees,
} from "@/lib/firestoreRepo";
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

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function Dashboard() {
  const { has, uid, email } = usePermissions();
  const canEdit = has("edit_attendance");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingLog, setEditingLog] = useState<AttendanceLog | null>(null);

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

  function handleLogUpdated(updated: AttendanceLog) {
    setLogs((prev) => prev.map((l) => (l.logId === updated.logId ? updated : l)));
    setEditingLog(null);
  }

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
                        <span className="text-emerald-400">still in</span>
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
          editorName={email ?? uid}
          onClose={() => setEditingLog(null)}
          onSaved={handleLogUpdated}
        />
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
  return (
    <span className="flex items-center gap-1.5">
      {localTime(log.timestamp)}
      {editCount > 0 && (
        <span
          title={`Edited ${editCount} time${editCount === 1 ? "" : "s"}`}
          className="flex items-center gap-0.5 text-xs text-amber-400"
        >
          <History className="h-3 w-3" />
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
                {edit.reason}&quot; (was {new Date(edit.previousTimestamp).toLocaleString()})
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
