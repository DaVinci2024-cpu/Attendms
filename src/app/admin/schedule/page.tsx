"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Copy,
  History,
  Loader2,
  MessageSquare,
  Plus,
  Printer,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { usePermissions } from "@/components/RequireAdmin";
import { SchedulePrintView } from "@/components/SchedulePrintView";
import { PageHeader } from "@/components/PageHeader";
import {
  fetchAllEmployees,
  fetchAvailabilityForWeek,
  fetchScheduleColumnTemplate,
  fetchShiftNotesForWeek,
  fetchWeekSchedule,
  postShiftNote,
  saveScheduleColumnTemplate,
  saveWeekSchedule,
} from "@/lib/firestoreRepo";
import { cellAssignments, defaultColumns } from "@/lib/schedule";
import { columnColor, type ColumnColor } from "@/lib/columnColors";
import { DEPARTMENT_PRESETS } from "@/lib/constants";
import { sortDepartments, UNASSIGNED_DEPARTMENT } from "@/lib/departments";
import { mondayOf, toWeekId, weeksInMonth } from "@/lib/week";
import {
  COMPANY_TIME_ZONE,
  companyDateKeyToUtc,
  companyFields,
  companyTimeToUtc,
} from "@/lib/companyTime";
import type {
  AvailabilityEntry,
  Employee,
  ScheduleAssignment,
  ScheduleColumn,
  ScheduleColumnTemplate,
  ShiftNote,
  ShiftSupervisor,
  WeekSchedule,
} from "@/lib/types";

// Which department tab a column/row-cell belongs to — untagged columns
// (from before departments existed, or deliberately left unassigned) group
// under UNASSIGNED_DEPARTMENT, same convention as the dashboard.
function columnDepartment(column: ScheduleColumn): string {
  return column.department?.trim() || UNASSIGNED_DEPARTMENT;
}

function employeeDepartment(employee: Employee): string {
  return employee.department?.trim() || UNASSIGNED_DEPARTMENT;
}

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
  const { year, month, day } = companyFields(monday);
  return DAY_NAMES.map((name, i) => {
    const d = companyTimeToUtc(year, month, day + i);
    return {
      rowId: `row_${crypto.randomUUID()}`,
      label: `${name}, ${d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: COMPANY_TIME_ZONE,
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
  return <ScheduleGrid />;
}

function ScheduleGrid() {
  const { has, uid, displayName } = usePermissions();
  const canEdit = has("manage_schedule");
  const editorName = displayName;

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [schedule, setSchedule] = useState<WeekSchedule | null>(null);
  const [columnTemplate, setColumnTemplate] = useState<ScheduleColumnTemplate | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [availability, setAvailability] = useState<AvailabilityEntry[]>([]);
  const [notes, setNotes] = useState<ShiftNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDept, setActiveDept] = useState<string>(UNASSIGNED_DEPARTMENT);

  const weekId = toWeekId(weekStart);

  // Tabs shown regardless of what's tagged this particular week, so a tab
  // doesn't disappear just because this week has no columns in it yet.
  const deptTabs = useMemo(() => {
    const known = new Set<string>(DEPARTMENT_PRESETS);
    for (const e of employees) {
      if (e.department?.trim()) known.add(e.department.trim());
    }
    if (schedule) {
      for (const c of schedule.columns) {
        if (c.department?.trim()) known.add(c.department.trim());
      }
    }
    known.add(UNASSIGNED_DEPARTMENT);
    return sortDepartments(known);
  }, [employees, schedule]);

  // Falls back to the first tab whenever the stored activeDept isn't (or
  // isn't yet) one of the current tabs — e.g. right after load, or if the
  // employee/column data that produced a custom tab disappears — without
  // needing an effect just to keep a derived value in sync.
  const activeDeptResolved =
    deptTabs.includes(activeDept) ? activeDept : deptTabs[0] ?? UNASSIGNED_DEPARTMENT;

  const visibleColumns = useMemo(
    () =>
      schedule ? schedule.columns.filter((c) => columnDepartment(c) === activeDeptResolved) : [],
    [schedule, activeDeptResolved]
  );
  const columnIndexById = useMemo(
    () => new Map((schedule?.columns ?? []).map((c, i) => [c.columnId, i])),
    [schedule]
  );
  const deptEmployees = useMemo(
    () => employees.filter((e) => employeeDepartment(e) === activeDeptResolved),
    [employees, activeDeptResolved]
  );
  const monthWeeks = useMemo(() => weeksInMonth(weekStart), [weekStart]);

  useEffect(() => {
    let cancelled = false;

    async function loadSchedule() {
      setLoading(true);
      setError(null);

      // Fetched independently (not one Promise.all'd batch) so a
      // permissions gap on one newer collection (e.g. rules not yet
      // published for shiftNotes/availability) can never block the core
      // schedule — which would otherwise load fine — from displaying.
      let existing: WeekSchedule | null = null;
      let emps: Employee[] = [];
      let template: ScheduleColumnTemplate | null = null;
      let hadCoreError = false;
      try {
        [existing, emps, template] = await Promise.all([
          fetchWeekSchedule(weekId),
          fetchAllEmployees(),
          fetchScheduleColumnTemplate(),
        ]);
      } catch (err) {
        hadCoreError = true;
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load schedule");
        }
      }
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
      } else if (!hadCoreError) {
        setSchedule({
          weekId,
          columns: template?.columns ?? defaultColumns(),
          customColumns: false,
          rows: defaultRows(weekStart),
          updatedAt: new Date().toISOString(),
        });
      }
      setDirty(false);

      try {
        setAvailability(await fetchAvailabilityForWeek(weekId));
      } catch {
        // Non-critical — availability panel just won't show.
      }
      try {
        setNotes(await fetchShiftNotesForWeek(weekId));
      } catch {
        // Non-critical — note counts just won't show.
      }

      if (!cancelled) setLoading(false);
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

  // Posted immediately, independent of the Save/dirty flow — a note isn't
  // part of the schedule doc itself, so there's nothing to lose by leaving
  // this week without hitting Save.
  async function postNote(rowId: string, columnId: string, message: string) {
    const note: ShiftNote = {
      noteId: `note_${crypto.randomUUID()}`,
      weekId,
      rowId,
      columnId,
      authorUid: uid,
      authorName: editorName,
      message,
      postedAt: new Date().toISOString(),
    };
    await postShiftNote(note);
    setNotes((prev) => [...prev, note]);
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

  // A column with either time left blank gets no lateness/early-leave
  // enforcement at the kiosk — both must be set for that to apply.
  function setColumnTime(columnId: string, field: "startTime" | "endTime", value: string) {
    setSchedule((prev) =>
      prev
        ? {
            ...prev,
            columns: prev.columns.map((c) =>
              c.columnId === columnId ? { ...c, [field]: value || undefined } : c
            ),
          }
        : prev
    );
    setDirty(true);
  }

  function setSupervisor(rowId: string, columnId: string, employee: Employee) {
    setSchedule((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r) =>
              r.rowId === rowId
                ? {
                    ...r,
                    supervisors: {
                      ...r.supervisors,
                      [columnId]: {
                        employeeId: employee.employeeId,
                        employeeName: employee.fullName,
                      },
                    },
                  }
                : r
            ),
          }
        : prev
    );
    setDirty(true);
  }

  function clearSupervisor(rowId: string, columnId: string) {
    setSchedule((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r) =>
              r.rowId === rowId
                ? { ...r, supervisors: omitKey(r.supervisors ?? {}, columnId) }
                : r
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
              {
                columnId: `col_${crypto.randomUUID()}`,
                label: "New column",
                department: activeDeptResolved === UNASSIGNED_DEPARTMENT ? undefined : activeDeptResolved,
              },
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

  // A week saved before per-department waiving existed may still carry the
  // legacy whole-schedule scheduleRequirementWaived flag — treat that as
  // "every department is waived" for display purposes without needing to
  // migrate old documents.
  function isWaivedForDepartment(week: WeekSchedule, dept: string): boolean {
    if (week.scheduleRequirementWaived) return true;
    return (week.scheduleRequirementWaivedDepartments ?? []).includes(dept);
  }

  function toggleScheduleRequirementWaived(dept: string) {
    setSchedule((prev) => {
      if (!prev) return prev;
      if (isWaivedForDepartment(prev, dept)) {
        // Turning off. If this week relied on the legacy "waive everyone"
        // flag, convert it into an explicit per-department list minus this
        // one, so every other department keeps behaving the same.
        const nextDepartments = prev.scheduleRequirementWaived
          ? deptTabs.filter((d) => d !== dept)
          : (prev.scheduleRequirementWaivedDepartments ?? []).filter((d) => d !== dept);
        return {
          ...prev,
          scheduleRequirementWaived: false,
          scheduleRequirementWaivedDepartments: nextDepartments,
        };
      }
      return {
        ...prev,
        scheduleRequirementWaivedDepartments: [
          ...(prev.scheduleRequirementWaivedDepartments ?? []),
          dept,
        ],
      };
    });
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

  function confirmDiscardIfDirty(): boolean {
    return (
      !dirty || window.confirm("You have unsaved changes. Discard them and switch weeks?")
    );
  }

  function goToWeek(offsetWeeks: number) {
    if (!confirmDiscardIfDirty()) return;
    setWeekStart((prev) => {
      const { year, month, day } = companyFields(prev);
      return mondayOf(companyTimeToUtc(year, month, day + offsetWeeks * 7));
    });
  }

  function goToMonday(monday: Date) {
    if (!confirmDiscardIfDirty()) return;
    setWeekStart(mondayOf(monday));
  }

  // Copies this week's active department's columns + assignments onto
  // every other week in the current calendar month, replacing whatever
  // that department already had there. Rows are paired by day-of-week
  // index (both weeks are the standard 7-day Monday-first layout) — a week
  // with manually added/removed/reordered rows can pair incorrectly; that
  // limitation is accepted rather than solved here.
  async function copyDepartmentToMonth() {
    if (!schedule || !canEdit) return;
    const sourceColumns = schedule.columns.filter((c) => columnDepartment(c) === activeDeptResolved);
    if (sourceColumns.length === 0) {
      window.alert(`No ${activeDeptResolved} columns this week to copy.`);
      return;
    }
    const targets = monthWeeks.filter((m) => toWeekId(m) !== weekId);
    if (targets.length === 0) return;
    if (
      !window.confirm(
        `Copy this week's ${activeDeptResolved} schedule to the other ${targets.length} week${
          targets.length === 1 ? "" : "s"
        } in this month? This replaces any existing ${activeDeptResolved} columns and assignments in those weeks.`
      )
    ) {
      return;
    }

    setCopying(true);
    setError(null);
    try {
      for (const monday of targets) {
        const targetWeekId = toWeekId(monday);
        const existing = await fetchWeekSchedule(targetWeekId);
        const base: WeekSchedule =
          existing ?? {
            weekId: targetWeekId,
            columns: columnTemplate?.columns ?? defaultColumns(),
            customColumns: false,
            rows: defaultRows(monday),
            updatedAt: new Date().toISOString(),
          };

        const idMap = new Map(
          sourceColumns.map((c) => [c.columnId, `col_${crypto.randomUUID()}`])
        );
        const newColumns: ScheduleColumn[] = sourceColumns.map((c) => ({
          ...c,
          columnId: idMap.get(c.columnId)!,
        }));
        const keptColumns = base.columns.filter((c) => columnDepartment(c) !== activeDeptResolved);
        const mergedColumns = [...keptColumns, ...newColumns];

        const mergedRows = base.rows.map((targetRow, i) => {
          const sourceRow = schedule.rows[i];
          const nextCells: Record<string, ScheduleAssignment[]> = {};
          const nextSupervisors: Record<string, ShiftSupervisor> = {};

          for (const col of keptColumns) {
            const assignments = cellAssignments(targetRow.cells, col.columnId);
            if (assignments.length > 0) nextCells[col.columnId] = assignments;
            const sup = targetRow.supervisors?.[col.columnId];
            if (sup) nextSupervisors[col.columnId] = sup;
          }
          if (sourceRow) {
            for (const srcCol of sourceColumns) {
              const newColId = idMap.get(srcCol.columnId)!;
              const assignments = cellAssignments(sourceRow.cells, srcCol.columnId);
              if (assignments.length > 0) nextCells[newColId] = assignments;
              const sup = sourceRow.supervisors?.[srcCol.columnId];
              if (sup) nextSupervisors[newColId] = sup;
            }
          }

          return {
            ...targetRow,
            cells: nextCells,
            supervisors: Object.keys(nextSupervisors).length > 0 ? nextSupervisors : undefined,
          };
        });

        const now = new Date().toISOString();
        const payload: WeekSchedule = {
          ...base,
          weekId: targetWeekId,
          columns: mergedColumns,
          rows: mergedRows,
          updatedAt: now,
          updatedBy: uid,
          updatedByName: editorName,
          createdBy: base.createdAt ? base.createdBy : uid,
          createdByName: base.createdAt ? base.createdByName : editorName,
          createdAt: base.createdAt ?? now,
        };
        await saveWeekSchedule(payload);
      }
      window.alert(`Copied ${activeDeptResolved}'s schedule to ${targets.length} other week(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy schedule to the month");
    } finally {
      setCopying(false);
    }
  }

  return (
    <>
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-8 print:hidden">
      <PageHeader
        title="Schedule"
        accent="pink"
        actions={
          <>
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
          </>
        }
      />

      {!canEdit && (
        <p className="rounded-lg bg-neutral-900 px-3 py-2 text-sm text-neutral-400">
          You have read-only access to the schedule.
        </p>
      )}

      {monthWeeks.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {monthWeeks.map((monday) => {
            const id = toWeekId(monday);
            const isActive = id === weekId;
            return (
              <button
                key={id}
                type="button"
                onClick={() => goToMonday(monday)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-pink-600 text-white"
                    : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                }`}
              >
                Week of{" "}
                {monday.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  timeZone: COMPANY_TIME_ZONE,
                })}
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : !schedule ? null : (
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

          <div className="flex flex-wrap items-center gap-1 border-b border-neutral-800">
            {deptTabs.map((dept) => (
              <button
                key={dept}
                type="button"
                onClick={() => setActiveDept(dept)}
                className={`rounded-t-lg px-3 py-2 text-sm font-medium transition-colors ${
                  dept === activeDeptResolved
                    ? "bg-neutral-900 text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {dept}
              </button>
            ))}
          </div>

          {canEdit && (
            <label
              className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                isWaivedForDepartment(schedule, activeDeptResolved)
                  ? "bg-amber-950/40 text-amber-200"
                  : "bg-neutral-900 text-neutral-400"
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={isWaivedForDepartment(schedule, activeDeptResolved)}
                onChange={() => toggleScheduleRequirementWaived(activeDeptResolved)}
              />
              <span>
                <strong>Allow punch-in without a schedule, for {activeDeptResolved}, this week.</strong>{" "}
                Turns off the &quot;must be on today&apos;s schedule&quot; rule at the kiosk
                for {activeDeptResolved} staff for {weekId} — no supervisor needed either. Doesn&apos;t
                affect other departments or other weeks. For exempting specific employees
                permanently or long-term instead, use{" "}
                <Link href="/admin/permissions" className="underline hover:no-underline">
                  Roles &amp; permissions
                </Link>
                .
              </span>
            </label>
          )}

          {visibleColumns.length === 0 && (
            <p className="rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-500">
              No shift columns for {activeDeptResolved} yet.
              {canEdit && ` Use "+ Column" below to add one.`}
            </p>
          )}

          <div className="overflow-x-auto rounded-xl bg-neutral-900">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  <th className="min-w-[160px] border-b border-neutral-800 px-3 py-2 text-neutral-400">
                    Day
                  </th>
                  {visibleColumns.map((col) => {
                    const color = columnColor(columnIndexById.get(col.columnId) ?? 0);
                    return (
                      <th
                        key={col.columnId}
                        className={`border-b border-b-neutral-800 border-t-2 px-3 py-2 ${color.topBorder}`}
                      >
                        {canEdit ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1">
                              <span className={`h-2 w-2 shrink-0 rounded-full ${color.bar}`} />
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
                            <div className="flex items-center gap-1 text-xs font-normal text-neutral-500">
                              <input
                                type="time"
                                value={col.startTime ?? ""}
                                onChange={(e) =>
                                  setColumnTime(col.columnId, "startTime", e.target.value)
                                }
                                className="w-[6.5rem] rounded bg-neutral-800 px-1 py-0.5 text-neutral-300 outline-none focus:ring-2 focus:ring-blue-600"
                              />
                              <span>–</span>
                              <input
                                type="time"
                                value={col.endTime ?? ""}
                                onChange={(e) =>
                                  setColumnTime(col.columnId, "endTime", e.target.value)
                                }
                                className="w-[6.5rem] rounded bg-neutral-800 px-1 py-0.5 text-neutral-300 outline-none focus:ring-2 focus:ring-blue-600"
                              />
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className={`flex items-center gap-1.5 font-medium ${color.text}`}>
                              <span className={`h-2 w-2 shrink-0 rounded-full ${color.bar}`} />
                              {col.label}
                            </div>
                            {col.startTime && col.endTime && (
                              <div className="text-xs font-normal text-neutral-500">
                                {col.startTime}–{col.endTime}
                              </div>
                            )}
                          </div>
                        )}
                      </th>
                    );
                  })}
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
                    {visibleColumns.map((col) => (
                      <td key={col.columnId} className="px-3 py-2 align-top">
                        <CellAssignments
                          assignments={cellAssignments(row.cells, col.columnId)}
                          employees={deptEmployees}
                          editable={canEdit}
                          color={columnColor(columnIndexById.get(col.columnId) ?? 0)}
                          onAdd={(employee) =>
                            addAssignment(row.rowId, col.columnId, employee)
                          }
                          onRemove={(employeeId) =>
                            removeAssignment(row.rowId, col.columnId, employeeId)
                          }
                          notes={notes.filter(
                            (n) => n.rowId === row.rowId && n.columnId === col.columnId
                          )}
                          onPostNote={(message) => postNote(row.rowId, col.columnId, message)}
                        />
                        <CellSupervisor
                          supervisor={row.supervisors?.[col.columnId] ?? null}
                          employees={employees}
                          editable={canEdit}
                          onSet={(employee) => setSupervisor(row.rowId, col.columnId, employee)}
                          onClear={() => clearSupervisor(row.rowId, col.columnId)}
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

              {monthWeeks.length > 1 && (
                <button
                  type="button"
                  onClick={copyDepartmentToMonth}
                  disabled={copying || dirty || visibleColumns.length === 0}
                  title={
                    dirty
                      ? "Save your changes first"
                      : `Copy this week's ${activeDeptResolved} schedule to the rest of the month`
                  }
                  className="flex items-center gap-2 rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  Copy {activeDeptResolved} to rest of month
                </button>
              )}
            </div>
          )}

          {availability.length > 0 && (
            <div className="rounded-xl bg-neutral-900 p-4">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <CalendarCheck className="h-4 w-4 text-emerald-400" /> Availability
                submitted for this week
              </h2>
              <div className="flex flex-col gap-2">
                {availability.map((entry) => (
                  <div
                    key={entry.employeeId}
                    className="rounded-lg bg-neutral-800/60 px-3 py-2 text-sm"
                  >
                    <p className="font-medium">{entry.employeeName}</p>
                    <ul className="mt-1 flex flex-col gap-0.5 text-xs text-neutral-400">
                      {Object.entries(entry.availableSlots)
                        .filter(([, slots]) => slots.length > 0)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([dateKey, slots]) => (
                          <li key={dateKey}>
                            {companyDateKeyToUtc(dateKey).toLocaleDateString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              timeZone: COMPANY_TIME_ZONE,
                            })}
                            : {slots.map((s) => s.columnLabel).join(", ")}
                          </li>
                        ))}
                    </ul>
                    {entry.note && (
                      <p className="mt-1 text-xs italic text-neutral-500">
                        &quot;{entry.note}&quot;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {schedule.createdAt && (
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <History className="h-3.5 w-3.5 shrink-0" />
              <span>
                Created by {schedule.createdByName ?? "—"} on{" "}
                {new Date(schedule.createdAt).toLocaleString(undefined, {
                  timeZone: COMPANY_TIME_ZONE,
                })}
                {schedule.updatedAt !== schedule.createdAt && schedule.updatedByName && (
                  <>
                    {" "}
                    · Last edited by {schedule.updatedByName} on{" "}
                    {new Date(schedule.updatedAt).toLocaleString(undefined, {
                      timeZone: COMPANY_TIME_ZONE,
                    })}
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
  color,
  onAdd,
  onRemove,
  notes,
  onPostNote,
}: {
  assignments: ScheduleAssignment[];
  employees: Employee[];
  editable: boolean;
  color: ColumnColor;
  onAdd: (employee: Employee) => void;
  onRemove: (employeeId: string) => void;
  notes: ShiftNote[];
  onPostNote: (message: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [posting, setPosting] = useState(false);

  const assignedIds = new Set(assignments.map((a) => a.employeeId));
  const allAvailable = employees
    .filter((e) => e.active && !assignedIds.has(e.employeeId))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const filtered = allAvailable.filter((e) =>
    e.fullName.toLowerCase().includes(search.trim().toLowerCase())
  );
  const supervisorIds = new Set(
    employees.filter((e) => e.isSupervisor).map((e) => e.employeeId)
  );

  return (
    <div className="flex min-w-[170px] flex-col gap-1">
      {assignments.length === 0 && !editable && (
        <span className="text-neutral-600">—</span>
      )}
      {assignments.map((a) => (
        <span
          key={a.employeeId}
          className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs text-neutral-100 ${color.chipBg} ${color.chipBorder}`}
        >
          <span className="flex items-center gap-1">
            {supervisorIds.has(a.employeeId) && (
              <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-400" />
            )}
            {a.employeeName}
          </span>
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

      {notesOpen ? (
        <div className="flex flex-col gap-1 rounded bg-neutral-800/60 p-1.5">
          {notes.map((n) => (
            <p key={n.noteId} className="text-xs text-neutral-300">
              <span className="text-neutral-500">{n.authorName}:</span> {n.message}
            </p>
          ))}
          <div className="flex gap-1">
            <input
              autoFocus
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder="Add a note..."
              className="min-w-0 flex-1 rounded bg-neutral-950 px-2 py-1 text-xs text-neutral-100 outline-none placeholder:text-neutral-500 focus:ring-2 focus:ring-blue-600"
            />
            <button
              type="button"
              disabled={posting || !draftNote.trim()}
              onClick={async () => {
                setPosting(true);
                await onPostNote(draftNote.trim());
                setDraftNote("");
                setPosting(false);
              }}
              className="rounded bg-neutral-700 px-2 text-neutral-300 hover:bg-neutral-600 disabled:cursor-not-allowed disabled:opacity-50"
              title="Post note"
            >
              <Send className="h-3 w-3" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setNotesOpen(false)}
            className="text-left text-xs text-neutral-500 hover:text-neutral-300"
          >
            Close
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setNotesOpen(true)}
          className="flex items-center gap-1 rounded px-2 py-1 text-left text-xs text-neutral-400 hover:bg-neutral-800"
        >
          <MessageSquare className="h-3 w-3" />
          {notes.length > 0 ? `${notes.length} note${notes.length === 1 ? "" : "s"}` : "Note"}
        </button>
      )}
    </div>
  );
}

// The person who can approve a late/unscheduled/early-out override for
// this specific day+shift at the kiosk — not necessarily one of the
// employees assigned to work it. One supervisor per cell; same searchable
// list pattern as CellAssignments rather than a native select (which gets
// hard to scan once there are ~20 employees).
function CellSupervisor({
  supervisor,
  employees,
  editable,
  onSet,
  onClear,
}: {
  supervisor: ShiftSupervisor | null;
  employees: Employee[];
  editable: boolean;
  onSet: (employee: Employee) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  if (!editable) {
    return supervisor ? (
      <p className="mt-1 flex items-center gap-1 text-xs text-neutral-500">
        <ShieldCheck className="h-3 w-3" /> {supervisor.employeeName}
      </p>
    ) : null;
  }

  // Only employees flagged as a supervisor (see /admin/employees) are
  // eligible — a fixed designation, not something picked freely per shift.
  const eligible = employees
    .filter((e) => e.active && e.isSupervisor)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const filtered = eligible.filter((e) =>
    e.fullName.toLowerCase().includes(search.trim().toLowerCase())
  );

  if (supervisor) {
    return (
      <span className="mt-1 flex items-center justify-between gap-2 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100">
        <span className="flex items-center gap-1">
          <ShieldCheck className="h-3 w-3 text-emerald-400" /> {supervisor.employeeName}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-neutral-500 hover:text-red-400"
          title="Remove supervisor"
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    );
  }

  if (open) {
    return (
      <div className="mt-1 flex flex-col gap-1 rounded bg-neutral-800 p-1.5">
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
                onSet(emp);
                setOpen(false);
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
    );
  }

  if (eligible.length === 0) {
    return (
      <Link
        href="/admin/employees"
        className="mt-1 block text-xs text-neutral-500 underline hover:text-neutral-300"
      >
        No one&apos;s marked as a supervisor yet — set one up
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="mt-1 flex items-center gap-1 rounded px-2 py-1 text-left text-xs text-neutral-400 hover:bg-neutral-800"
    >
      <ShieldCheck className="h-3 w-3" /> Set supervisor
    </button>
  );
}
