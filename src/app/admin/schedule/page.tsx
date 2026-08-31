"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { RequireAdmin } from "@/components/RequireAdmin";
import { fetchWeekSchedule, saveWeekSchedule } from "@/lib/firestoreRepo";
import { mondayOf, toWeekId } from "@/lib/week";
import type { ScheduleColumn, WeekSchedule } from "@/lib/types";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function defaultSchedule(monday: Date): WeekSchedule {
  const rows = DAY_NAMES.map((name, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return {
      rowId: `row_${crypto.randomUUID()}`,
      label: `${name}, ${d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}`,
      cells: {},
    };
  });
  const columns: ScheduleColumn[] = [
    { columnId: `col_${crypto.randomUUID()}`, label: "Shift" },
  ];
  return {
    weekId: toWeekId(monday),
    columns,
    rows,
    updatedAt: new Date().toISOString(),
  };
}

function omitKey(
  obj: Record<string, string>,
  key: string
): Record<string, string> {
  const next = { ...obj };
  delete next[key];
  return next;
}

export default function AdminSchedulePage() {
  return (
    <RequireAdmin>
      <ScheduleGrid />
    </RequireAdmin>
  );
}

function ScheduleGrid() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [schedule, setSchedule] = useState<WeekSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weekId = toWeekId(weekStart);

  useEffect(() => {
    let cancelled = false;

    async function loadSchedule() {
      setLoading(true);
      setError(null);
      try {
        const existing = await fetchWeekSchedule(weekId);
        if (cancelled) return;
        setSchedule(existing ?? defaultSchedule(weekStart));
        setDirty(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load schedule");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSchedule();

    return () => {
      cancelled = true;
    };
  }, [weekId, weekStart]);

  function updateCell(rowId: string, columnId: string, value: string) {
    setSchedule((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r) =>
              r.rowId === rowId
                ? { ...r, cells: { ...r.cells, [columnId]: value } }
                : r
            ),
          }
        : prev
    );
    setDirty(true);
  }

  function renameColumn(columnId: string, label: string) {
    setSchedule((prev) =>
      prev
        ? {
            ...prev,
            columns: prev.columns.map((c) =>
              c.columnId === columnId ? { ...c, label } : c
            ),
          }
        : prev
    );
    setDirty(true);
  }

  function renameRow(rowId: string, label: string) {
    setSchedule((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r) => (r.rowId === rowId ? { ...r, label } : r)),
          }
        : prev
    );
    setDirty(true);
  }

  function addColumn() {
    setSchedule((prev) =>
      prev
        ? {
            ...prev,
            columns: [
              ...prev.columns,
              { columnId: `col_${crypto.randomUUID()}`, label: "New column" },
            ],
          }
        : prev
    );
    setDirty(true);
  }

  function removeColumn(columnId: string) {
    setSchedule((prev) =>
      prev
        ? {
            ...prev,
            columns: prev.columns.filter((c) => c.columnId !== columnId),
            rows: prev.rows.map((r) => ({
              ...r,
              cells: omitKey(r.cells, columnId),
            })),
          }
        : prev
    );
    setDirty(true);
  }

  function addRow() {
    setSchedule((prev) =>
      prev
        ? {
            ...prev,
            rows: [
              ...prev.rows,
              { rowId: `row_${crypto.randomUUID()}`, label: "New row", cells: {} },
            ],
          }
        : prev
    );
    setDirty(true);
  }

  function removeRow(rowId: string) {
    setSchedule((prev) =>
      prev ? { ...prev, rows: prev.rows.filter((r) => r.rowId !== rowId) } : prev
    );
    setDirty(true);
  }

  async function handleSave() {
    if (!schedule) return;
    setSaving(true);
    setError(null);
    try {
      await saveWeekSchedule({ ...schedule, updatedAt: new Date().toISOString() });
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setSaving(false);
    }
  }

  function goToWeek(offsetWeeks: number) {
    if (
      dirty &&
      !window.confirm("You have unsaved changes. Discard them and switch weeks?")
    ) {
      return;
    }
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + offsetWeeks * 7);
      return mondayOf(next);
    });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-8">
      <Link
        href="/admin/dashboard"
        className="flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200"
      >
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Schedule</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => goToWeek(-1)}
            className="rounded-lg bg-neutral-800 p-2 hover:bg-neutral-700"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-neutral-400">Week of {weekId}</span>
          <button
            type="button"
            onClick={() => goToWeek(1)}
            className="rounded-lg bg-neutral-800 p-2 hover:bg-neutral-700"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading || !schedule ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl bg-neutral-900">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  <th className="min-w-[160px] border-b border-neutral-800 px-3 py-2 text-neutral-400">
                    Day
                  </th>
                  {schedule.columns.map((col) => (
                    <th
                      key={col.columnId}
                      className="border-b border-neutral-800 px-3 py-2"
                    >
                      <div className="flex items-center gap-1">
                        <input
                          className="w-32 rounded bg-neutral-800 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-600"
                          value={col.label}
                          onChange={(e) => renameColumn(col.columnId, e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => removeColumn(col.columnId)}
                          className="text-neutral-500 hover:text-red-400"
                          title="Remove column"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="border-b border-neutral-800 px-3 py-2">
                    <button
                      type="button"
                      onClick={addColumn}
                      className="flex items-center gap-1 text-neutral-400 hover:text-neutral-200"
                    >
                      <Plus className="h-4 w-4" /> Column
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedule.rows.map((row) => (
                  <tr key={row.rowId} className="border-b border-neutral-800">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <input
                          className="w-36 rounded bg-neutral-800 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-600"
                          value={row.label}
                          onChange={(e) => renameRow(row.rowId, e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => removeRow(row.rowId)}
                          className="text-neutral-500 hover:text-red-400"
                          title="Remove row"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                    {schedule.columns.map((col) => (
                      <td key={col.columnId} className="px-3 py-2">
                        <input
                          className="w-32 rounded bg-neutral-800 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-600"
                          placeholder="Name / time"
                          value={row.cells[col.columnId] ?? ""}
                          onChange={(e) =>
                            updateCell(row.rowId, col.columnId, e.target.value)
                          }
                        />
                      </td>
                    ))}
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200"
            >
              <Plus className="h-4 w-4" /> Add row
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {dirty ? "Save changes" : "Saved"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
