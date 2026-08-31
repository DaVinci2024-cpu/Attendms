"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Trash2 } from "lucide-react";
import { RequireAdmin } from "@/components/RequireAdmin";
import {
  deleteEmployee,
  fetchAllEmployees,
  fetchEmployeeByPortalUsername,
  linkEmployeePortalAccount,
} from "@/lib/firestoreRepo";
import { createEmployeePortalAccount } from "@/lib/auth";
import { portalEmail } from "@/lib/constants";
import type { Employee } from "@/lib/types";

function slugifyUsername(fullName: string): string {
  return fullName
    .trim()
    .toLowerCase()
    .split(/\s+/)[0]
    .replace(/[^a-z0-9]/g, "");
}

function generateTempPassword(): string {
  // Unambiguous characters only (no 0/O, 1/l/I) — this gets read aloud or
  // handwritten when the admin relays it to the employee in person.
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

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

  function handlePortalLinked(employeeId: string, portalUsername: string) {
    setEmployees((prev) =>
      prev?.map((e) =>
        e.employeeId === employeeId ? { ...e, portalUsername, mustChangePassword: true } : e
      ) ?? null
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
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
          <EmployeeRow
            key={employee.employeeId}
            employee={employee}
            deleting={deletingId === employee.employeeId}
            onDelete={() => handleDelete(employee.employeeId, employee.fullName)}
            onPortalLinked={(username) => handlePortalLinked(employee.employeeId, username)}
          />
        ))}
      </ul>
    </div>
  );
}

function EmployeeRow({
  employee,
  deleting,
  onDelete,
  onPortalLinked,
}: {
  employee: Employee;
  deleting: boolean;
  onDelete: () => void;
  onPortalLinked: (portalUsername: string) => void;
}) {
  const [settingUp, setSettingUp] = useState(false);
  const [username, setUsername] = useState(() => slugifyUsername(employee.fullName));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ username: string; password: string } | null>(
    null
  );

  async function handleCreatePortalLogin() {
    setSaving(true);
    setError(null);
    try {
      const trimmed = username.trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,20}$/.test(trimmed)) {
        setError("Username must be 3-20 characters: letters, numbers, . _ -");
        return;
      }
      const existing = await fetchEmployeeByPortalUsername(trimmed);
      if (existing && existing.employeeId !== employee.employeeId) {
        setError("That username is already taken.");
        return;
      }
      const tempPassword = generateTempPassword();
      const authUid = await createEmployeePortalAccount(
        portalEmail(employee.employeeId),
        tempPassword
      );
      await linkEmployeePortalAccount(employee.employeeId, trimmed, authUid);
      onPortalLinked(trimmed);
      setResult({ username: trimmed, password: tempPassword });
      setSettingUp(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set up portal login");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-lg bg-neutral-900 px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{employee.fullName}</p>
          <p className="text-xs text-neutral-400">
            {employee.faceDescriptors.length} snapshot
            {employee.faceDescriptors.length === 1 ? "" : "s"} · {employee.role}
            {!employee.active && " · inactive"}
            {employee.portalUsername && ` · portal: ${employee.portalUsername}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!employee.portalUsername && !settingUp && (
            <button
              type="button"
              onClick={() => setSettingUp(true)}
              className="flex items-center gap-1 rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
            >
              <KeyRound className="h-4 w-4" /> Set up portal login
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="flex items-center gap-1 rounded-lg bg-red-900/50 px-3 py-2 text-sm text-red-300 hover:bg-red-900/80 disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete
          </button>
        </div>
      </div>

      {settingUp && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-neutral-800 pt-3">
          <label className="flex flex-col gap-1 text-sm">
            Portal username
            <input
              className="rounded-lg bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-600"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={handleCreatePortalLogin}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </button>
          <button
            type="button"
            onClick={() => setSettingUp(false)}
            className="text-sm text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      {result && (
        <div className="mt-3 flex flex-col gap-1 rounded-lg bg-emerald-900/30 p-3 text-sm">
          <p className="flex items-center gap-1 font-medium text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> Portal login created
          </p>
          <p className="text-neutral-300">
            Username: <span className="font-mono">{result.username}</span>
          </p>
          <p className="text-neutral-300">
            Temporary password: <span className="font-mono">{result.password}</span>
          </p>
          <p className="text-xs text-neutral-400">
            Relay these to {employee.fullName} in person now — this password
            is shown only once. They&apos;ll be asked to set their own on
            first login.
          </p>
          <button
            type="button"
            onClick={() => setResult(null)}
            className="mt-1 w-fit text-xs text-neutral-400 underline hover:text-neutral-200"
          >
            Dismiss
          </button>
        </div>
      )}
    </li>
  );
}
