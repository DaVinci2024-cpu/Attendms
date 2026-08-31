"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarPlus, Loader2, Trash2 } from "lucide-react";
import { RequireAdmin } from "@/components/RequireAdmin";
import {
  createShift,
  deleteShift,
  fetchEmployee,
  fetchShiftsForEmployee,
} from "@/lib/firestoreRepo";
import type { Employee, Shift } from "@/lib/types";

export default function EmployeeSchedulePage() {
  return (
    <RequireAdmin>
      <EmployeeSchedule />
    </RequireAdmin>
  );
}

function EmployeeSchedule() {
  const params = useParams<{ employeeId: string }>();
  const employeeId = params.employeeId;

  const [employee, setEmployee] = useState<Employee | null | undefined>(undefined);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchEmployee(employeeId), fetchShiftsForEmployee(employeeId)])
      .then(([emp, shiftList]) => {
        if (cancelled) return;
        setEmployee(emp);
        setShifts(shiftList);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const canAddShift =
    date.length > 0 && startTime.length > 0 && endTime.length > 0 && endTime > startTime;

  async function handleAddShift() {
    setSaving(true);
    setError(null);
    try {
      const shift: Shift = {
        shiftId: `shift_${crypto.randomUUID()}`,
        employeeId,
        date,
        startTime,
        endTime,
        notes: notes.trim(),
        createdAt: new Date().toISOString(),
      };
      await createShift(shift);
      setShifts((prev) =>
        [...prev, shift].sort((a, b) => a.date.localeCompare(b.date))
      );
      setDate("");
      setStartTime("");
      setEndTime("");
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add shift");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteShift(shiftId: string) {
    setDeletingId(shiftId);
    try {
      await deleteShift(employeeId, shiftId);
      setShifts((prev) => prev.filter((s) => s.shiftId !== shiftId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete shift");
    } finally {
      setDeletingId(null);
    }
  }

  const sortedShifts = [...shifts].sort((a, b) => a.date.localeCompare(b.date));
  const today = new Date().toLocaleDateString("en-CA");
  const upcoming = sortedShifts.filter((s) => s.date >= today);
  const past = sortedShifts.filter((s) => s.date < today).reverse();

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <Link
        href="/admin/employees"
        className="flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back to employees
      </Link>

      {employee === undefined && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      )}

      {employee === null && (
        <p className="text-sm text-red-400">Employee not found.</p>
      )}

      {employee && (
        <>
          <h1 className="text-2xl font-semibold">{employee.fullName}&apos;s schedule</h1>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex flex-wrap items-end gap-3 rounded-xl bg-neutral-900 p-4">
            <label className="flex flex-col gap-1 text-sm">
              Date
              <input
                type="date"
                className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Start
              <input
                type="time"
                className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              End
              <input
                type="time"
                className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Notes (optional)
              <input
                type="text"
                className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. front desk"
              />
            </label>
            <button
              type="button"
              onClick={handleAddShift}
              disabled={!canAddShift || saving}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CalendarPlus className="h-4 w-4" />
              )}
              Add shift
            </button>
          </div>

          <ShiftList
            title="Upcoming shifts"
            shifts={upcoming}
            onDelete={handleDeleteShift}
            deletingId={deletingId}
          />
          <ShiftList
            title="Past shifts"
            shifts={past}
            onDelete={handleDeleteShift}
            deletingId={deletingId}
          />
        </>
      )}
    </div>
  );
}

function ShiftList({
  title,
  shifts,
  onDelete,
  deletingId,
}: {
  title: string;
  shifts: Shift[];
  onDelete: (shiftId: string) => void;
  deletingId: string | null;
}) {
  return (
    <section>
      <h2 className="mb-2 font-medium">
        {title} ({shifts.length})
      </h2>
      {shifts.length === 0 ? (
        <p className="text-sm text-neutral-400">None.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shifts.map((shift) => (
            <li
              key={shift.shiftId}
              className="flex items-center justify-between rounded-lg bg-neutral-900 px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {shift.date} · {shift.startTime}–{shift.endTime}
                </p>
                {shift.notes && (
                  <p className="text-neutral-400">{shift.notes}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDelete(shift.shiftId)}
                disabled={deletingId === shift.shiftId}
                className="flex items-center gap-1 rounded-lg bg-red-900/50 px-3 py-2 text-red-300 hover:bg-red-900/80 disabled:opacity-50"
              >
                {deletingId === shift.shiftId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
