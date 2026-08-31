"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { RequireAdmin, usePermissions } from "@/components/RequireAdmin";
import {
  fetchAllEmployees,
  fetchAllPermissionGrants,
  revokePermissionGrant,
  savePermissionGrant,
} from "@/lib/firestoreRepo";
import { ALL_PERMISSIONS, PERMISSION_LABELS, grantIsActive } from "@/lib/permissions";
import type { Employee, Permission, PermissionGrant } from "@/lib/types";

export default function AdminPermissionsPage() {
  return (
    <RequireAdmin>
      <PermissionsManager />
    </RequireAdmin>
  );
}

function PermissionsManager() {
  const { uid } = usePermissions();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [grants, setGrants] = useState<Record<string, PermissionGrant>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAllEmployees(), fetchAllPermissionGrants()])
      .then(([emps, grantList]) => {
        if (cancelled) return;
        setEmployees(emps.filter((e) => e.authUid));
        const map: Record<string, PermissionGrant> = {};
        grantList.forEach((g) => {
          map[g.uid] = g;
        });
        setGrants(map);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSaved(grant: PermissionGrant) {
    setGrants((prev) => ({ ...prev, [grant.uid]: grant }));
  }

  function handleRevoked(targetUid: string) {
    setGrants((prev) => {
      const next = { ...prev };
      delete next[targetUid];
      return next;
    });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Roles &amp; permissions</h1>
        <p className="text-sm text-neutral-400">
          Grant specific capabilities to an employee&apos;s portal account,
          with an optional time limit. Full admin accounts already have
          every capability and aren&apos;t managed here.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : employees.length === 0 ? (
        <p className="text-sm text-neutral-400">
          No employees have a portal login yet — set one up from{" "}
          <Link href="/admin/employees" className="underline">
            Manage employees
          </Link>{" "}
          before granting permissions.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {employees.map((employee) => (
            <PersonRow
              key={employee.employeeId}
              employee={employee}
              grant={grants[employee.authUid as string] ?? null}
              grantedByUid={uid}
              onSaved={handleSaved}
              onRevoked={handleRevoked}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PersonRow({
  employee,
  grant,
  grantedByUid,
  onSaved,
  onRevoked,
}: {
  employee: Employee;
  grant: PermissionGrant | null;
  grantedByUid: string;
  onSaved: (grant: PermissionGrant) => void;
  onRevoked: (uid: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<Permission>>(
    () => new Set(grant?.permissions ?? [])
  );
  const [expiry, setExpiry] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = grantIsActive(grant);

  function togglePermission(p: Permission) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function handleSave() {
    if (!employee.authUid) return;
    setSaving(true);
    setError(null);
    try {
      const newGrant: PermissionGrant = {
        uid: employee.authUid,
        displayName: employee.fullName,
        permissions: Array.from(selected),
        expiresAtMillis: expiry ? new Date(expiry).getTime() : null,
        grantedBy: grantedByUid,
        grantedAt: new Date().toISOString(),
      };
      await savePermissionGrant(newGrant);
      onSaved(newGrant);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke() {
    if (!employee.authUid) return;
    if (!window.confirm(`Revoke all granted permissions from ${employee.fullName}?`)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await revokePermissionGrant(employee.authUid);
      onRevoked(employee.authUid);
      setSelected(new Set());
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke");
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
            {active && grant
              ? `${grant.permissions.length} permission${
                  grant.permissions.length === 1 ? "" : "s"
                }${
                  grant.expiresAtMillis
                    ? ` · expires ${new Date(grant.expiresAtMillis).toLocaleString()}`
                    : " · permanent"
                }`
              : "No permissions granted"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {grant && (
            <button
              type="button"
              onClick={handleRevoke}
              disabled={saving}
              className="flex items-center gap-1 rounded-lg bg-red-900/50 px-3 py-2 text-sm text-red-300 hover:bg-red-900/80 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> Revoke all
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing((prev) => !prev)}
            className="flex items-center gap-1 rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            <ShieldCheck className="h-4 w-4" /> {editing ? "Close" : "Manage"}
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 flex flex-col gap-3 border-t border-neutral-800 pt-3">
          <div className="flex flex-col gap-1.5">
            {ALL_PERMISSIONS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(p)}
                  onChange={() => togglePermission(p)}
                />
                {PERMISSION_LABELS[p]}
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 text-neutral-400">
              <Clock className="h-3.5 w-3.5" /> Expires (optional — leave blank
              for permanent)
            </span>
            <input
              type="datetime-local"
              className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save permissions
          </button>
        </div>
      )}
    </li>
  );
}
