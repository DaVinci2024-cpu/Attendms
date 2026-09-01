"use client";

import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  History,
  Loader2,
  Plus,
  Printer,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { RequireAdmin, usePermissions } from "@/components/RequireAdmin";
import { SchedulePrintView } from "@/components/SchedulePrintView";
import {
  fetchAllEmployees,
  fetchScheduleColumnTemplate,
  fetchWeekSchedule,
  saveScheduleColumnTemplate,
  saveWeekSchedule,
} from "@/lib/firestoreRepo";
import { cellAssignments, defaultColumns } from "@/lib/schedule";
import { mondayOf, toWeekId } from "@/lib/week";
import type {
  Employee,
  ScheduleAssignment,
  ScheduleColumnTemplate,
  WeekSchedule,
} from "@/lib/types";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function defaultRows(monday: Date) {
  return DAY_NAMES.map((name, i) => {
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
}

function omitKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
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
  const { has, uid, email } = usePermissions();
  const canEdit = has("manage_schedule");
  const editorName = email ?? uid;

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [schedule, setSchedule] = useState<WeekSchedule | null>(null);
  const [columnTemplate, setColumnTemplate] = useState<ScheduleColumnTemplate | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
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
        const [existing, emps, template] = await Promise.all([
          fetchWeekSchedule(weekId),
          fetchAllEmployees(),
          fetchScheduleColumnTemplate(),
        ]);
        if (cancelled) return;
        setEmployees(emps);
        setColumnTemplate(template);

        if (existing) {
          const isCustom = existing.customColumns ?? false;
          setSchedule({
            ...existing,
            columns: isCustom ? existing.columns : template?.columns ?? existing.columns,
            customColumns: isCustom,
          });
        } else {
          setSchedule({
            weekId,
            columns: template?.columns ?? defaultColumns(),
            customColumns: false,
            rows: defaultRows(weekStart),
            updatedAt: new Date().toISOString(),
          });
        }
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

  function addAssignment(rowId: string, columnId: string, employee: Employee) {
    setSchedule((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r) =>
              r.rowId === rowId
                ? {
                    ...r,
                    cells: {
                      ...r.cells,
                      [columnId]: [
                        ...cellAssignments(r.cells, columnId),
                        { employeeId: employee.employeeId, employeeName: employee.fullName },
                      ],
                    },
                  }
                : r
            ),
          }
        : prev
    );
    setDirty(true);
  }

  function removeAssignment(rowId: string, columnId: string, employeeId: string) {
    setSchedule((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r) =>
              r.rowId === rowId
                ? {
                    ...r,
                    cells: {
                      ...r.cells,
                      [columnId]: cellAssignments(r.cells, columnId).filter(
                        (a) => a.employeeId !== employeeId
                      ),
                    },
                  }
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

  // Splits this week's columns off from the standard set — from now on,
  // editing columns here only affects this week.
  function keepSeparate() {
    setSchedule((prev) => (prev ? { ...prev, customColumns: true } : prev));
    setDirty(true);
  }

  // Drops this week's own columns and goes back to following the standard
  // set (picking up whatever it currently is, even if it changed since).
  function useStandardColumns() {
    setSchedule((prev) =>
      prev
        ? {
            ...prev,
            customColumns: false,
            columns: columnTemplate?.columns ?? prev.columns,
          }
        : prev
    );
    setDirty(true);
  }

  async function handleSave() {
    if (!schedule) return;
    setSaving(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const firstSave = !schedule.createdAt;
      const payload: WeekSchedule = {
        ...schedule,
        updatedAt: now,
        updatedBy: uid,
        updatedByName: editorName,
        createdBy: firstSave ? uid : schedule.createdBy,
        createdByName: firstSave ? editorName : schedule.createdByName,
        createdAt: firstSave ? now : schedule.createdAt,
      };
      await saveWeekSchedule(payload);
      if (!payload.customColumns) {
        const template: ScheduleColumnTemplate = { columns: payload.columns, updatedAt: now };
        await saveScheduleColumnTemplate(template);
        setColumnTemplate(template);
      }
      setSchedule(payload);
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
    <>
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-8 print:hidden">
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
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!schedule}
            className="flex items-center gap-1.5 rounded-lg bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer className="h-4 w-4" /> Print
          </button>
        </div>
      </div>

      {!canEdit && (
        <p className="rounded-lg bg-neutral-900 px-3 py-2 text-sm text-neutral-400">
          You have read-only access to the schedule.
        </p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading || !schedule ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : (
        <>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
              {schedule.customColumns ? (
                <>
                  <span>
                    This week has its own columns, separate from the standard schedule.
                  </span>
                  <button
                    type="button"
                    onClick={useStandardColumns}
                    className="text-blue-400 underline hover:text-blue-300"
                  >
                    Use standard columns
                  </button>
                </>
              ) : (
                <>
                  <span>
                    These columns are the standard schedule — editing them updates
                    every week that hasn&apos;t been kept separate.
                  </span>
                  <button
                    type="button"
                    onClick={keepSeparate}
                    className="text-blue-400 underline hover:text-blue-300"
                  >
                    Keep this week separate
                  </button>
                </>
              )}
            </div>
          )}

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
                      {canEdit ? (
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
                      ) : (
                        col.label
                      )}
                    </th>
                  ))}
                  {canEdit && (
                    <th className="border-b border-neutral-800 px-3 py-2">
                      <button
                        type="button"
                        onClick={addColumn}
                        className="flex items-center gap-1 text-neutral-400 hover:text-neutral-200"
                      >
                        <Plus className="h-4 w-4" /> Column
                      </button>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {schedule.rows.map((row) => (
                  <tr key={row.rowId} className="border-b border-neutral-800">
                    <td className="px-3 py-2 align-top">
                      {canEdit ? (
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
                      ) : (
                        row.label
                      )}
                    </td>
                    {schedule.columns.map((col) => (
                      <td key={col.columnId} className="px-3 py-2 align-top">
                        <CellAssignments
                          assignments={cellAssignments(row.cells, col.columnId)}
                          employees={employees}
                          editable={canEdit}
                          onAdd={(employee) =>
                            addAssignment(row.rowId, col.columnId, employee)
                          }
                          onRemove={(employeeId) =>
                            removeAssignment(row.rowId, col.columnId, employeeId)
                          }
                        />
                      </td>
                    ))}
                    {canEdit && <td />}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canEdit && (
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
          )}

          {schedule.createdAt && (
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <History className="h-3.5 w-3.5 shrink-0" />
              <span>
                Created by {schedule.createdByName ?? "—"} on{" "}
                {new Date(schedule.createdAt).toLocaleString()}
                {schedule.updatedAt !== schedule.createdAt && schedule.updatedByName && (
                  <>
                    {" "}
                    · Last edited by {schedule.updatedByName} on{" "}
                    {new Date(schedule.updatedAt).toLocaleString()}
                  </>
                )}
              </span>
            </div>
          )}
        </>
      )}
    </div>
    {schedule && <SchedulePrintView schedule={schedule} />}
    </>
  );
}

function CellAssignments({
  assignments,
  employees,
  editable,
  onAdd,
  onRemove,
}: {
  assignments: ScheduleAssignment[];
  employees: Employee[];
  editable: boolean;
  onAdd: (employee: Employee) => void;
  onRemove: (employeeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const assignedIds = new Set(assignments.map((a) => a.employeeId));
  const allAvailable = employees
    .filter((e) => e.active && !assignedIds.has(e.employeeId))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const filtered = allAvailable.filter((e) =>
    e.fullName.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="flex min-w-[170px] flex-col gap-1">
      {assignments.length === 0 && !editable && (
        <span className="text-neutral-600">—</span>
      )}
      {assignments.map((a) => (
        <span
          key={a.employeeId}
          className="flex items-center justify-between gap-2 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
        >
          {a.employeeName}
          {editable && (
            <button
              type="button"
              onClick={() => onRemove(a.employeeId)}
              className="text-neutral-500 hover:text-red-400"
              title="Remove"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}

      {editable && allAvailable.length > 0 && (
        open ? (
          <div className="flex flex-col gap-1 rounded bg-neutral-800 p-1.5">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name..."
              className="rounded bg-neutral-950 px-2 py-1 text-xs text-neutral-100 outline-none placeholder:text-neutral-500 focus:ring-2 focus:ring-blue-600"
            />
            <div className="flex max-h-36 flex-col overflow-y-auto">
              {filtered.map((emp) => (
                <button
                  key={emp.employeeId}
                  type="button"
                  onClick={() => {
                    onAdd(emp);
                    setSearch("");
                  }}
                  className="rounded px-2 py-1 text-left text-xs text-neutral-100 hover:bg-neutral-700"
                >
                  {emp.fullName}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-2 py-1 text-xs text-neutral-500">No matches.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSearch("");
              }}
              className="text-left text-xs text-neutral-500 hover:text-neutral-300"
            >
              Close
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded px-2 py-1 text-left text-xs text-neutral-400 hover:bg-neutral-800"
          >
            + Add employee
          </button>
        )
      )}
    </div>
  );
}
