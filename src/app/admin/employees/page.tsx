"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { RequireAdmin } from "@/components/RequireAdmin";
import {
  deleteEmployee,
  fetchAllEmployees,
  fetchEmployeeByPortalUsername,
  linkEmployeePortalAccount,
  resetEmployeePin,
  setEmployeeSupervisorFlag,
  updateEmployeeName,
} from "@/lib/firestoreRepo";
import { createEmployeePortalAccount } from "@/lib/auth";
import { findByPin, hashPin, PIN_PATTERN } from "@/lib/pin";
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

  function handleNameUpdated(employeeId: string, fullName: string) {
    setEmployees((prev) =>
      prev?.map((e) => (e.employeeId === employeeId ? { ...e, fullName } : e)) ?? null
    );
  }

  async function handleToggleSupervisor(employeeId: string, isSupervisor: boolean) {
    setEmployees((prev) =>
      prev?.map((e) => (e.employeeId === employeeId ? { ...e, isSupervisor } : e)) ?? null
    );
    try {
      await setEmployeeSupervisorFlag(employeeId, isSupervisor);
    } catch (err) {
      // Revert on failure — the optimistic update above assumed it would work.
      setEmployees((prev) =>
        prev?.map((e) => (e.employeeId === employeeId ? { ...e, isSupervisor: !isSupervisor } : e)) ?? null
      );
      setError(err instanceof Error ? err.message : "Failed to update supervisor status");
    }
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
            onToggleSupervisor={(isSupervisor) =>
              handleToggleSupervisor(employee.employeeId, isSupervisor)
            }
            onNameUpdated={(fullName) => handleNameUpdated(employee.employeeId, fullName)}
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
  onToggleSupervisor,
  onNameUpdated,
}: {
  employee: Employee;
  deleting: boolean;
  onDelete: () => void;
  onPortalLinked: (portalUsername: string) => void;
  onToggleSupervisor: (isSupervisor: boolean) => void;
  onNameUpdated: (fullName: string) => void;
}) {
  const [settingUp, setSettingUp] = useState(false);
  const [username, setUsername] = useState(() => slugifyUsername(employee.fullName));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ username: string; password: string } | null>(
    null
  );

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(employee.fullName);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  const [newPin, setNewPin] = useState("");
  const [resettingPin, setResettingPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinReset, setPinReset] = useState<string | null>(null);

  async function handleSaveName() {
    const trimmed = editName.trim();
    if (!trimmed) {
      setNameError("Name can't be empty.");
      return;
    }
    setSavingName(true);
    setNameError(null);
    setNameSaved(false);
    try {
      await updateEmployeeName(employee.employeeId, trimmed);
      onNameUpdated(trimmed);
      setNameSaved(true);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Failed to update name");
    } finally {
      setSavingName(false);
    }
  }

  async function handleResetPin() {
    if (!PIN_PATTERN.test(newPin)) {
      setPinError("PIN must be exactly 6 digits.");
      return;
    }
    setResettingPin(true);
    setPinError(null);
    setPinReset(null);
    try {
      const others = (await fetchAllEmployees()).filter(
        (e) => e.employeeId !== employee.employeeId
      );
      const duplicate = await findByPin(newPin, others);
      if (duplicate) {
        setPinError(`This PIN is already in use by ${duplicate.fullName} — pick a different one.`);
        return;
      }
      const { pinHash, pinSalt } = await hashPin(newPin);
      await resetEmployeePin(employee.employeeId, pinHash, pinSalt);
      setPinReset(newPin);
      setNewPin("");
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Failed to reset PIN");
    } finally {
      setResettingPin(false);
    }
  }

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
          <p className="flex items-center gap-1.5 font-medium">
            {employee.fullName}
            {employee.isSupervisor && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs font-normal text-emerald-300">
                <ShieldCheck className="h-3 w-3" /> Supervisor
              </span>
            )}
          </p>
          <p className="text-xs text-neutral-400">
            {employee.faceDescriptors.length} snapshot
            {employee.faceDescriptors.length === 1 ? "" : "s"} · {employee.role}
            {!employee.active && " · inactive"}
            {employee.portalUsername && ` · portal: ${employee.portalUsername}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={employee.isSupervisor ?? false}
              onChange={(e) => onToggleSupervisor(e.target.checked)}
            />
            Supervisor
          </label>
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
            onClick={() => {
              setEditing((prev) => !prev);
              setEditName(employee.fullName);
              setNameError(null);
              setNameSaved(false);
              setNewPin("");
              setPinError(null);
              setPinReset(null);
            }}
            className="flex items-center gap-1 rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            <Pencil className="h-4 w-4" /> {editing ? "Close" : "Edit"}
          </button>
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

      {editing && (
        <div className="mt-3 flex flex-col gap-4 border-t border-neutral-800 pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Full name
              <input
                className="rounded-lg bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-600"
                value={editName}
                onChange={(e) => {
                  setEditName(e.target.value);
                  setNameSaved(false);
                }}
              />
            </label>
            <button
              type="button"
              onClick={handleSaveName}
              disabled={savingName}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
            >
              {savingName && <Loader2 className="h-4 w-4 animate-spin" />}
              Save name
            </button>
            {nameSaved && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> Saved
              </span>
            )}
          </div>
          {nameError && <p className="text-sm text-red-400">{nameError}</p>}

          <div className="flex flex-col gap-2 border-t border-neutral-800 pt-3">
            <div>
              <p className="text-sm font-medium">Reset PIN</p>
              <p className="text-xs text-neutral-400">
                PINs are one-way encrypted — there&apos;s no way to see the one
                currently set on this account, only replace it with a new one.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm">
                New PIN (6 digits)
                <input
                  className="rounded-lg bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-600"
                  value={newPin}
                  onChange={(e) => {
                    setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setPinReset(null);
                  }}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                />
              </label>
              <button
                type="button"
                onClick={handleResetPin}
                disabled={resettingPin}
                className="flex items-center gap-2 rounded-lg bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-neutral-700"
              >
                {resettingPin ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Reset PIN
              </button>
            </div>
            {pinError && <p className="text-sm text-red-400">{pinError}</p>}
            {pinReset && (
              <p className="rounded-lg bg-emerald-900/30 px-3 py-2 text-xs text-emerald-300">
                PIN reset to <span className="font-mono">{pinReset}</span> — relay it
                to {employee.fullName} now, this won&apos;t be shown again. They can
                use it at the kiosk right away.
              </p>
            )}
          </div>
        </div>
      )}

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
