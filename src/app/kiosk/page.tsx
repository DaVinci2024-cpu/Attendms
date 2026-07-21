"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldAlert, UserCheck, WifiOff } from "lucide-react";
import { CameraView } from "@/components/CameraView";
import { PinPad } from "@/components/PinPad";
import { useCamera } from "@/hooks/useCamera";
import { useFaceModels } from "@/hooks/useFaceModels";
import { detectSingleFaceDescriptor } from "@/lib/faceApi";
import { findBestMatch, type MatchResult } from "@/lib/faceMatching";
import { nextPunchType } from "@/lib/punchLogic";
import { playChime } from "@/lib/chime";
import { verifyPin } from "@/lib/pin";
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

type KioskStatus = "scanning" | "pin_entry" | "success" | "suspicious";

interface SuccessInfo {
  employeeName: string;
  punchType: PunchType;
}

export default function KioskPage() {
  const { videoRef, ready: cameraReady, error: cameraError } = useCamera();
  const { loaded: modelsLoaded, error: modelsError } = useFaceModels();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLog[]>([]);
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine
  );

  const [status, setStatus] = useState<KioskStatus>("scanning");
  const [candidate, setCandidate] = useState<MatchResult | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [successInfo, setSuccessInfo] = useState<SuccessInfo | null>(null);

  const debounceUntilRef = useRef<Map<string, number>>(new Map());
  const pinAttemptsRef = useRef<Map<string, number>>(new Map());
  const detectingRef = useRef(false);
  const statusRef = useRef<KioskStatus>("scanning");
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
      // Reconnect resync: refresh cached employees/logs so punch-direction
      // decisions reflect the latest server state (spec Section 3, Flow B).
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

  // Continuous detection loop.
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

  function cancelPinEntry() {
    setCandidate(null);
    setPin("");
    setPinError(null);
    setStatus("scanning");
  }

  async function handlePinSubmit() {
    if (!candidate) return;
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
        setTimeout(() => cancelPinEntry(), 3000);
        return;
      }

      playChime("error");
      setPinError(`Incorrect PIN (attempt ${attempts}/${MAX_PIN_ATTEMPTS})`);
      setPin("");
      return;
    }

    const punchType = nextPunchType(employee.employeeId, attendanceLogs);
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
    setSuccessInfo({ employeeName: employee.fullName, punchType });
    setStatus("success");
    setCandidate(null);
    setPin("");

    setTimeout(() => {
      setSuccessInfo(null);
      setStatus("scanning");
    }, 2500);
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
        {!online && (
          <span className="flex items-center gap-1 rounded-full bg-amber-900/50 px-3 py-1 text-xs text-amber-300">
            <WifiOff className="h-3 w-3" /> Offline — punches queue locally
          </span>
        )}
      </div>

      <div>
        <h1 className="text-2xl font-semibold">Attendance kiosk</h1>
        <p className="text-sm text-neutral-400">
          {employees.length} employee{employees.length === 1 ? "" : "s"}{" "}
          cached locally.
        </p>
      </div>

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
        <p className="text-center text-sm text-neutral-400">
          Looking for a face...
        </p>
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
            onClick={cancelPinEntry}
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
  );
}
