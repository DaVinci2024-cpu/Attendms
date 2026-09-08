"use client";

import { useState } from "react";
import { Ban, Loader2, LogOut, MapPin, MoreVertical, Pencil, X } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import {
  closeShift,
  createManualAttendanceLog,
  editAttendanceLog,
  voidAttendanceLog,
} from "@/lib/firestoreRepo";
import { formatDuration, type DayRow } from "@/lib/hours";
import { isVoided, punchStatus } from "@/lib/attendanceStatus";
import { localTime, toDatetimeLocalValue } from "@/lib/dateFormat";
import type { AttendanceLog, Employee, PunchType } from "@/lib/types";

// A small menu behind one tap target (not several tiny icon buttons
// crammed into the row) — edit-count/override/device details move here
// as plain text instead of their own icons, so the row itself stays to
// just the time, its status, and (when it matters) an off-site flag.
function PunchActionsMenu({
  log,
  onEditClick,
  onVoidClick,
}: {
  log: AttendanceLog;
  onEditClick: () => void;
  onVoidClick: () => void;
}) {
  const [open, setOpen] = useState(false);
  const editCount = log.edits?.length ?? 0;

  const details: string[] = [];
  if (editCount > 0) {
    details.push(`Edited ${editCount} time${editCount === 1 ? "" : "s"}`);
  }
  if (log.override) {
    details.push(`Approved by ${log.override.supervisorName} — "${log.override.reason}"`);
  }
  if (log.scheduleExempt) {
    details.push("Unscheduled walk-in, exempted");
  }
  if (log.location) {
    details.push(
      log.location.withinRadius === false
        ? `Off-site — about ${log.location.distanceMeters}m from the workplace`
        : log.location.withinRadius === true
          ? "On-site"
          : "Location captured, no workplace location configured yet"
    );
  }
  if (log.device) {
    details.push(log.device.summary);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Punch actions"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-lg bg-neutral-800 p-1.5 shadow-xl">
            {details.length > 0 && (
              <>
                <div className="flex flex-col gap-1 px-2.5 py-1.5 text-xs text-neutral-400">
                  {details.map((d, i) => (
                    <p key={i}>{d}</p>
                  ))}
                </div>
                <div className="my-1 border-t border-neutral-700" />
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onEditClick();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-700"
            >
              <Pencil className="h-4 w-4" /> Edit
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onVoidClick();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-red-400 hover:bg-neutral-700"
            >
              <Ban className="h-4 w-4" /> Void
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function TimeCell({
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
  const status = punchStatus(log);
  const offSite = log.location?.withinRadius === false;
  return (
    <span className="flex items-center gap-2">
      <span className="font-medium tabular-nums">{localTime(log.timestamp)}</span>
      <StatusBadge label={status.label} tone={status.tone} />
      {offSite && (
        <span title="Off-site punch" className="text-red-400">
          <MapPin className="h-3.5 w-3.5" />
        </span>
      )}
      {canEdit && !isVoided(log) && (
        <PunchActionsMenu log={log} onEditClick={onEditClick} onVoidClick={onVoidClick} />
      )}
    </span>
  );
}

// One card per employee per day — used by both the dashboard's today
// view and the full history page.
export function DayRowCard({
  row,
  canEdit,
  onEmployeeClick,
  onEditClick,
  onVoidClick,
  onCloseShift,
}: {
  row: DayRow;
  canEdit: boolean;
  onEmployeeClick: (employeeId: string) => void;
  onEditClick: (log: AttendanceLog) => void;
  onVoidClick: (log: AttendanceLog) => void;
  onCloseShift: (employeeId: string, employeeName: string) => void;
}) {
  return (
    <div className="rounded-xl bg-neutral-900 p-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onEmployeeClick(row.employeeId)}
          className="rounded-md py-1 font-medium hover:underline"
        >
          {row.employeeName}
        </button>
        <span className="text-xs text-neutral-400">{row.date}</span>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {row.sessions.map((s) => (
          <div
            key={s.punchIn.logId}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-sm"
          >
            <span className="flex flex-wrap items-center gap-2">
              <TimeCell
                log={s.punchIn}
                canEdit={canEdit}
                onEditClick={() => onEditClick(s.punchIn)}
                onVoidClick={() => onVoidClick(s.punchIn)}
              />
              <span className="text-neutral-600">→</span>
              {s.punchOut ? (
                <TimeCell
                  log={s.punchOut}
                  canEdit={canEdit}
                  onEditClick={() => onEditClick(s.punchOut as AttendanceLog)}
                  onVoidClick={() => onVoidClick(s.punchOut as AttendanceLog)}
                />
              ) : (
                <span className="flex items-center gap-2">
                  <span className="font-medium text-emerald-400">still in</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => onCloseShift(s.employeeId, s.employeeName)}
                      className="flex items-center gap-1 rounded-full bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
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
      <div className="mt-2.5 flex items-center justify-between border-t border-neutral-800 pt-2.5 text-sm">
        <span className="text-neutral-400">Total</span>
        <span className="font-medium">{formatDuration(row.totalMs)}</span>
      </div>
    </div>
  );
}

export function EditAttendanceModal({
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

export function CloseShiftModal({
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

export function VoidModal({
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

export function AddPunchModal({
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
