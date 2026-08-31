"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  LogIn,
  LogOut,
  Megaphone,
  ShieldAlert,
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
  fetchAllAttendance,
  fetchAllEmployees,
  fetchKioskDisplaySettings,
  recordPunch,
  recordSuspiciousEvent,
} from "@/lib/firestoreRepo";
import {
  COMPANY_NAME,
  KIOSK_ID,
  DETECTION_INTERVAL_MS,
  MAX_PIN_ATTEMPTS,
  PUNCH_DEBOUNCE_MS,
} from "@/lib/constants";
import type { AttendanceLog, Employee, PunchType } from "@/lib/types";

type KioskStatus = "idle" | "scanning" | "pin_entry" | "success" | "suspicious";

interface SuccessInfo {
  employeeName: string;
  punchType: PunchType;
  durationLabel?: string;
}

export default function Home() {
  const [status, setStatus] = useState<KioskStatus>("idle");
  const {
    videoRef,
    ready: cameraReady,
    error: cameraError,
  } = useCamera(status !== "idle");
  const { loaded: modelsLoaded, error: modelsError } = useFaceModels();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLog[]>([]);
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine
  );
  const [headline, setHeadline] = useState(`Welcome to ${COMPANY_NAME}`);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [intent, setIntent] = useState<PunchType | null>(null);
  const [scanHint, setScanHint] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<MatchResult | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [successInfo, setSuccessInfo] = useState<SuccessInfo | null>(null);

  const debounceUntilRef = useRef<Map<string, number>>(new Map());
  const pinAttemptsRef = useRef<Map<string, number>>(new Map());
  const detectingRef = useRef(false);
  const statusRef = useRef<KioskStatus>("idle");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const refreshData = useCallback(async () => {
    try {
      const [emps, logs] = await Promise.all([
        fetchAllEmployees(),
        fetchAllAttendance(),
      ]);
      setEmployees(emps);
      setAttendanceLogs(logs);
      setLoadError(null);
    } catch (err) {
      // Firestore serves from the local IndexedDB cache when offline, so a
      // failure while genuinely offline just means the cache is still
      // empty — not worth alarming over. A failure while online (rules
      // issue, network hiccup, etc.) is surfaced instead of silently
      // leaving the kiosk with stale/empty data.
      if (navigator.onLine) {
        setLoadError(err instanceof Error ? err.message : "Failed to load data");
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const [emps, logs, display] = await Promise.all([
          fetchAllEmployees(),
          fetchAllAttendance(),
          fetchKioskDisplaySettings(),
        ]);
        if (cancelled) return;
        setEmployees(emps);
        setAttendanceLogs(logs);
        setLoadError(null);
        if (display?.headline) setHeadline(display.headline);
        setNotice(display?.noticeActive && display.notice ? display.notice : null);
      } catch (err) {
        if (cancelled) return;
        if (navigator.onLine) {
          setLoadError(err instanceof Error ? err.message : "Failed to load data");
        }
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

  function startPunch(punchType: PunchType) {
    setIntent(punchType);
    setScanHint(null);
    setStatus("scanning");
    // Refresh employees/attendance right as a punch starts, so a kiosk
    // tab left open for a while still sees anyone enrolled since it loaded
    // (camera/model startup gives this a moment to land before scanning
    // actually needs it).
    refreshData();
  }

  function backToIdle() {
    setScanHint(null);
    setIntent(null);
    setCandidate(null);
    setPin("");
    setPinError(null);
    setStatus("idle");
  }

  async function handlePinSubmit() {
    if (!candidate || !intent) return;
    const employee = candidate.employee;

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

    const punchType = intent;

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
      matchConfidence: candidate.distance,
      pinConfirmed: true,
      kioskId: KIOSK_ID,
      syncedOffline: !online,
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
    setCandidate(null);
    setPin("");
    setIntent(null);

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
              Couldn&apos;t load employee data: {loadError}
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
                    onClick={backToIdle}
                    className="text-sm text-neutral-400 underline hover:text-neutral-200"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {status === "pin_entry" && candidate && (
                <div className="flex flex-col items-center gap-4">
                  <div className="flex items-center gap-2 text-lg font-medium">
                    <UserCheck className="h-5 w-5 text-blue-400" />
                    Hi {candidate.employee.fullName}, enter your PIN
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
