"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Download,
  Laptop,
  Loader2,
  Network,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { db, SYNCED_TABLES } from "@/lib/db";
import { syncService } from "@/lib/syncService";
import {
  buildBackup,
  exportBackup,
  restoreBackup,
  validateBackupFile,
  type BackupFile,
} from "@/lib/backup";

// Deliberately reachable with no sign-in (outside the /admin/* tree's
// RequireAdmin gate entirely), unlike every other admin page — same
// chicken-and-egg /api/settings/firebase-config already documents: on a
// fresh install nobody can sign in at all until a Firebase project is
// connected from right here. Once Firebase Auth *is* configured, reaching
// this page still only takes local machine access, not a login — this
// server only ever listens on localhost (see electron/main.cjs), so
// there's nothing a login check would protect that physical/local access
// doesn't already grant. Sidebar.tsx still links here for convenience, but
// that link (and everything else in that sidebar) only ever renders once
// someone's already past RequireAdmin elsewhere in the app.
export default function SystemPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        title="System"
        subtitle="This installation's Firebase project, local-network pairing, and full-data backup."
        accent="orange"
        actions={
          <Link href="/admin" className="text-sm text-neutral-400 hover:text-neutral-200">
            Back to admin
          </Link>
        }
      />
      <DiagnosticsCard />
      <CloudSyncCard />
      <LocalNetworkCard />
      <BackupCard />
    </div>
  );
}

// --- Diagnostics -------------------------------------------------------

function DiagnosticsCard() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState(() => ({
    isSyncing: syncService.isSyncing,
    lastSuccess: syncService.lastSuccess,
    error: syncService.error,
  }));

  useEffect(() => {
    let cancelled = false;
    async function loadCounts() {
      const next: Record<string, number> = {};
      for (const table of SYNCED_TABLES) {
        next[table] = await db[table].count();
      }
      if (!cancelled) setCounts(next);
    }
    loadCounts();
    const interval = setInterval(loadCounts, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => syncService.subscribe(setStatus), []);

  const totalRecords = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <section className="rounded-xl bg-neutral-900 p-4">
      <h2 className="mb-3 flex items-center gap-2 font-medium">
        <Laptop className="h-4 w-4 text-orange-400" /> This device
      </h2>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg bg-neutral-800 p-3">
          <p className="text-neutral-400">Cloud sync</p>
          <p className="mt-1 flex items-center gap-1.5 font-medium">
            {status.isSyncing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" /> Syncing
              </>
            ) : status.error ? (
              <>
                <CloudOff className="h-3.5 w-3.5 text-amber-400" /> Paused
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Idle
              </>
            )}
          </p>
        </div>
        <div className="rounded-lg bg-neutral-800 p-3">
          <p className="text-neutral-400">Last synced</p>
          <p className="mt-1 font-medium">
            {status.lastSuccess ? status.lastSuccess.toLocaleTimeString() : "Never"}
          </p>
        </div>
        <div className="rounded-lg bg-neutral-800 p-3">
          <p className="text-neutral-400">Local records</p>
          <p className="mt-1 font-medium">{totalRecords}</p>
        </div>
      </div>
      {status.error && (
        <p className="mt-3 text-sm text-amber-400">{status.error}</p>
      )}
    </section>
  );
}

// --- Cloud Sync ----------------------------------------------------------

function CloudSyncCard() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [hasWebConfig, setHasWebConfig] = useState(false);
  const [json, setJson] = useState("");
  const [webConfigJson, setWebConfigJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  async function loadStatus(cancelled: () => boolean) {
    try {
      const res = await fetch("/api/settings/firebase-config");
      const data = await res.json();
      if (cancelled()) return;
      setConfigured(data.configured);
      setProjectId(data.projectId);
      setHasWebConfig(data.hasWebConfig);
    } catch {
      if (!cancelled()) setConfigured(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadStatus(() => cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleConnect() {
    setSaving(true);
    setError(null);
    try {
      const serviceAccount = JSON.parse(json);
      const trimmedWebConfig = webConfigJson.trim();
      const webConfig = trimmedWebConfig ? JSON.parse(trimmedWebConfig) : undefined;
      const res = await fetch("/api/settings/firebase-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceAccount, webConfig }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to connect");
      setRestarting(true);
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? "That doesn't look like valid JSON — paste the whole file/object, braces included."
          : err instanceof Error
            ? err.message
            : "Failed to connect"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect this install's Firebase project? Local data stays on this device.")) {
      return;
    }
    setSaving(true);
    try {
      await fetch("/api/settings/firebase-config", { method: "DELETE" });
      setRestarting(true);
    } finally {
      setSaving(false);
    }
  }

  if (restarting) {
    return (
      <section className="rounded-xl bg-neutral-900 p-4 text-sm text-neutral-300">
        <p className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Restarting to apply the new configuration…
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl bg-neutral-900 p-4">
      <h2 className="mb-1 font-medium">Cloud Sync</h2>
      <p className="mb-3 text-sm text-neutral-400">
        Connects this installation to your own Firebase project — every kiosk/admin machine at
        this business should point at the same project.
      </p>

      {configured === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
      ) : configured ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> Connected to{" "}
            <span className="font-mono">{projectId}</span>
          </div>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={saving}
            className="self-start rounded-lg bg-neutral-800 px-3 py-2 text-sm text-red-400 hover:bg-neutral-700 disabled:opacity-50"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-amber-400">
            Not connected — this device only has whatever&apos;s recorded locally. Nothing is
            backed up off this machine until a project is connected.
          </p>
          <label className="flex flex-col gap-1 text-sm">
            Service account JSON
            <span className="text-xs text-neutral-500">
              Firebase console → Project settings → Service accounts → Generate new private key
            </span>
            <textarea
              className="min-h-32 rounded-lg bg-neutral-800 px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-blue-600"
              value={json}
              onChange={(e) => setJson(e.target.value)}
              placeholder='{"type": "service_account", "project_id": "...", ...}'
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Web app config {hasWebConfig && "(already set — leave blank to keep it)"}
            <span className="text-xs text-neutral-500">
              Firebase console → Project settings → Your apps → SDK setup and configuration. Used
              for sign-in (admin/portal) — separate from the service account above.
            </span>
            <textarea
              className="min-h-24 rounded-lg bg-neutral-800 px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-blue-600"
              value={webConfigJson}
              onChange={(e) => setWebConfigJson(e.target.value)}
              placeholder='{"apiKey": "...", "authDomain": "...", "projectId": "...", ...}'
            />
          </label>
          {error && <p className="text-sm font-medium text-red-400">{error}</p>}
          <button
            type="button"
            onClick={handleConnect}
            disabled={saving || !json.trim() || (!hasWebConfig && !webConfigJson.trim())}
            className="flex items-center justify-center gap-2 self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            <Save className="h-4 w-4" /> Connect
          </button>
        </div>
      )}
    </section>
  );
}

// --- Local Network -------------------------------------------------------

interface SelfInfo {
  deviceName: string;
  addresses: string[];
  port: number;
  businessId: string;
  businessIdSource: "firebase" | "manual";
}

interface Peer {
  id: string;
  ip: string;
  port: number;
  deviceName: string;
  source: "auto" | "manual";
  lastSeen: number;
}

function LocalNetworkCard() {
  const [self, setSelf] = useState<SelfInfo | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [pairingCode, setPairingCode] = useState("");
  const [peerIp, setPeerIp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(isCancelled: () => boolean = () => false) {
    const [selfRes, peersRes] = await Promise.all([
      fetch("/api/lan/self").then((r) => r.json()),
      fetch("/api/lan/peers").then((r) => r.json()),
    ]);
    if (isCancelled()) return;
    setSelf(selfRes);
    setPeers(peersRes.peers ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refresh(() => cancelled);
    })();
    const interval = setInterval(() => {
      void refresh(() => cancelled);
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handlePair() {
    if (!pairingCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/lan/business-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: pairingCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pair");
      setBusy(false);
    }
  }

  async function handleAddPeer() {
    if (!peerIp.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/lan/peers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: peerIp.trim() }),
      });
      setPeerIp("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRemovePeer(id: string) {
    await fetch(`/api/lan/peers/${id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <section className="rounded-xl bg-neutral-900 p-4">
      <h2 className="mb-1 flex items-center gap-2 font-medium">
        <Network className="h-4 w-4 text-orange-400" /> Local Network
      </h2>
      <p className="mb-3 text-sm text-neutral-400">
        Other kiosks/admin machines on this same WiFi/Ethernet sync directly with this one, with
        no internet involved — useful when several machines at one site are set up before (or
        without) a Firebase project, or during an internet outage.
      </p>

      {self && (
        <div className="mb-3 rounded-lg bg-neutral-800 p-3 text-sm">
          <p className="text-neutral-400">This machine</p>
          <p className="font-medium">{self.deviceName}</p>
          <p className="text-neutral-400">
            {self.addresses.join(", ") || "No network address found"}:{self.port}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Pairing group:{" "}
            <span className="font-mono">{self.businessId}</span>{" "}
            {self.businessIdSource === "firebase"
              ? "(from the connected Firebase project — every machine on that project auto-pairs)"
              : "(no Firebase project connected — share this code with another machine's System page to pair them)"}
          </p>
        </div>
      )}

      {self?.businessIdSource === "manual" && (
        <div className="mb-3 flex gap-2">
          <input
            type="text"
            className="flex-1 rounded-lg bg-neutral-800 px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-600"
            placeholder="Paste the pairing code from another machine"
            value={pairingCode}
            onChange={(e) => setPairingCode(e.target.value)}
          />
          <button
            type="button"
            onClick={handlePair}
            disabled={busy || !pairingCode.trim()}
            className="rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
          >
            Pair
          </button>
        </div>
      )}
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <h3 className="mb-2 text-sm font-medium text-neutral-300">
        Peers {peers.length > 0 && `(${peers.length})`}
      </h3>
      {peers.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No other machines found on this network yet.
        </p>
      ) : (
        <ul className="mb-3 flex flex-col gap-1">
          {peers.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-neutral-800 px-3 py-2 text-sm"
            >
              <span>
                {p.deviceName}{" "}
                <span className="text-neutral-500">
                  {p.ip}:{p.port} · {p.source}
                </span>
              </span>
              {p.source === "manual" && (
                <button
                  type="button"
                  onClick={() => handleRemovePeer(p.id)}
                  className="text-neutral-500 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 rounded-lg bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-600"
          placeholder="Add a peer by IP address (across subnets, if auto-discovery can't reach it)"
          value={peerIp}
          onChange={(e) => setPeerIp(e.target.value)}
        />
        <button
          type="button"
          onClick={handleAddPeer}
          disabled={busy || !peerIp.trim()}
          className="rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </section>
  );
}

// --- Backup & Restore ------------------------------------------------------

function BackupCard() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/settings/firebase-config")
      .then((r) => r.json())
      .then((d) => setConfigured(d.configured))
      .catch(() => setConfigured(false));
  }, []);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const blob = await exportBackup();
      const backup = await buildBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendms-backup-${backup.exportedAt.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage("Backup downloaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportFile(file: File) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text) as BackupFile;
      const validationError = validateBackupFile(data);
      if (validationError) throw new Error(validationError);
      if (
        !confirm(
          "This replaces ALL local data on this device with the backup's contents. This cannot be undone. Continue?"
        )
      ) {
        setBusy(false);
        return;
      }
      const counts = await restoreBackup(data);
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
      setMessage(`Restored ${total} records. Reload the app to see them everywhere.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetLocalStorage() {
    const warning = configured
      ? "This clears ALL local data on this device. It can likely be recovered from the connected Firebase project on the next sync, but anything created on this device since its last successful sync will be lost for good."
      : "This clears ALL local data on this device PERMANENTLY. No Firebase project is connected, so there is no cloud copy to recover from — export a backup first if you want to keep this data.";
    if (!confirm(`${warning}\n\nAre you sure?`)) return;

    setBusy(true);
    try {
      for (const table of SYNCED_TABLES) {
        await db[table].clear();
      }
      setMessage("Local storage cleared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl bg-neutral-900 p-4">
      <h2 className="mb-1 font-medium">Backup &amp; Restore</h2>
      <p className="mb-3 text-sm text-neutral-400">
        A full export of everything on this device — move an install to new hardware, or recover
        after a wipe.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
        >
          <Download className="h-4 w-4" /> Export backup
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" /> Restore from backup
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={handleResetLocalStorage}
          disabled={busy}
          className="ml-auto flex items-center gap-2 rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-400 hover:bg-red-950/60 disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" /> Reset local storage
        </button>
      </div>

      {configured === false && (
        <p className="mt-3 flex items-start gap-1.5 text-sm text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> No Firebase project connected
          — this device is the only copy of this data. Export a backup regularly.
        </p>
      )}
      {message && <p className="mt-3 text-sm text-emerald-400">{message}</p>}
      {error && <p className="mt-3 text-sm font-medium text-red-400">{error}</p>}
    </section>
  );
}
