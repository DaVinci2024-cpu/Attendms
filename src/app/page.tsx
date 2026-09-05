"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  MapPinOff,
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
import { findByPin, verifyPin } from "@/lib/pin";
import { formatDuration } from "@/lib/hours";
import {
  fetchAllEmployees,
  fetchAllScheduleExemptions,
  fetchAuthPolicy,
  fetchKioskDisplaySettings,
  fetchLastAttendanceForEmployee,
  fetchLocationPolicy,
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
import { scheduleExemptionIsActive } from "@/lib/permissions";
import {
  getDeviceId,
  haversineDistanceMeters,
  requestPosition,
  summarizeUserAgent,
} from "@/lib/geolocation";
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
  Employee,
  LocationPolicy,
  PunchDevice,
  PunchLocation,
  PunchType,
  ScheduleExemption,
  ShiftSupervisor,
  WeekSchedule,
} from "@/lib/types";

// Refresh interval for the kiosk's own cached location — the kiosk is a
// fixed device, so this only needs to catch it actually being physically
// moved, not track continuous movement like a phone would.
const LOCATION_REFRESH_MS = 5 * 60 * 1000;

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
  // Whether facial recognition is turned on at all (admin setting) — PIN
  // is always required regardless, either as the sole method or as
  // confirmation after a face match. Defaults to off until the policy
  // loads, so a slow/failed load never quietly turns the camera on.
  const [faceEnabled, setFaceEnabled] = useState(false);
  // The camera should only ever run while actually face-scanning — never
  // on the idle screen, the PIN-only name picker, the punch-rules screens,
  // and never at all with facial recognition turned off.
  const usingCamera =
    faceEnabled &&
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
  const { loaded: modelsLoaded, error: modelsError } = useFaceModels(faceEnabled);

  const [employees, setEmployees] = useState<Employee[]>([]);
  // Deliberately local/session-only, not fetched from Firestore on a
  // schedule: this only ever grows from punches this kiosk records itself,
  // enough for the worked-hours display on punch-out. The punch-rules
  // checks below read the authoritative record from Firestore instead
  // (attendance is world-readable specifically so the kiosk, which never
  // signs in, can check it — see firestore.rules).
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLog[]>([]);
  const [schedule, setSchedule] = useState<WeekSchedule | null>(null);
  // Keyed by employeeId. Checked only when someone who isn't on today's
  // schedule at all tries to punch in — see evaluateAndFinalize below.
  const [scheduleExemptions, setScheduleExemptions] = useState<
    Record<string, ScheduleExemption>
  >({});
  const [locationPolicy, setLocationPolicy] = useState<LocationPolicy | null>(null);
  // Whether this kiosk device has granted the browser location prompt at
  // all — gates the entire punch UI (see the early return near the
  // bottom of this component). "checking" is also the state on every
  // reload even after a prior grant; browsers answer that near-instantly
  // from their own stored permission, so it's not a real wait in practice.
  const [locationConsent, setLocationConsent] = useState<"checking" | "granted" | "denied">(
    "checking"
  );
  const [kioskPosition, setKioskPosition] = useState<{
    latitude: number;
    longitude: number;
    accuracyMeters: number | null;
  } | null>(null);
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
  // Wrong-PIN counter for the auto-detect screen, where there's no
  // employeeId yet to key a per-person count off of (pinAttemptsRef only
  // applies once someone's already identified, by face match or name
  // search).
  const autoDetectPinAttemptsRef = useRef(0);
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

    try {
      const exemptions = await fetchAllScheduleExemptions();
      const map: Record<string, ScheduleExemption> = {};
      exemptions.forEach((e) => {
        map[e.employeeId] = e;
      });
      setScheduleExemptions(map);
    } catch {
      // Non-critical for a refresh — falls back to whatever was last
      // loaded successfully, same as schedule above.
    }

    try {
      setLocationPolicy(await fetchLocationPolicy());
    } catch {
      // Non-critical for a refresh — same reasoning as above.
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
        setFaceEnabled(policy?.faceEnabled ?? false);
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

      try {
        const exemptions = await fetchAllScheduleExemptions();
        if (cancelled) return;
        const map: Record<string, ScheduleExemption> = {};
        exemptions.forEach((e) => {
          map[e.employeeId] = e;
        });
        setScheduleExemptions(map);
      } catch (err) {
        if (cancelled || !navigator.onLine) return;
        console.error("Failed to load schedule exemptions:", err);
      }

      try {
        const policy = await fetchLocationPolicy();
        if (cancelled) return;
        setLocationPolicy(policy);
      } catch (err) {
        if (cancelled || !navigator.onLine) return;
        console.error("Failed to load location policy:", err);
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

  // Nothing on this screen is usable until the kiosk itself has granted
  // (or been denied) the browser's location permission — see the early
  // return near the bottom of this component. Once granted, browsers
  // remember it per-origin, so this resolves near-instantly on every
  // later visit rather than re-prompting. The "Try again" button bumps
  // this token to re-run the check (and sets locationConsent back to
  // "checking" itself, synchronously, from its own click handler —
  // rather than this effect doing it, which would run before the first
  // await on every retry).
  const [locationRetryToken, setLocationRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function checkLocation() {
      try {
        const position = await requestPosition();
        if (cancelled) return;
        setKioskPosition({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        });
        setLocationConsent("granted");
      } catch {
        if (!cancelled) setLocationConsent("denied");
      }
    }
    checkLocation();
    return () => {
      cancelled = true;
    };
  }, [locationRetryToken]);

  // The kiosk is a fixed device, so this only needs to notice it's been
  // physically moved — not track continuous movement. A transient
  // failure here just keeps the last known position rather than losing
  // location entirely over one bad reading.
  useEffect(() => {
    if (locationConsent !== "granted") return;
    const interval = setInterval(() => {
      requestPosition()
        .then((position) => {
          setKioskPosition({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
          });
        })
        .catch(() => {});
    }, LOCATION_REFRESH_MS);
    return () => clearInterval(interval);
  }, [locationConsent]);

  // Compares the kiosk's currently cached position against the
  // configured workplace (if any) — recomputed fresh wherever it's
  // called rather than threaded through as state, so it's always based
  // on whatever's most current at that moment.
  function computePunchLocation(): PunchLocation | null {
    if (!kioskPosition) return null;
    if (!locationPolicy) {
      return {
        latitude: kioskPosition.latitude,
        longitude: kioskPosition.longitude,
        accuracyMeters: kioskPosition.accuracyMeters,
        distanceMeters: null,
        withinRadius: null,
      };
    }
    const distanceMeters = haversineDistanceMeters(
      kioskPosition.latitude,
      kioskPosition.longitude,
      locationPolicy.latitude,
      locationPolicy.longitude
    );
    return {
      latitude: kioskPosition.latitude,
      longitude: kioskPosition.longitude,
      accuracyMeters: kioskPosition.accuracyMeters,
      distanceMeters: Math.round(distanceMeters),
      withinRadius: distanceMeters <= locationPolicy.radiusMeters,
    };
  }

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

  // If the camera fails outright while scanning, drop straight into the
  // auto-detect PIN screen instead of leaving the employee stuck looking
  // at a dead camera view — same fallback as the manual "Trouble with the
  // camera?" button.
  useEffect(() => {
    if (status !== "scanning" || !cameraError) return;
    const timer = setTimeout(() => {
      setCandidate(null);
      setSelectedEmployee(null);
      setPin("");
      setPinError(null);
      setStatus("pin_entry");
    }, 0);
    return () => clearTimeout(timer);
  }, [status, cameraError]);

  function startPunch(punchType: PunchType) {
    setIntent(punchType);
    setScanHint(null);
    setEmployeeSearch("");
    setPin("");
    setPinError(null);
    // PIN-only mode skips straight to the auto-detect PIN screen — no
    // name search first, see handlePinSubmit's no-employee-preselected
    // branch below.
    setStatus(faceEnabled ? "scanning" : "pin_entry");
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
    autoDetectPinAttemptsRef.current = 0;
  }

  function backToIdle() {
    setScanHint(null);
    setEmployeeSearch("");
    clearPunchFields();
    setStatus("idle");
  }

  async function handlePinSubmit() {
    if (!intent) return;
    const employee = candidate?.employee ?? selectedEmployee;

    if (!employee) {
      // Auto-detect: no one was pre-selected by a face match or a manual
      // name search, so the PIN itself has to say who this is — checked
      // against every active employee's own hash, since each has their
      // own salt (see findByPin).
      setVerifyingPin(true);
      const match = await findByPin(pin, employees.filter((e) => e.active));
      setVerifyingPin(false);

      if (!match) {
        const attempts = (autoDetectPinAttemptsRef.current += 1);

        if (attempts >= MAX_PIN_ATTEMPTS) {
          recordSuspiciousEvent({
            eventId: `evt_${crypto.randomUUID()}`,
            employeeId: "unknown",
            employeeName: "Unrecognized PIN",
            timestamp: new Date().toISOString(),
            reason: "wrong_pin",
            attempts,
            kioskId: KIOSK_ID,
          }).catch(() => {});
          playChime("error");
          setStatus("suspicious");
          setTimeout(() => backToIdle(), 3000);
          return;
        }

        playChime("error");
        setPinError(`PIN not recognized (attempt ${attempts}/${MAX_PIN_ATTEMPTS})`);
        setPin("");
        return;
      }

      autoDetectPinAttemptsRef.current = 0;
      pinAttemptsRef.current.set(match.employeeId, 0);
      setPinError(null);
      await evaluateAndFinalize(match, intent);
      return;
    }

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

    // Checked before anything employee-specific — this is about whether
    // the kiosk itself is where it's supposed to be, which applies the
    // same way to every punch through it, in or out.
    const punchLocation = computePunchLocation();
    if (!punchLocation) {
      setBlockedReason("Confirming this kiosk's location — try again in a moment.");
      setOverridable(false);
      setStatus("blocked");
      return;
    }
    if (punchLocation.withinRadius === false) {
      setPendingShift(null);
      setRequiredSupervisor(findCurrentSupervisor(schedule, mondayOf(now), now));
      setOverridable(true);
      setBlockedReason(
        `This kiosk isn't at the workplace (about ${punchLocation.distanceMeters}m away).`
      );
      setStatus("blocked");
      return;
    }

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

      // Admin has explicitly waived the schedule requirement for
      // everyone, for this whole week (src/app/admin/schedule) — treat it
      // exactly like the no-schedule-posted case above.
      if (schedule.scheduleRequirementWaived) {
        finalizePunch(employee, punchType, null, null, true);
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

      // Not on today's schedule at all (as opposed to scheduled but late,
      // which still needs a supervisor) — an active exemption skips the
      // block entirely, same as the no-schedule-posted case above.
      if (
        !resolution &&
        scheduleExemptionIsActive(scheduleExemptions[employee.employeeId] ?? null)
      ) {
        finalizePunch(employee, punchType, null, null, true);
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
    if (!lastLog || lastLog.type !== "punch_in") {
      setBlockedReason(`${employee.fullName} isn't currently punched in.`);
      setOverridable(false);
      setStatus("blocked");
      return;
    }

    if (isEarlyPunchOut(lastLog.scheduledShiftEnd, now)) {
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
    override: AttendanceOverride | null,
    scheduleExempt = false
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

    const device: PunchDevice = {
      deviceId: getDeviceId(),
      summary: summarizeUserAgent(navigator.userAgent),
    };

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
      location: computePunchLocation(),
      device,
      ...(punchType === "punch_in"
        ? {
            scheduledShiftEnd: resolution?.scheduledEndIso ?? null,
            scheduledSupervisorEmployeeId: resolution?.supervisor?.employeeId ?? null,
            scheduledSupervisorName: resolution?.supervisor?.employeeName ?? null,
          }
        : {}),
      ...(override ? { override } : {}),
      ...(scheduleExempt ? { scheduleExempt: true } : {}),
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

  // Nothing below this point is reachable without the kiosk's own
  // location consent — every punch gets checked against it (see
  // evaluateAndFinalize), so there's no useful "PIN-only fallback" here
  // the way there is for facial recognition; without a location, the
  // check itself can't run at all.
  if (locationConsent === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-600" />
      </div>
    );
  }

  if (locationConsent === "denied") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-4 text-center text-white">
        <MapPinOff className="h-12 w-12 text-neutral-600" />
        <h1 className="text-xl font-semibold">Location access required</h1>
        <p className="max-w-sm text-sm text-neutral-400">
          This kiosk needs permission to check its own location before
          anyone can punch in or out. Enable location access for this site
          in your browser&apos;s settings, then try again.
        </p>
        <button
          type="button"
          onClick={() => {
            setLocationConsent("checking");
            setLocationRetryToken((t) => t + 1);
          }}
          className="rounded-lg bg-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-200 hover:bg-neutral-700"
        >
          Try again
        </button>
      </div>
    );
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
                  <button
                    type="button"
                    onClick={() => {
                      setScanHint(null);
                      setCandidate(null);
                      setSelectedEmployee(null);
                      setPin("");
                      setPinError(null);
                      setStatus("pin_entry");
                    }}
                    className="text-xs text-blue-400 underline hover:text-blue-300"
                  >
                    Trouble with the camera? Enter PIN instead
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

              {status === "pin_entry" && (
                <div className="flex flex-col items-center gap-4">
                  <div className="flex items-center gap-2 text-lg font-medium">
                    <UserCheck className="h-5 w-5 text-blue-400" />
                    {candidate || selectedEmployee
                      ? `Hi ${(candidate?.employee ?? selectedEmployee)?.fullName}, enter your PIN`
                      : "Enter your PIN"}
                  </div>
                  <PinPad
                    value={pin}
                    onChange={setPin}
                    onSubmit={handlePinSubmit}
                    disabled={verifyingPin}
                  />
                  {pinError && <p className="text-sm text-red-400">{pinError}</p>}
                  {/* Auto-detect mode (no name search first) — a "wrong PIN"
                      here just means it didn't match anyone at all, so offer
                      a way to identify by name instead of retrying blind. */}
                  {!candidate && !selectedEmployee && (
                    <button
                      type="button"
                      onClick={() => {
                        setPinError(null);
                        setPin("");
                        setEmployeeSearch("");
                        setStatus("select_employee");
                      }}
                      className="text-xs text-blue-400 underline hover:text-blue-300"
                    >
                      Search your name instead
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={backToIdle}
                    className="text-sm text-neutral-400 hover:text-neutral-200"
                  >
                    {candidate || selectedEmployee ? "Not you? Cancel" : "Cancel"}
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
