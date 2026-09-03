"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Fingerprint,
  KeyRound,
  Loader2,
  ScanFace,
  Save,
} from "lucide-react";
import { RequireAdmin } from "@/components/RequireAdmin";
import {
  fetchAuthPolicy,
  fetchKioskDisplaySettings,
  saveAuthPolicy,
  saveKioskDisplaySettings,
} from "@/lib/firestoreRepo";
import { COMPANY_NAME } from "@/lib/constants";

export default function KioskSettingsPage() {
  return (
    <RequireAdmin>
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold">Kiosk display</h1>
          <p className="text-sm text-neutral-400">
            What employees see on the kiosk screen, and how they identify
            themselves before they punch in or out.
          </p>
        </div>
        <DisplaySettingsForm />
        <IdentificationMethodsForm />
      </div>
    </RequireAdmin>
  );
}

function DisplaySettingsForm() {
  const [headline, setHeadline] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeActive, setNoticeActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchKioskDisplaySettings()
      .then((settings) => {
        if (cancelled) return;
        setHeadline(settings?.headline ?? `Welcome to ${COMPANY_NAME}`);
        setNotice(settings?.notice ?? "");
        setNoticeActive(settings?.noticeActive ?? false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load settings");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveKioskDisplaySettings({
        headline: headline.trim() || `Welcome to ${COMPANY_NAME}`,
        notice: notice.trim(),
        noticeActive,
        updatedAt: new Date().toISOString(),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-neutral-900 p-4">
      <h2 className="font-medium">Headline &amp; notice</h2>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Headline
            <input
              className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder={`Welcome to ${COMPANY_NAME}`}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Important notice (optional)
            <textarea
              className="min-h-24 rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
              value={notice}
              onChange={(e) => setNotice(e.target.value)}
              placeholder="e.g. Staff meeting today at 3pm"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={noticeActive}
              onChange={(e) => setNoticeActive(e.target.checked)}
            />
            Show this notice on the kiosk
          </label>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
          >
            {saving ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Save className="h-5 w-5" />
            )}
            Save
          </button>
          {saved && (
            <p className="flex items-center gap-1 text-sm text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> Saved — visible on the
              kiosk now.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  description,
  checked,
  disabled,
  locked,
  onChange,
}: {
  icon: typeof ScanFace;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  locked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg bg-neutral-800 p-3">
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" />
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-neutral-400">{description}</p>
        </div>
      </div>
      {locked ? (
        <span className="shrink-0 rounded-full bg-emerald-900/50 px-2.5 py-1 text-xs font-medium text-emerald-300">
          Always on
        </span>
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          disabled={disabled}
          onClick={() => onChange?.(!checked)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            checked ? "bg-blue-600" : "bg-neutral-700"
          } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              checked ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      )}
    </div>
  );
}

function IdentificationMethodsForm() {
  const [faceEnabled, setFaceEnabled] = useState(false);
  const [fingerprintEnabled, setFingerprintEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAuthPolicy()
      .then((policy) => {
        if (cancelled) return;
        setFaceEnabled(policy?.faceEnabled ?? false);
        setFingerprintEnabled(policy?.fingerprintEnabled ?? false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load settings");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveAuthPolicy({
        faceEnabled,
        fingerprintEnabled,
        updatedAt: new Date().toISOString(),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-neutral-900 p-4">
      <div>
        <h2 className="font-medium">Identification methods</h2>
        <p className="mt-1 text-xs text-neutral-400">
          PIN is always required — as its own method and as the final
          confirmation step after any match below. Turn everything else off
          and PIN alone drives punch in/out: pick a name from a list, then
          enter the PIN.
        </p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <ToggleRow
              icon={ScanFace}
              label="Facial recognition"
              description="Kiosk camera scans for a face match before asking for the PIN."
              checked={faceEnabled}
              onChange={(v) => {
                setFaceEnabled(v);
                setSaved(false);
              }}
            />
            <ToggleRow
              icon={Fingerprint}
              label="Fingerprint"
              description="Requires a fingerprint reader — not set up yet, coming once hardware is chosen."
              checked={fingerprintEnabled}
              disabled
              onChange={(v) => {
                setFingerprintEnabled(v);
                setSaved(false);
              }}
            />
            <ToggleRow
              icon={KeyRound}
              label="PIN"
              description="Employees confirm with their PIN every time — required, can't be turned off."
              checked
              locked
            />
          </div>

          {!faceEnabled && !fingerprintEnabled && (
            <p className="rounded-lg bg-blue-950/40 px-3 py-2 text-xs text-blue-200">
              With everything else off, the kiosk skips the camera entirely —
              employees pick their name from a list, then enter their PIN.
            </p>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
          >
            {saving ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Save className="h-5 w-5" />
            )}
            Save
          </button>
          {saved && (
            <p className="flex items-center gap-1 text-sm text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> Saved — the kiosk will use
              this the next time it loads.
            </p>
          )}
        </>
      )}
    </section>
  );
}
