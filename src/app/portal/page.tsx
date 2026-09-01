"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  onAuthStateChanged,
  signOut,
  updatePassword,
  type User,
} from "firebase/auth";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Loader2,
  Megaphone,
  Printer,
} from "lucide-react";
import { SchedulePrintView } from "@/components/SchedulePrintView";
import { getAuthClient } from "@/lib/auth";
import {
  clearMustChangePassword,
  fetchAnnouncements,
  fetchAttendanceForEmployee,
  fetchEmployeeByAuthUid,
  fetchMyAvailability,
  fetchScheduleColumnTemplate,
  fetchWeekSchedule,
  saveAvailability,
} from "@/lib/firestoreRepo";
import { pairSessions, formatDuration } from "@/lib/hours";
import { cellAssignments } from "@/lib/schedule";
import { mondayOf, toWeekId } from "@/lib/week";
import type {
  Announcement,
  AttendanceLog,
  AvailabilityEntry,
  Employee,
  ScheduleColumnTemplate,
  WeekSchedule,
} from "@/lib/types";

export default function PortalPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [employee, setEmployee] = useState<Employee | null | undefined>(undefined);

  useEffect(() => {
    return onAuthStateChanged(getAuthClient(), setUser);
  }, []);

  useEffect(() => {
    if (user === null) {
      router.push("/portal/login");
      return;
    }
    if (!user) return;

    let cancelled = false;
    fetchEmployeeByAuthUid(user.uid).then((emp) => {
      if (!cancelled) setEmployee(emp);
    });
    return () => {
      cancelled = true;
    };
  }, [user, router]);

  if (user === undefined || (user && employee === undefined)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (!user) return null; // redirecting to /portal/login

  if (!employee) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-neutral-300">
          This account isn&apos;t linked to an employee profile. Ask your
          admin to check your portal setup.
        </p>
        <button
          type="button"
          onClick={() => signOut(getAuthClient())}
          className="flex items-center gap-1 rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    );
  }

  if (employee.mustChangePassword) {
    return (
      <ForcedPasswordChange
        employee={employee}
        onDone={() => setEmployee({ ...employee, mustChangePassword: false })}
      />
    );
  }

  return <PortalDashboard employee={employee} />;
}

function ForcedPasswordChange({
  employee,
  onDone,
}: {
  employee: Employee;
  onDone: () => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const currentUser = getAuthClient().currentUser;
      if (!currentUser) throw new Error("Not signed in");
      await updatePassword(currentUser, newPassword);
      await clearMustChangePassword(employee.employeeId);
      onDone();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to set new password. Try signing in again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-neutral-900 p-6"
      >
        <div>
          <h1 className="text-xl font-semibold">Set a new password</h1>
          <p className="text-sm text-neutral-400">
            Welcome, {employee.fullName}. Choose a password only you know —
            this replaces the temporary one your admin gave you.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          New password
          <input
            type="password"
            required
            className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Confirm password
          <input
            type="password"
            required
            className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save password
        </button>
      </form>
    </div>
  );
}

function localDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA");
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function PortalDashboard({ employee }: { employee: Employee }) {
  const [logs, setLogs] = useState<AttendanceLog[] | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [schedule, setSchedule] = useState<WeekSchedule | null>(null);
  const [columnTemplate, setColumnTemplate] = useState<ScheduleColumnTemplate | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [draftSlots, setDraftSlots] = useState<Record<string, string[]>>({});
  const [draftNote, setDraftNote] = useState("");
  const [availabilitySaving, setAvailabilitySaving] = useState(false);
  const [availabilitySaved, setAvailabilitySaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAttendanceForEmployee(employee.employeeId)
      .then((attendance) => {
        if (!cancelled) setLogs(attendance);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load data");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [employee.employeeId]);

  useEffect(() => {
    let cancelled = false;
    fetchAnnouncements(5)
      .then((list) => {
        if (!cancelled) setAnnouncements(list);
      })
      .catch(() => {
        // Non-critical — the rest of the portal still works without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const weekId = toWeekId(weekStart);

  useEffect(() => {
    let cancelled = false;

    async function loadSchedule() {
      setScheduleLoading(true);
      setAvailabilitySaved(false);
      try {
        const [week, template, myAvailability] = await Promise.all([
          fetchWeekSchedule(weekId),
          fetchScheduleColumnTemplate(),
          fetchMyAvailability(weekId, employee.employeeId),
        ]);
        if (cancelled) return;
        // A week not split off into its own columns always follows the
        // current standard set, even if this week's own doc hasn't been
        // re-saved since the standard columns last changed.
        setSchedule(
          week && !week.customColumns && template
            ? { ...week, columns: template.columns }
            : week
        );
        setColumnTemplate(template);
        setDraftSlots(myAvailability?.availableSlots ?? {});
        setDraftNote(myAvailability?.note ?? "");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load schedule");
        }
      } finally {
        if (!cancelled) setScheduleLoading(false);
      }
    }

    loadSchedule();

    return () => {
      cancelled = true;
    };
  }, [weekId, employee.employeeId]);

  function goToWeek(offsetWeeks: number) {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + offsetWeeks * 7);
      return mondayOf(next);
    });
  }

  function toggleAvailabilitySlot(dateKey: string, columnId: string) {
    setDraftSlots((prev) => {
      const current = prev[dateKey] ?? [];
      const next = current.includes(columnId)
        ? current.filter((id) => id !== columnId)
        : [...current, columnId];
      return { ...prev, [dateKey]: next };
    });
    setAvailabilitySaved(false);
  }

  async function handleSubmitAvailability() {
    setAvailabilitySaving(true);
    setError(null);
    try {
      const entry: AvailabilityEntry = {
        weekId,
        employeeId: employee.employeeId,
        employeeName: employee.fullName,
        availableSlots: draftSlots,
        note: draftNote.trim(),
        submittedAt: new Date().toISOString(),
      };
      await saveAvailability(entry);
      setAvailabilitySaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save availability");
    } finally {
      setAvailabilitySaving(false);
    }
  }

  const thisWeekId = toWeekId(mondayOf(new Date()));
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return {
      dateKey: toWeekId(d),
      label: d.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    };
  });

  const sessions = logs ? pairSessions(logs) : [];
  const totalMs = sessions.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);

  return (
    <>
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8 print:hidden">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Hi, {employee.fullName}</h1>
          <p className="text-sm text-neutral-400">
            Your hours and this week&apos;s schedule.
          </p>
        </div>
        <button
          type="button"
          onClick={() => signOut(getAuthClient())}
          className="flex items-center gap-1 rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {announcements.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl bg-neutral-900 p-4">
          <h2 className="flex items-center gap-2 font-medium">
            <Megaphone className="h-4 w-4 text-amber-400" /> Announcements
          </h2>
          {announcements.map((a) => (
            <div key={a.announcementId} className="rounded-lg bg-neutral-800/60 px-3 py-2">
              <p className="text-sm">{a.message}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {a.postedByName} · {new Date(a.postedAt).toLocaleString()}
              </p>
            </div>
          ))}
        </section>
      )}

      {logs === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : (
        <>
          <section className="rounded-xl bg-neutral-900 p-4">
            <h2 className="mb-2 font-medium">My hours</h2>
            <p className="mb-3 text-sm text-neutral-400">
              Total: {formatDuration(totalMs)} across {sessions.length}{" "}
              session{sessions.length === 1 ? "" : "s"}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-neutral-400">
                  <tr>
                    <th className="px-2 py-1">Date</th>
                    <th className="px-2 py-1">In</th>
                    <th className="px-2 py-1">Out</th>
                    <th className="px-2 py-1">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.punchIn.logId} className="border-t border-neutral-800">
                      <td className="px-2 py-1">{localDate(s.punchIn.timestamp)}</td>
                      <td className="px-2 py-1">{localTime(s.punchIn.timestamp)}</td>
                      <td className="px-2 py-1">
                        {s.punchOut ? (
                          localTime(s.punchOut.timestamp)
                        ) : (
                          <span className="text-emerald-400">still in</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {s.durationMs !== null ? formatDuration(s.durationMs) : "—"}
                      </td>
                    </tr>
                  ))}
                  {sessions.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-6 text-center text-neutral-400">
                        No punches yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl bg-neutral-900 p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">
                {weekId === thisWeekId ? "This week's schedule" : "Schedule"}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => goToWeek(-1)}
                  className="rounded-lg bg-neutral-800 p-1.5 hover:bg-neutral-700"
                  title="Previous week"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs text-neutral-400">Week of {weekId}</span>
                <button
                  type="button"
                  onClick={() => goToWeek(1)}
                  className="rounded-lg bg-neutral-800 p-1.5 hover:bg-neutral-700"
                  title="Next week"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  disabled={!schedule}
                  className="flex items-center gap-1.5 rounded-lg bg-neutral-800 px-2.5 py-1.5 text-xs hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Print this week's schedule"
                >
                  <Printer className="h-3.5 w-3.5" /> Print
                </button>
              </div>
            </div>
            {scheduleLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
              </div>
            ) : !schedule ? (
              <p className="text-sm text-neutral-400">
                No schedule posted for this week yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr>
                      <th className="border-b border-neutral-800 px-2 py-1 text-neutral-400">
                        Day
                      </th>
                      {schedule.columns.map((col) => (
                        <th
                          key={col.columnId}
                          className="border-b border-neutral-800 px-2 py-1 text-neutral-400"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.rows.map((row) => (
                      <tr key={row.rowId} className="border-b border-neutral-800">
                        <td className="px-2 py-1">{row.label}</td>
                        {schedule.columns.map((col) => {
                          const assignments = cellAssignments(row.cells, col.columnId);
                          return (
                            <td key={col.columnId} className="px-2 py-1">
                              {assignments.length === 0 ? (
                                <span className="text-neutral-600">—</span>
                              ) : (
                                <div className="flex flex-col gap-0.5">
                                  {assignments.map((a) => (
                                    <span
                                      key={a.employeeId}
                                      className={
                                        a.employeeId === employee.employeeId
                                          ? "font-medium text-emerald-400"
                                          : undefined
                                      }
                                    >
                                      {a.employeeName}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl bg-neutral-900 p-4">
            <h2 className="mb-2 font-medium">Your availability — Week of {weekId}</h2>
            {!columnTemplate ? (
              <p className="text-sm text-neutral-400">
                No shift types have been set up yet — check back once a schedule
                exists.
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs text-neutral-500">
                  Tell your admin which shifts you can work this week.
                </p>
                <div className="flex flex-col gap-2">
                  {weekDays.map(({ dateKey, label }) => (
                    <div
                      key={dateKey}
                      className="flex flex-wrap items-center gap-3 rounded-lg bg-neutral-800/60 px-3 py-2"
                    >
                      <span className="w-28 shrink-0 text-sm">{label}</span>
                      <div className="flex flex-wrap gap-3">
                        {columnTemplate.columns.map((col) => (
                          <label
                            key={col.columnId}
                            className="flex items-center gap-1.5 text-xs text-neutral-300"
                          >
                            <input
                              type="checkbox"
                              checked={(draftSlots[dateKey] ?? []).includes(col.columnId)}
                              onChange={() => toggleAvailabilitySlot(dateKey, col.columnId)}
                            />
                            {col.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <textarea
                  className="mt-2 min-h-16 w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-600"
                  placeholder="Optional note (e.g. can only work mornings after the 10th)"
                  value={draftNote}
                  onChange={(e) => {
                    setDraftNote(e.target.value);
                    setAvailabilitySaved(false);
                  }}
                />
                <button
                  type="button"
                  onClick={handleSubmitAvailability}
                  disabled={availabilitySaving}
                  className="mt-2 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
                >
                  {availabilitySaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Submit availability
                </button>
                {availabilitySaved && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Saved.
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
    {schedule && (
      <SchedulePrintView
        schedule={schedule}
        subtitle={`For: ${employee.fullName}`}
        highlightEmployeeId={employee.employeeId}
      />
    )}
    </>
  );
}
