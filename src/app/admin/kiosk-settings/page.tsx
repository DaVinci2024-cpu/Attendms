"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { RequireAdmin } from "@/components/RequireAdmin";
import {
  fetchKioskDisplaySettings,
  saveKioskDisplaySettings,
} from "@/lib/firestoreRepo";
import { COMPANY_NAME } from "@/lib/constants";

export default function KioskSettingsPage() {
  return (
    <RequireAdmin>
      <KioskSettingsForm />
    </RequireAdmin>
  );
}

function KioskSettingsForm() {
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
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Kiosk display</h1>
        <p className="text-sm text-neutral-400">
          What employees see on the kiosk screen before they punch in or out.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl bg-neutral-900 p-4">
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
        </div>
      )}
    </div>
  );
}
