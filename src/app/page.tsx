"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  LogIn,
  LogOut,
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
  recordPunch,
  recordSuspiciousEvent,
} from "@/lib/firestoreRepo";
import {
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
  const { videoRef, ready: cameraReady, error: cameraError } = useCamera();
  const { loaded: modelsLoaded, error: modelsError } = useFaceModels();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLog[]>([]);
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine
  );

  const [status, setStatus] = useState<KioskStatus>("idle");
  const [intent, setIntent] = useState<PunchType | null>(null);
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
    } catch {
      // Firestore serves from the local IndexedDB cache when offline; a
      // failure here just means the cache is still empty (first-ever load).
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const [emps, logs] = await Promise.all([
          fetchAllEmployees(),
          fetchAllAttendance(),
        ]);
        if (cancelled) return;
        setEmployees(emps);
        setAttendanceLogs(logs);
      } catch {
        // Firestore serves from the local IndexedDB cache when offline; a
        // failure here just means the cache is still empty (first-ever load).
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
        if (!descriptor) return;

        const match = findBestMatch(descriptor, employees);
        if (!match) return;

        const debounceUntil =
          debounceUntilRef.current.get(match.employee.employeeId) ?? 0;
        if (Date.now() < debounceUntil) return;

        pinAttemptsRef.current.set(match.employee.employeeId, 0);
        setCandidate(match);
        setPin("");
        setPinError(null);
        setStatus("pin_entry");
      } finally {
        detectingRef.current = false;
      }
    }, DETECTION_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [cameraReady, modelsLoaded, employees, videoRef]);

  function startPunch(punchType: PunchType) {
    setIntent(punchType);
    setStatus("scanning");
  }

  function backToIdle() {
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
        await recordSuspiciousEvent({
          eventId: `evt_${crypto.randomUUID()}`,
          employeeId: employee.employeeId,
          employeeName: employee.fullName,
          timestamp: new Date().toISOString(),
          reason: "wrong_pin",
          attempts,
          kioskId: KIOSK_ID,
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

    await recordPunch(log);
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
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Attendms</h1>
        {!online && (
          <span className="flex items-center gap-1 rounded-full bg-amber-900/50 px-3 py-1 text-xs text-amber-300">
            <WifiOff className="h-3 w-3" /> Offline — punches queue locally
          </span>
        )}
      </div>

      {status === "idle" && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => startPunch("punch_in")}
            className="flex items-center justify-center gap-3 rounded-xl bg-emerald-700 px-6 py-8 text-xl font-semibold text-white transition hover:bg-emerald-600"
          >
            <LogIn className="h-8 w-8" /> Punch In
          </button>
          <button
            type="button"
            onClick={() => startPunch("punch_out")}
            className="flex items-center justify-center gap-3 rounded-xl bg-blue-700 px-6 py-8 text-xl font-semibold text-white transition hover:bg-blue-600"
          >
            <LogOut className="h-8 w-8" /> Punch Out
          </button>
        </div>
      )}

      {status !== "idle" && (
        <>
          <CameraView ref={videoRef} ready={cameraReady} error={cameraError} />

          {modelsError && (
            <p className="text-sm text-red-400">
              Failed to load face recognition models: {modelsError}
            </p>
          )}
          {!modelsLoaded && !modelsError && (
            <p className="text-sm text-neutral-400">Loading face recognition models...</p>
          )}

          {status === "scanning" && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-center text-sm text-neutral-400">
                Looking for a face to {intent === "punch_in" ? "punch in" : "punch out"}...
              </p>
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
            <div className="flex flex-col items-center gap-4 rounded-xl bg-neutral-900 p-6">
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
        </>
      )}

      <div className="mt-auto flex items-center justify-center gap-6 border-t border-neutral-900 pt-4">
        <Link
          href="/portal/login"
          className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300"
        >
          <Users className="h-3.5 w-3.5" /> Employee portal
        </Link>
        <Link
          href="/admin/dashboard"
          className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300"
        >
          <LayoutDashboard className="h-3.5 w-3.5" /> Admin portal
        </Link>
      </div>
    </div>
  );
}
