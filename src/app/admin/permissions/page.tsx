"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Loader2, ShieldCheck, Trash2, Unlock } from "lucide-react";
import { RequireAdmin, usePermissions } from "@/components/RequireAdmin";
import {
  fetchAllEmployees,
  fetchAllPermissionGrants,
  fetchAllScheduleExemptions,
  fetchShiftSupervisorPermissionSettings,
  revokePermissionGrant,
  revokeScheduleExemption,
  savePermissionGrant,
  saveScheduleExemption,
  saveShiftSupervisorPermissionSettings,
} from "@/lib/firestoreRepo";
import {
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
  ROLE_PRESETS,
  grantIsActive,
  scheduleExemptionIsActive,
} from "@/lib/permissions";
import type { Employee, Permission, PermissionGrant, ScheduleExemption } from "@/lib/types";

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

      <ShiftSupervisorSettingsCard />

      <ScheduleExemptionsCard grantedByUid={uid} />

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
            <span className="text-xs text-neutral-400">
              Start from a role (still editable below), or pick permissions
              individually
            </span>
            <div className="flex flex-wrap gap-1.5">
              {ROLE_PRESETS.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  title={role.description}
                  onClick={() => setSelected(new Set(role.permissions))}
                  className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
                >
                  {role.label}
                </button>
              ))}
            </div>
          </div>
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

// Company-wide: whichever permissions are checked here are what a shift
// supervisor automatically gets, only while their assigned shift is
// active (see /admin/schedule for assigning who's supervising a given
// day+shift). Separate from the per-person grants above, and never
// overwrites them.
function ShiftSupervisorSettingsCard() {
  const [selected, setSelected] = useState<Set<Permission>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchShiftSupervisorPermissionSettings()
      .then((settings) => {
        if (!cancelled) setSelected(new Set(settings?.permissions ?? []));
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

  function togglePermission(p: Permission) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveShiftSupervisorPermissionSettings({
        permissions: Array.from(selected),
        updatedAt: new Date().toISOString(),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg bg-neutral-900 px-4 py-3">
      <div>
        <h2 className="font-medium">Shift supervisor auto-access</h2>
        <p className="text-xs text-neutral-400">
          Whoever&apos;s assigned as a shift&apos;s supervisor on the schedule
          automatically gets these permissions, only while that shift is
          active.
        </p>
      </div>
      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
        </div>
      ) : (
        <>
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
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-2 self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
          {saved && (
            <p className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// Employees exempted here can punch in even when they aren't on today's
// schedule at all — no supervisor needed. Keyed by employeeId (not uid),
// so it applies to any employee regardless of whether they have a
// portal login, unlike the per-uid grants above.
function ScheduleExemptionsCard({ grantedByUid }: { grantedByUid: string }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [exemptions, setExemptions] = useState<Record<string, ScheduleExemption>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [expiry, setExpiry] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAllEmployees(), fetchAllScheduleExemptions()])
      .then(([emps, list]) => {
        if (cancelled) return;
        setEmployees(emps.filter((e) => e.active));
        const map: Record<string, ScheduleExemption> = {};
        list.forEach((e) => {
          map[e.employeeId] = e;
        });
        setExemptions(map);
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

  const exemptedIds = new Set(Object.keys(exemptions));
  const eligible = employees
    .filter((e) => !exemptedIds.has(e.employeeId))
    .filter((e) => e.fullName.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const exempted = employees
    .filter((e) => exemptedIds.has(e.employeeId))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  async function handleAdd(employee: Employee) {
    setSaving(true);
    setError(null);
    try {
      const exemption: ScheduleExemption = {
        employeeId: employee.employeeId,
        employeeName: employee.fullName,
        startsAtMillis: null,
        expiresAtMillis: expiry ? new Date(expiry).getTime() : null,
        grantedBy: grantedByUid,
        grantedAt: new Date().toISOString(),
      };
      await saveScheduleExemption(exemption);
      setExemptions((prev) => ({ ...prev, [employee.employeeId]: exemption }));
      setOpen(false);
      setSearch("");
      setExpiry("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(employeeId: string) {
    setSaving(true);
    setError(null);
    try {
      await revokeScheduleExemption(employeeId);
      setExemptions((prev) => {
        const next = { ...prev };
        delete next[employeeId];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg bg-neutral-900 px-4 py-3">
      <div>
        <h2 className="flex items-center gap-1.5 font-medium">
          <Unlock className="h-4 w-4 text-neutral-400" /> Punch in without a schedule
        </h2>
        <p className="text-xs text-neutral-400">
          Employees listed here can punch in even when they aren&apos;t on
          today&apos;s schedule at all — no supervisor approval needed. A
          scheduled employee who&apos;s just running late still needs one,
          same as before.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
        </div>
      ) : (
        <>
          {error && <p className="text-sm text-red-400">{error}</p>}

          {exempted.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {exempted.map((employee) => {
                const exemption = exemptions[employee.employeeId];
                const active = scheduleExemptionIsActive(exemption);
                return (
                  <li
                    key={employee.employeeId}
                    className="flex items-center justify-between gap-2 rounded-lg bg-neutral-800 px-3 py-2 text-sm"
                  >
                    <div>
                      <p>{employee.fullName}</p>
                      <p className="text-xs text-neutral-400">
                        {!active
                          ? "Expired"
                          : exemption.expiresAtMillis
                            ? `Expires ${new Date(exemption.expiresAtMillis).toLocaleString()}`
                            : "Permanent"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevoke(employee.employeeId)}
                      disabled={saving}
                      className="flex items-center gap-1 rounded-lg bg-red-900/50 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-900/80 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {open ? (
            <div className="flex flex-col gap-2 rounded-lg bg-neutral-800 p-2.5">
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name..."
                className="rounded-lg bg-neutral-950 px-3 py-2 text-sm outline-none placeholder:text-neutral-500 focus:ring-2 focus:ring-blue-600"
              />
              <div className="flex max-h-40 flex-col overflow-y-auto">
                {eligible.map((employee) => (
                  <button
                    key={employee.employeeId}
                    type="button"
                    onClick={() => handleAdd(employee)}
                    disabled={saving}
                    className="rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-700 disabled:opacity-50"
                  >
                    {employee.fullName}
                  </button>
                ))}
                {eligible.length === 0 && (
                  <p className="px-2 py-1.5 text-sm text-neutral-500">No matches.</p>
                )}
              </div>
              <label className="flex flex-col gap-1 text-xs">
                <span className="flex items-center gap-1 text-neutral-400">
                  <Clock className="h-3.5 w-3.5" /> Expires (optional — leave
                  blank for permanent)
                </span>
                <input
                  type="datetime-local"
                  className="rounded-lg bg-neutral-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-600"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setSearch("");
                  setExpiry("");
                }}
                className="self-start text-xs text-neutral-500 hover:text-neutral-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex items-center gap-1 self-start rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
            >
              <Unlock className="h-4 w-4" /> Add employee
            </button>
          )}
        </>
      )}
    </section>
  );
}
