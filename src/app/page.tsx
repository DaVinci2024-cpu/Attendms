"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  Megaphone,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
  WifiOff,
} from "lucide-react";
import { CameraView } from "@/components/CameraView";
import { PinPad } from "@/components/PinPad";
import { useCamera } from "@/hooks/useCamera";
import { useFaceModels } from "@/hooks/useFaceModels";
import { detectSingleFaceDescriptor } from "@/lib/faceApi";
import { findBestMatch, type MatchResult } from "@/lib/faceMatching";
import { playChime } from "@/lib/chime";
import { verifyPin } from "@/lib/pin";
import { formatDuration } from "@/lib/hours";
import {
  fetchAllEmployees,
  fetchAuthPolicy,
  fetchKioskDisplaySettings,
  fetchLastAttendanceForEmployee,
  fetchWeekSchedule,
  recordPunch,
  recordSuspiciousEvent,
} from "@/lib/firestoreRepo";
import {
  findCurrentSupervisor,
  isEarlyPunchOut,
  isPunchInAllowed,
  resolveShiftForPunchIn,
  type ResolvedShift,
} from "@/lib/punchRules";
import { mondayOf, toWeekId } from "@/lib/week";
import {
  COMPANY_NAME,
  KIOSK_ID,
  DETECTION_INTERVAL_MS,
  MAX_PIN_ATTEMPTS,
  PUNCH_DEBOUNCE_MS,
} from "@/lib/constants";
import type {
  AttendanceLog,
  AttendanceOverride,
  AuthMethod,
  Employee,
  PunchType,
  ShiftSupervisor,
  WeekSchedule,
} from "@/lib/types";

type KioskStatus =
  | "idle"
  | "scanning"
  | "select_employee"
  | "pin_entry"
  | "blocked"
  | "supervisor_pin"
  | "override_reason"
  | "success"
  | "suspicious";

interface SuccessInfo {
  employeeName: string;
  punchType: PunchType;
  durationLabel?: string;
}

// Module-scope (not inside the component) so the React Compiler's purity
// check — which flags impure calls like Date.now() made directly in a
// component/hook body — doesn't apply to it.
function isDebounced(debounceUntilMap: Map<string, number>, employeeId: string): boolean {
  return Date.now() < (debounceUntilMap.get(employeeId) ?? 0);
}

export default function Home() {
  const [status, setStatus] = useState<KioskStatus>("idle");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("face_and_pin");
  // The camera should only ever run while actually face-scanning — never
  // on the idle screen, the PIN-only name picker, the punch-rules screens,
  // and never at all in pin_only mode.
  const usingCamera =
    authMethod !== "pin_only" &&
    status !== "idle" &&
    status !== "select_employee" &&
    status !== "blocked" &&
    status !== "supervisor_pin" &&
    status !== "override_reason";
  const {
    videoRef,
    ready: cameraReady,
    error: cameraError,
  } = useCamera(usingCamera);
  const { loaded: modelsLoaded, error: modelsError } = useFaceModels();

  const [employees, setEmployees] = useState<Employee[]>([]);
  // Deliberately local/session-only, not fetched from Firestore on a
  // schedule: this only ever grows from punches this kiosk records itself,
  // enough for the worked-hours display on punch-out. The punch-rules
  // checks below read the authoritative record from Firestore instead
  // (attendance is world-readable specifically so the kiosk, which never
  // signs in, can check it — see firestore.rules).
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLog[]>([]);
  const [schedule, setSchedule] = useState<WeekSchedule | null>(null);
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine
  );
  const [headline, setHeadline] = useState(`Welcome to ${COMPANY_NAME}`);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [intent, setIntent] = useState<PunchType | null>(null);
  const [scanHint, setScanHint] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<MatchResult | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [successInfo, setSuccessInfo] = useState<SuccessInfo | null>(null);

  // Punch-rules override flow state.
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  // Whether this block even has a supervisor-override path at all — the
  // "already on duty" block doesn't (that's a data-integrity guard, not
  // something a supervisor should paper over at the kiosk).
  const [overridable, setOverridable] = useState(false);
  const [requiredSupervisor, setRequiredSupervisor] = useState<ShiftSupervisor | null>(null);
  const [pendingShift, setPendingShift] = useState<ResolvedShift | null>(null);
  const [supervisorPin, setSupervisorPin] = useState("");
  const [supervisorPinError, setSupervisorPinError] = useState<string | null>(null);
  const [verifyingSupervisorPin, setVerifyingSupervisorPin] = useState(false);
  const [overrideReasonText, setOverrideReasonText] = useState("");
  const [submittingOverride, setSubmittingOverride] = useState(false);

  const debounceUntilRef = useRef<Map<string, number>>(new Map());
  const pinAttemptsRef = useRef<Map<string, number>>(new Map());
  const detectingRef = useRef(false);
  const statusRef = useRef<KioskStatus>("idle");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const refreshData = useCallback(async () => {
    try {
      const emps = await fetchAllEmployees();
      setEmployees(emps);
      setLoadError(null);
    } catch (err) {
      // Firestore serves from the local IndexedDB cache when offline, so a
      // failure while genuinely offline just means the cache is still
      // empty — not worth alarming over. A failure while online (rules
      // issue, network hiccup, etc.) is surfaced instead of silently
      // leaving the kiosk with stale/empty data.
      if (navigator.onLine) {
        setLoadError(
          `employees — ${err instanceof Error ? err.message : "failed to load"}`
        );
      }
    }

    try {
      setSchedule(await fetchWeekSchedule(toWeekId(mondayOf(new Date()))));
    } catch {
      // Non-critical for a refresh — punch-rule checks just fall back to
      // whatever schedule was last loaded successfully.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      // Fetched separately (not Promise.all'd) so a failure in one
      // non-critical read can never mask, or be masked by, another —
      // and so the error banner names which one actually failed.
      try {
        const emps = await fetchAllEmployees();
        if (cancelled) return;
        setEmployees(emps);
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        if (navigator.onLine) {
          setLoadError(
            `employees — ${err instanceof Error ? err.message : "failed to load"}`
          );
        }
      }

      try {
        const display = await fetchKioskDisplaySettings();
        if (cancelled) return;
        if (display?.headline) setHeadline(display.headline);
        setNotice(display?.noticeActive && display.notice ? display.notice : null);
      } catch (err) {
        if (cancelled || !navigator.onLine) return;
        console.error("Failed to load kiosk display settings:", err);
      }

      try {
        const policy = await fetchAuthPolicy();
        if (cancelled) return;
        if (policy?.method) setAuthMethod(policy.method);
      } catch (err) {
        if (cancelled || !navigator.onLine) return;
        console.error("Failed to load auth policy:", err);
      }

      try {
        const weekSchedule = await fetchWeekSchedule(toWeekId(mondayOf(new Date())));
        if (cancelled) return;
        setSchedule(weekSchedule);
      } catch (err) {
        if (cancelled || !navigator.onLine) return;
        console.error("Failed to load schedule:", err);
      }
    }

    loadInitialData();

    const handleOnline = () => {
      setOnline(true);
      refreshData();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshData]);

  // Continuous detection loop — only runs once an employee has picked
  // Punch In or Punch Out (status "scanning").
  useEffect(() => {
    if (!cameraReady || !modelsLoaded) return;

    const interval = setInterval(async () => {
      if (statusRef.current !== "scanning") return;
      if (detectingRef.current) return;
      if (!videoRef.current) return;

      detectingRef.current = true;
      try {
        const descriptor = await detectSingleFaceDescriptor(videoRef.current);
        if (!descriptor) {
          setScanHint("No face detected — center your face in the frame.");
          return;
        }

        const match = findBestMatch(descriptor, employees);
        if (!match) {
          setScanHint(
            employees.length === 0
              ? "No employees are enrolled on this device yet."
              : "Face detected, but it doesn't match an enrolled employee."
          );
          return;
        }

        const debounceUntil =
          debounceUntilRef.current.get(match.employee.employeeId) ?? 0;
        if (Date.now() < debounceUntil) return;

        setScanHint(null);
        pinAttemptsRef.current.set(match.employee.employeeId, 0);
        setCandidate(match);
        setPin("");
        setPinError(null);
        setStatus("pin_entry");
      } catch (err) {
        setScanHint(
          err instanceof Error ? `Detection error: ${err.message}` : "Detection error"
        );
      } finally {
        detectingRef.current = false;
      }
    }, DETECTION_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [cameraReady, modelsLoaded, employees, videoRef]);

  // If the camera fails outright while scanning and the policy allows a PIN
  // fallback, drop straight into the name picker instead of leaving the
  // employee stuck looking at a dead camera view.
  useEffect(() => {
    if (
      status !== "scanning" ||
      authMethod !== "face_with_pin_fallback" ||
      !cameraError
    ) {
      return;
    }
    const timer = setTimeout(() => {
      setEmployeeSearch("");
      setStatus("select_employee");
    }, 0);
    return () => clearTimeout(timer);
  }, [status, authMethod, cameraError]);

  function startPunch(punchType: PunchType) {
    setIntent(punchType);
    setScanHint(null);
    setEmployeeSearch("");
    setStatus(authMethod === "pin_only" ? "select_employee" : "scanning");
    // Refresh employees/schedule right as a punch starts, so a kiosk tab
    // left open for a while still sees anyone enrolled and today's
    // current schedule (camera/model startup gives this a moment to land
    // before scanning actually needs it).
    refreshData();
  }

  function selectEmployeeManually(employee: Employee) {
    if (isDebounced(debounceUntilRef.current, employee.employeeId)) {
      setScanHint("Already punched recently — please wait a few seconds.");
      return;
    }
    pinAttemptsRef.current.set(employee.employeeId, 0);
    setSelectedEmployee(employee);
    setCandidate(null);
    setPin("");
    setPinError(null);
    setStatus("pin_entry");
  }

  // Clears everything about the in-progress punch attempt, but leaves
  // `status` alone — callers decide what screen comes next.
  function clearPunchFields() {
    setIntent(null);
    setCandidate(null);
    setSelectedEmployee(null);
    setPin("");
    setPinError(null);
    setBlockedReason(null);
    setOverridable(false);
    setRequiredSupervisor(null);
    setPendingShift(null);
    setSupervisorPin("");
    setSupervisorPinError(null);
    setOverrideReasonText("");
  }

  function backToIdle() {
    setScanHint(null);
    setEmployeeSearch("");
    clearPunchFields();
    setStatus("idle");
  }

  async function handlePinSubmit() {
    const employee = candidate?.employee ?? selectedEmployee;
    if (!employee || !intent) return;

    setVerifyingPin(true);
    const pinCorrect = await verifyPin(pin, employee.pinSalt, employee.pinHash);
    setVerifyingPin(false);

    if (!pinCorrect) {
      const attempts = (pinAttemptsRef.current.get(employee.employeeId) ?? 0) + 1;
      pinAttemptsRef.current.set(employee.employeeId, attempts);

      if (attempts >= MAX_PIN_ATTEMPTS) {
        // Fire-and-forget: Firestore queues this locally and syncs once
        // online regardless, so the kiosk shouldn't sit waiting on a
        // network round trip before reacting to a suspicious event.
        recordSuspiciousEvent({
          eventId: `evt_${crypto.randomUUID()}`,
          employeeId: employee.employeeId,
          employeeName: employee.fullName,
          timestamp: new Date().toISOString(),
          reason: "wrong_pin",
          attempts,
          kioskId: KIOSK_ID,
        }).catch(() => {
          // Local queueing itself effectively never fails; a rejection here
          // would mean something structural (e.g. rules), not connectivity.
        });
        playChime("error");
        setStatus("suspicious");
        setTimeout(() => backToIdle(), 3000);
        return;
      }

      playChime("error");
      setPinError(`Incorrect PIN (attempt ${attempts}/${MAX_PIN_ATTEMPTS})`);
      setPin("");
      return;
    }

    await evaluateAndFinalize(employee, intent);
  }

  // Checks whether this punch is actually allowed to happen right now
  // (not already on duty, scheduled and on time for punch-in, not too
  // early to punch out) and either finalizes it or routes to the
  // supervisor-override screens.
  async function evaluateAndFinalize(employee: Employee, punchType: PunchType) {
    const now = new Date();

    let lastLog: AttendanceLog | null = null;
    try {
      lastLog = await fetchLastAttendanceForEmployee(employee.employeeId);
    } catch {
      // Offline or the read failed — fall back to this kiosk's own local
      // session history rather than blocking the punch outright.
      const [localLast] = attendanceLogs
        .filter((l) => l.employeeId === employee.employeeId)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      lastLog = localLast ?? null;
    }

    if (punchType === "punch_in") {
      if (lastLog?.type === "punch_in") {
        setBlockedReason(`${employee.fullName} is already on duty.`);
        setOverridable(false);
        setStatus("blocked");
        return;
      }

      // No schedule posted for this week at all — nothing to check
      // against, so don't block (same as before this feature existed).
      if (!schedule) {
        finalizePunch(employee, punchType, null, null);
        return;
      }

      const resolution = resolveShiftForPunchIn(
        schedule,
        mondayOf(now),
        employee.employeeId,
        now
      );
      if (isPunchInAllowed(resolution)) {
        finalizePunch(employee, punchType, resolution, null);
        return;
      }

      const supervisor = resolution
        ? resolution.supervisor
        : findCurrentSupervisor(schedule, mondayOf(now), now);
      setPendingShift(resolution);
      setRequiredSupervisor(supervisor);
      setOverridable(true);
      setBlockedReason(
        resolution
          ? `You're more than 15 minutes late for ${resolution.columnLabel}.`
          : "You're not scheduled to work today."
      );
      setStatus("blocked");
      return;
    }

    // Punch out.
    if (lastLog && isEarlyPunchOut(lastLog.scheduledShiftEnd, now)) {
      const supervisor: ShiftSupervisor | null = lastLog.scheduledSupervisorEmployeeId
        ? {
            employeeId: lastLog.scheduledSupervisorEmployeeId,
            employeeName: lastLog.scheduledSupervisorName ?? "Supervisor",
          }
        : null;
      setPendingShift(null);
      setRequiredSupervisor(supervisor);
      setOverridable(true);
      setBlockedReason("It's more than an hour before your shift ends.");
      setStatus("blocked");
      return;
    }

    finalizePunch(employee, punchType, null, null);
  }

  async function handleSupervisorPinSubmit() {
    if (!requiredSupervisor) return;
    const supervisorEmployee = employees.find(
      (e) => e.employeeId === requiredSupervisor.employeeId
    );
    if (!supervisorEmployee) {
      setSupervisorPinError("Supervisor record not found — try refreshing.");
      return;
    }

    setVerifyingSupervisorPin(true);
    const correct = await verifyPin(
      supervisorPin,
      supervisorEmployee.pinSalt,
      supervisorEmployee.pinHash
    );
    setVerifyingSupervisorPin(false);

    if (!correct) {
      setSupervisorPinError("Incorrect PIN.");
      setSupervisorPin("");
      return;
    }

    setSupervisorPin("");
    setSupervisorPinError(null);
    setStatus("override_reason");
  }

  function handleConfirmOverride() {
    const employee = candidate?.employee ?? selectedEmployee;
    const reason = overrideReasonText.trim();
    if (!employee || !intent || !requiredSupervisor || !reason) return;

    setSubmittingOverride(true);
    const override: AttendanceOverride = {
      reason,
      supervisorEmployeeId: requiredSupervisor.employeeId,
      supervisorName: requiredSupervisor.employeeName,
      overriddenAt: new Date().toISOString(),
    };
    finalizePunch(employee, intent, pendingShift, override);
    setSubmittingOverride(false);
  }

  function finalizePunch(
    employee: Employee,
    punchType: PunchType,
    resolution: ResolvedShift | null,
    override: AttendanceOverride | null
  ) {
    // On punch-out, find the matching punch-in for this shift (the most
    // recent prior log for this employee) to show how long they worked.
    let durationLabel: string | undefined;
    if (punchType === "punch_out") {
      const [lastLog] = attendanceLogs
        .filter((l) => l.employeeId === employee.employeeId)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      if (lastLog?.type === "punch_in") {
        durationLabel = formatDuration(Date.now() - new Date(lastLog.timestamp).getTime());
      }
    }

    const log: AttendanceLog = {
      logId: `log_${crypto.randomUUID()}`,
      employeeId: employee.employeeId,
      employeeName: employee.fullName,
      timestamp: new Date().toISOString(),
      type: punchType,
      // -1 signals no face match was involved (PIN-only identification) —
      // there's no meaningful Euclidean distance to record in that case.
      matchConfidence: candidate?.distance ?? -1,
      pinConfirmed: true,
      kioskId: KIOSK_ID,
      syncedOffline: !online,
      ...(punchType === "punch_in"
        ? {
            scheduledShiftEnd: resolution?.scheduledEndIso ?? null,
            scheduledSupervisorEmployeeId: resolution?.supervisor?.employeeId ?? null,
            scheduledSupervisorName: resolution?.supervisor?.employeeName ?? null,
          }
        : {}),
      ...(override ? { override } : {}),
    };

    // Same reasoning as above: don't block the success screen on a network
    // round trip. The write is queued locally by Firestore's persistence
    // layer and synced automatically once back online — the kiosk's own
    // local state (attendanceLogs) is updated immediately either way, so
    // punch-direction lookups for the next person stay correct offline too.
    recordPunch(log).catch(() => {});
    setAttendanceLogs((prev) => [...prev, log]);

    debounceUntilRef.current.set(employee.employeeId, Date.now() + PUNCH_DEBOUNCE_MS);
    playChime("success");
    setSuccessInfo({ employeeName: employee.fullName, punchType, durationLabel });
    setStatus("success");
    clearPunchFields();

    setTimeout(() => {
      setSuccessInfo(null);
      setStatus("idle");
    }, 2500);
  }

  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      <header className="flex items-center justify-between px-5 py-5">
        <span className="text-xs font-semibold uppercase tracking-widest text-neutral-600">
          Attendms
        </span>
        <div className="flex items-center gap-2">
          {loadError && (
            <span className="rounded-full bg-red-900/50 px-3 py-1 text-xs text-red-300">
              Couldn&apos;t load {loadError}
            </span>
          )}
          {!online && (
            <span className="flex items-center gap-1 rounded-full bg-amber-900/50 px-3 py-1 text-xs text-amber-300">
              <WifiOff className="h-3 w-3" /> Offline — punches queue locally
            </span>
          )}
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-5 px-4 pb-10">
        <h1 className="max-w-md text-balance text-center text-3xl font-bold tracking-tight">
          {headline}
        </h1>

        {notice && (
          <div className="flex w-full max-w-md items-start gap-2 rounded-xl border border-amber-800/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
            <Megaphone className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{notice}</p>
          </div>
        )}

        <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-950/60 p-6 shadow-2xl shadow-black/40">
          {status === "idle" && (
            <div className="flex flex-col gap-4">
              <button
                type="button"
                onClick={() => startPunch("punch_in")}
                className="flex items-center gap-4 rounded-xl bg-emerald-700 px-6 py-6 text-left transition hover:bg-emerald-600 active:scale-[0.99]"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <LogIn className="h-6 w-6" />
                </span>
                <span className="text-xl font-semibold">Punch In</span>
              </button>
              <button
                type="button"
                onClick={() => startPunch("punch_out")}
                className="flex items-center gap-4 rounded-xl bg-blue-700 px-6 py-6 text-left transition hover:bg-blue-600 active:scale-[0.99]"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <LogOut className="h-6 w-6" />
                </span>
                <span className="text-xl font-semibold">Punch Out</span>
              </button>
            </div>
          )}

          {status !== "idle" && (
            <div className="flex flex-col gap-4">
              {usingCamera && (
                <>
                  <CameraView ref={videoRef} ready={cameraReady} error={cameraError} />

                  {modelsError && (
                    <p className="text-sm text-red-400">
                      Failed to load face recognition models: {modelsError}
                    </p>
                  )}
                  {!modelsLoaded && !modelsError && (
                    <p className="text-sm text-neutral-400">
                      Loading face recognition models...
                    </p>
                  )}
                </>
              )}

              {status === "scanning" && (
                <div className="flex flex-col items-center gap-2">
                  <p className="text-center text-sm text-neutral-400">
                    Looking for a face to{" "}
                    {intent === "punch_in" ? "punch in" : "punch out"}...
                  </p>
                  {scanHint && (
                    <p className="text-center text-xs text-amber-400">{scanHint}</p>
                  )}
                  {authMethod === "face_with_pin_fallback" && (
                    <button
                      type="button"
                      onClick={() => {
                        setScanHint(null);
                        setEmployeeSearch("");
                        setStatus("select_employee");
                      }}
                      className="text-xs text-blue-400 underline hover:text-blue-300"
                    >
                      Trouble with the camera? Enter PIN instead
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={backToIdle}
                    className="text-sm text-neutral-400 underline hover:text-neutral-200"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {status === "select_employee" && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 rounded-lg bg-neutral-800 px-3 py-2">
                    <Search className="h-4 w-4 shrink-0 text-neutral-500" />
                    <input
                      autoFocus
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                      placeholder="Search your name..."
                      className="w-full bg-transparent text-sm outline-none placeholder:text-neutral-500"
                    />
                  </div>
                  <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                    {employees
                      .filter((e) => e.active)
                      .filter((e) =>
                        e.fullName.toLowerCase().includes(employeeSearch.trim().toLowerCase())
                      )
                      .map((employee) => (
                        <button
                          key={employee.employeeId}
                          type="button"
                          onClick={() => selectEmployeeManually(employee)}
                          className="rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-800"
                        >
                          {employee.fullName}
                        </button>
                      ))}
                    {employees.filter((e) => e.active).length === 0 && (
                      <p className="px-3 py-2 text-sm text-neutral-500">
                        No employees are enrolled on this device yet.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={backToIdle}
                    className="text-sm text-neutral-400 underline hover:text-neutral-200"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {status === "pin_entry" && (candidate || selectedEmployee) && (
                <div className="flex flex-col items-center gap-4">
                  <div className="flex items-center gap-2 text-lg font-medium">
                    <UserCheck className="h-5 w-5 text-blue-400" />
                    Hi {(candidate?.employee ?? selectedEmployee)?.fullName}, enter your PIN
                  </div>
                  <PinPad
                    value={pin}
                    onChange={setPin}
                    onSubmit={handlePinSubmit}
                    disabled={verifyingPin}
                  />
                  {pinError && <p className="text-sm text-red-400">{pinError}</p>}
                  <button
                    type="button"
                    onClick={backToIdle}
                    className="text-sm text-neutral-400 hover:text-neutral-200"
                  >
                    Not you? Cancel
                  </button>
                </div>
              )}

              {status === "blocked" && (
                <div className="flex flex-col items-center gap-3 rounded-xl bg-amber-950/40 p-6 text-center">
                  <ShieldAlert className="h-10 w-10 text-amber-400" />
                  <p className="text-lg font-medium text-amber-200">{blockedReason}</p>
                  {overridable && requiredSupervisor && (
                    <>
                      <p className="text-sm text-neutral-400">
                        Ask {requiredSupervisor.employeeName} to approve this at the kiosk.
                      </p>
                      <button
                        type="button"
                        onClick={() => setStatus("supervisor_pin")}
                        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-500"
                      >
                        <ShieldCheck className="h-4 w-4" /> Get supervisor
                      </button>
                    </>
                  )}
                  {overridable && !requiredSupervisor && (
                    <p className="text-sm text-neutral-400">
                      No supervisor is currently available to approve this — contact
                      your manager directly.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={backToIdle}
                    className="text-sm text-neutral-400 underline hover:text-neutral-200"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {status === "supervisor_pin" && requiredSupervisor && (
                <div className="flex flex-col items-center gap-4">
                  <div className="flex items-center gap-2 text-lg font-medium">
                    <ShieldCheck className="h-5 w-5 text-blue-400" />
                    {requiredSupervisor.employeeName}, enter your PIN to approve
                  </div>
                  <PinPad
                    value={supervisorPin}
                    onChange={setSupervisorPin}
                    onSubmit={handleSupervisorPinSubmit}
                    disabled={verifyingSupervisorPin}
                  />
                  {supervisorPinError && (
                    <p className="text-sm text-red-400">{supervisorPinError}</p>
                  )}
                  <button
                    type="button"
                    onClick={backToIdle}
                    className="text-sm text-neutral-400 hover:text-neutral-200"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {status === "override_reason" && (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-neutral-300">
                    Reason for this override (required)
                  </p>
                  <textarea
                    autoFocus
                    value={overrideReasonText}
                    onChange={(e) => setOverrideReasonText(e.target.value)}
                    placeholder="e.g. shift swap approved, traffic delay..."
                    className="min-h-20 rounded-lg bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    type="button"
                    onClick={handleConfirmOverride}
                    disabled={submittingOverride || !overrideReasonText.trim()}
                    className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
                  >
                    {submittingOverride && <Loader2 className="h-4 w-4 animate-spin" />}
                    Confirm {intent === "punch_in" ? "punch in" : "punch out"}
                  </button>
                  <button
                    type="button"
                    onClick={backToIdle}
                    className="text-sm text-neutral-400 underline hover:text-neutral-200"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {status === "success" && successInfo && (
                <div className="flex flex-col items-center gap-2 rounded-xl bg-emerald-900/40 p-6 text-center">
                  <UserCheck className="h-10 w-10 text-emerald-400" />
                  <p className="text-lg font-medium">
                    {successInfo.employeeName} —{" "}
                    {successInfo.punchType === "punch_in" ? "Punched in" : "Punched out"}
                  </p>
                  {successInfo.durationLabel && (
                    <p className="text-sm text-emerald-300">
                      Worked {successInfo.durationLabel} this shift
                    </p>
                  )}
                </div>
              )}

              {status === "suspicious" && (
                <div className="flex flex-col items-center gap-2 rounded-xl bg-red-900/40 p-6 text-center">
                  <ShieldAlert className="h-10 w-10 text-red-400" />
                  <p className="text-lg font-medium">
                    Too many incorrect PIN attempts. This has been logged.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <footer className="flex items-center justify-center gap-3 px-4 pb-6">
        <Link
          href="/portal/login"
          className="flex items-center gap-1.5 rounded-full border border-neutral-800 px-4 py-2 text-xs text-neutral-500 transition hover:border-neutral-700 hover:text-neutral-300"
        >
          <Users className="h-3.5 w-3.5" /> Employee portal
        </Link>
        <Link
          href="/admin"
          className="flex items-center gap-1.5 rounded-full border border-neutral-800 px-4 py-2 text-xs text-neutral-500 transition hover:border-neutral-700 hover:text-neutral-300"
        >
          <LayoutDashboard className="h-3.5 w-3.5" /> Admin portal
        </Link>
      </footer>
    </div>
  );
}
