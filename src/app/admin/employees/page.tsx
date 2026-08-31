"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  LayoutDashboard,
  Loader2,
  Trash2,
  UserPlus,
} from "lucide-react";
import { RequireAdmin } from "@/components/RequireAdmin";
import { deleteEmployee, fetchAllEmployees } from "@/lib/firestoreRepo";
import type { Employee } from "@/lib/types";

export default function AdminEmployeesPage() {
  return (
    <RequireAdmin>
      <EmployeeList />
    </RequireAdmin>
  );
}

function EmployeeList() {
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllEmployees()
      .then((emps) => {
        if (!cancelled) setEmployees(emps);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load employees");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete(employeeId: string, fullName: string) {
    if (
      !window.confirm(
        `Delete ${fullName}'s face descriptors and consent record? This cannot be undone, and they will no longer be recognized at the kiosk.`
      )
    ) {
      return;
    }
    setDeletingId(employeeId);
    try {
      await deleteEmployee(employeeId);
      setEmployees((prev) => prev?.filter((e) => e.employeeId !== employeeId) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete employee");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/admin/dashboard"
            className="flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200"
          >
            <LayoutDashboard className="h-4 w-4" /> Dashboard
          </Link>
          <Link
            href="/enroll"
            className="flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200"
          >
            <UserPlus className="h-4 w-4" /> Enroll new
          </Link>
        </div>
      </div>

      <h1 className="text-2xl font-semibold">Employees</h1>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {employees === null && !error && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      )}

      {employees !== null && employees.length === 0 && (
        <p className="text-sm text-neutral-400">
          No employees enrolled yet.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {employees?.map((employee) => (
          <li
            key={employee.employeeId}
            className="flex items-center justify-between rounded-lg bg-neutral-900 px-4 py-3"
          >
            <div>
              <p className="font-medium">{employee.fullName}</p>
              <p className="text-xs text-neutral-400">
                {employee.faceDescriptors.length} snapshot
                {employee.faceDescriptors.length === 1 ? "" : "s"} · {employee.role}
                {!employee.active && " · inactive"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/admin/employees/${employee.employeeId}`}
                className="flex items-center gap-1 rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
              >
                <CalendarDays className="h-4 w-4" /> Schedule
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(employee.employeeId, employee.fullName)}
                disabled={deletingId === employee.employeeId}
                className="flex items-center gap-1 rounded-lg bg-red-900/50 px-3 py-2 text-sm text-red-300 hover:bg-red-900/80 disabled:opacity-50"
              >
                {deletingId === employee.employeeId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
