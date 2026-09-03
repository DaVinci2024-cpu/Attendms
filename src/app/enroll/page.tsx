"use client";

import { useEffect, useState } from "react";
import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { CameraView } from "@/components/CameraView";
import { RequireAdmin } from "@/components/RequireAdmin";
import { useCamera } from "@/hooks/useCamera";
import { useFaceModels } from "@/hooks/useFaceModels";
import { detectSingleFaceDescriptor } from "@/lib/faceApi";
import { createEmployee, ensureCompanyDoc, fetchAllEmployees } from "@/lib/firestoreRepo";
import { findByPin, hashPin, PIN_PATTERN } from "@/lib/pin";
import { CONSENT_POLICY_VERSION, ADMIN_EMAIL } from "@/lib/constants";
import type { Employee } from "@/lib/types";

const MAX_SNAPSHOTS = 3;

export default function EnrollPage() {
  return (
    <RequireAdmin>
      <EnrollForm />
    </RequireAdmin>
  );
}

function EnrollForm() {
  const { videoRef, ready, error: cameraError } = useCamera();
  const { loaded: modelsLoaded, error: modelsError } = useFaceModels();

  const [fullName, setFullName] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [role, setRole] = useState<Employee["role"]>("employee");
  const [consentChecked, setConsentChecked] = useState(false);
  const [recordedBy, setRecordedBy] = useState(ADMIN_EMAIL);

  const [descriptors, setDescriptors] = useState<number[][]>([]);
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    ensureCompanyDoc();
  }, []);

  const canCapture =
    ready && modelsLoaded && !capturing && descriptors.length < MAX_SNAPSHOTS;

  const pinValid = PIN_PATTERN.test(pinCode);
  const canSave =
    fullName.trim().length > 0 &&
    pinValid &&
    consentChecked &&
    recordedBy.trim().length > 0 &&
    descriptors.length > 0 &&
    saveState !== "saving";

  async function handleCapture() {
    if (!videoRef.current) return;
    setCapturing(true);
    setCaptureStatus(null);
    try {
      const descriptor = await detectSingleFaceDescriptor(videoRef.current);
      if (!descriptor) {
        setCaptureStatus("No face detected — center your face and try again.");
        return;
      }
      // Only the numeric descriptor is kept; the video frame itself is
      // never captured to an image or uploaded anywhere.
      setDescriptors((prev) => [...prev, Array.from(descriptor)]);
      setCaptureStatus(null);
    } finally {
      setCapturing(false);
    }
  }

  async function handleSave() {
    setSaveState("saving");
    setSaveError(null);
    try {
      const existingEmployees = await fetchAllEmployees();
      const duplicate = await findByPin(pinCode, existingEmployees);
      if (duplicate) {
        setSaveState("error");
        setSaveError(
          `This PIN is already in use by ${duplicate.fullName} — pick a different one.`
        );
        return;
      }

      const now = new Date().toISOString();
      const { pinHash, pinSalt } = await hashPin(pinCode);
      const employee: Employee = {
        employeeId: `emp_${crypto.randomUUID()}`,
        fullName: fullName.trim(),
        pinHash,
        pinSalt,
        faceDescriptors: descriptors.map((values) => ({ values })),
        role,
        active: true,
        createdAt: now,
        consent: {
          consentedAt: now,
          policyVersion: CONSENT_POLICY_VERSION,
          recordedBy: recordedBy.trim(),
        },
      };
      await createEmployee(employee);
      setSaveState("saved");
      setFullName("");
      setPinCode("");
      setConsentChecked(false);
      setDescriptors([]);
    } catch (err) {
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : "Failed to save employee");
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Enroll employee</h1>
        <p className="text-sm text-neutral-400">
          Capture 1-3 face snapshots per employee. Only the extracted
          embeddings are stored — raw images never leave the browser.
        </p>
      </div>

      <CameraView ref={videoRef} ready={ready} error={cameraError}>
        {descriptors.length > 0 && (
          <div className="absolute right-2 top-2 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
            {descriptors.length}/{MAX_SNAPSHOTS} captured
          </div>
        )}
      </CameraView>

      {modelsError && (
        <p className="text-sm text-red-400">
          Failed to load face recognition models: {modelsError}
        </p>
      )}

      <button
        type="button"
        onClick={handleCapture}
        disabled={!canCapture}
        className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition disabled:cursor-not-allowed disabled:bg-neutral-700"
      >
        {capturing ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Camera className="h-5 w-5" />
        )}
        Capture snapshot
      </button>
      {captureStatus && (
        <p className="-mt-4 text-sm text-amber-400">{captureStatus}</p>
      )}
      {!modelsLoaded && !modelsError && (
        <p className="-mt-4 text-sm text-neutral-400">
          Loading face recognition models...
        </p>
      )}

      <div className="flex flex-col gap-4 rounded-xl bg-neutral-900 p-4">
        <label className="flex flex-col gap-1 text-sm">
          Full name
          <input
            className="rounded-lg bg-neutral-800 px-3 py-2 text-base outline-none focus:ring-2 focus:ring-blue-600"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Awaab Tariq"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          PIN (6 digits)
          <input
            className="rounded-lg bg-neutral-800 px-3 py-2 text-base outline-none focus:ring-2 focus:ring-blue-600"
            value={pinCode}
            onChange={(e) => setPinCode(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Role
          <select
            className="rounded-lg bg-neutral-800 px-3 py-2 text-base outline-none focus:ring-2 focus:ring-blue-600"
            value={role}
            onChange={(e) => setRole(e.target.value as Employee["role"])}
          >
            <option value="employee">Employee</option>
            <option value="admin">Admin</option>
          </select>
        </label>

        <div className="flex flex-col gap-2 rounded-lg bg-neutral-800 p-3 text-sm">
          <p className="text-neutral-300">
            <strong>Consent to biometric data processing</strong> (data
            handling policy {CONSENT_POLICY_VERSION}, aligned with Uganda&apos;s
            Data Protection and Privacy Act, 2019 — have this reviewed by
            counsel before relying on it): this employee&apos;s face is
            captured live and converted, in this browser, into numeric
            descriptors used only to match their face for attendance
            punches at this company. The photo itself is never saved,
            uploaded, or shared — only the descriptors and this consent
            record are stored. The employee (or an admin on their behalf)
            may request deletion of their descriptors and this consent
            record at any time from the Manage employees page, which
            removes them from future matching immediately.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
            />
            Employee has reviewed and consents to this policy
          </label>
          <label className="flex flex-col gap-1">
            Recorded by (admin email)
            <input
              className="rounded-lg bg-neutral-700 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
              value={recordedBy}
              onChange={(e) => setRecordedBy(e.target.value)}
            />
          </label>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white transition disabled:cursor-not-allowed disabled:bg-neutral-700"
        >
          {saveState === "saving" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-5 w-5" />
          )}
          Save employee
        </button>
        {saveState === "saved" && (
          <p className="text-sm text-emerald-400">Employee saved.</p>
        )}
        {saveState === "error" && (
          <p className="text-sm text-red-400">{saveError}</p>
        )}
      </div>
    </div>
  );
}
