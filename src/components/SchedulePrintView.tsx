import { COMPANY_NAME } from "@/lib/constants";
import { cellAssignments } from "@/lib/schedule";
import type { WeekSchedule } from "@/lib/types";

function weekRangeLabel(weekId: string): string {
  const start = new Date(`${weekId}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const startLabel = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const endLabel = end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startLabel} – ${endLabel}`;
}

// Only ever visible in print output (see the `hidden print:block` on the
// outer div) — the on-screen editor/viewer has its own dark UI hidden the
// same way in reverse, so printing shows just this clean, light layout.
export function SchedulePrintView({
  schedule,
  subtitle,
  highlightEmployeeId,
}: {
  schedule: WeekSchedule;
  subtitle?: string;
  highlightEmployeeId?: string;
}) {
  return (
    <div className="hidden print:block print:bg-white print:text-black">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-bold">{COMPANY_NAME}</h1>
          <p className="text-sm">Weekly Schedule — {weekRangeLabel(schedule.weekId)}</p>
          {subtitle && <p className="text-xs text-neutral-600">{subtitle}</p>}
        </div>
        <p className="text-xs text-neutral-600">Printed {new Date().toLocaleString()}</p>
      </div>

      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            <th className="border border-black px-2 py-1">Day</th>
            {schedule.columns.map((col) => (
              <th key={col.columnId} className="border border-black px-2 py-1">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {schedule.rows.map((row) => (
            <tr key={row.rowId}>
              <td className="border border-black px-2 py-1 font-medium">{row.label}</td>
              {schedule.columns.map((col) => {
                const assignments = cellAssignments(row.cells, col.columnId);
                return (
                  <td key={col.columnId} className="border border-black px-2 py-1 align-top">
                    {assignments.length === 0
                      ? "—"
                      : assignments
                          .map((a) =>
                            a.employeeId === highlightEmployeeId
                              ? `${a.employeeName} (you)`
                              : a.employeeName
                          )
                          .join(", ")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {schedule.createdAt && (
        <p className="mt-3 text-xs text-neutral-600">
          Created by {schedule.createdByName ?? "—"} on{" "}
          {new Date(schedule.createdAt).toLocaleString()}
          {schedule.updatedAt !== schedule.createdAt && schedule.updatedByName && (
            <>
              {" "}
              · Last edited by {schedule.updatedByName} on{" "}
              {new Date(schedule.updatedAt).toLocaleString()}
            </>
          )}
        </p>
      )}
    </div>
  );
}
