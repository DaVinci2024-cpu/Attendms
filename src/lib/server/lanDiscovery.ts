// Lets kiosk/admin machines on the same WiFi/Ethernet find each other
// automatically, entirely offline — no internet, no cloud. Each instance
// periodically broadcasts a small UDP announcement; any other instance
// listening picks it up and adds it to a peers list that the lan API
// routes then sync with directly (see lanGossip.ts).
//
// Scoped to a business id, deliberately independent of Firebase, so this
// works identically whether or not this install has connected a Firebase
// project yet, and so two unrelated clinics on the same shared network (a
// mall's public WiFi, a shared office building) never see or sync with
// each other's attendance data even if neither has Firebase configured.
//
// Ported from retailrp/src/lib/lanDiscovery.ts.
import "server-only";
import dgram from "dgram";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { getStateHome } from "./stateHome";
import { getConfiguredProjectId } from "./firebaseAdmin";

const UDP_PORT = 48990;
const ANNOUNCE_INTERVAL_MS = 5000;
const PEER_EXPIRY_MS = 20000;
const STATE_DIR = path.join(getStateHome(), ".attendms");
const DEVICE_ID_FILE = path.join(STATE_DIR, "device-id");
const BUSINESS_ID_FILE = path.join(STATE_DIR, "business-id");
const MANUAL_PEERS_FILE = path.join(STATE_DIR, "lan-peers-manual.json");

export interface Peer {
  id: string;
  ip: string;
  port: number;
  deviceName: string;
  source: "auto" | "manual";
  lastSeen: number;
}

const peers = new Map<string, Peer>();
let deviceId = "";
let businessId = "";
let socket: dgram.Socket | null = null;
let started = false;

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function getDeviceId(): string {
  if (deviceId) return deviceId;
  try {
    deviceId = fs.readFileSync(DEVICE_ID_FILE, "utf8").trim();
    if (deviceId) return deviceId;
  } catch {
    // fall through to generate one
  }
  deviceId = randomUUID();
  ensureStateDir();
  fs.writeFileSync(DEVICE_ID_FILE, deviceId);
  return deviceId;
}

// Prefers the configured Firebase project id — every machine at one
// business gets pointed at the same project during setup, so this
// naturally matches across that business's own machines with no extra
// pairing step, while correctly differing from an unrelated business's own
// project. An install running fully offline (no Firebase at all) has no
// such shared anchor, so each of its machines gets its own random,
// persisted id instead — auto-discovery over broadcast won't pair those
// automatically, but a manually-entered pairing code (setStoredBusinessId)
// connects them directly regardless, same as it does across subnets where
// broadcast doesn't reach at all.
function getBusinessId(): string {
  const configured = getConfiguredProjectId();
  if (configured) return configured;

  if (businessId) return businessId;
  try {
    businessId = fs.readFileSync(BUSINESS_ID_FILE, "utf8").trim();
    if (businessId) return businessId;
  } catch {
    // fall through to generate one
  }
  businessId = randomUUID();
  ensureStateDir();
  fs.writeFileSync(BUSINESS_ID_FILE, businessId);
  return businessId;
}

// For an install with no Firebase project connected, two machines have no
// shared anchor to auto-match on. This lets an admin read the pairing code
// off one machine (System > Local Network) and type it into the other,
// making them agree on purpose. A no-op once Firebase is connected, since
// getBusinessId() prefers the project id over this file either way.
export function setStoredBusinessId(id: string) {
  const trimmed = id.trim();
  if (!trimmed) throw new Error("Pairing code cannot be empty");
  ensureStateDir();
  fs.writeFileSync(BUSINESS_ID_FILE, trimmed);
  businessId = trimmed;
}

export function getLanSelfInfo() {
  const nets = os.networkInterfaces();
  const addresses: string[] = [];
  for (const iface of Object.values(nets)) {
    for (const addr of iface || []) {
      if (addr.family === "IPv4" && !addr.internal) addresses.push(addr.address);
    }
  }
  return {
    deviceName: os.hostname(),
    addresses,
    port: Number(process.env.PORT) || 3000,
    businessId: getBusinessId(),
    businessIdSource: getConfiguredProjectId() ? ("firebase" as const) : ("manual" as const),
  };
}

function loadManualPeers(): Peer[] {
  try {
    return JSON.parse(fs.readFileSync(MANUAL_PEERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveManualPeers() {
  ensureStateDir();
  const manual = Array.from(peers.values()).filter((p) => p.source === "manual");
  fs.writeFileSync(MANUAL_PEERS_FILE, JSON.stringify(manual));
}

export function addManualPeer(ip: string, port: number): Peer {
  const id = `manual-${ip}-${port}`;
  const peer: Peer = { id, ip, port, deviceName: ip, source: "manual", lastSeen: Date.now() };
  peers.set(id, peer);
  saveManualPeers();
  return peer;
}

export function removePeer(id: string): boolean {
  const existed = peers.delete(id);
  saveManualPeers();
  return existed;
}

export function getPeers(): Peer[] {
  const now = Date.now();
  for (const [id, peer] of peers) {
    if (peer.source === "auto" && now - peer.lastSeen > PEER_EXPIRY_MS) {
      peers.delete(id);
    }
  }
  return Array.from(peers.values());
}

export function startDiscovery(httpPort: number) {
  if (started) return;
  started = true;

  const selfId = getDeviceId();
  const ownBusinessId = getBusinessId();
  const deviceName = os.hostname();

  for (const manual of loadManualPeers()) peers.set(manual.id, manual);

  socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("message", (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type !== "attendms-announce") return;
      if (data.businessId !== ownBusinessId) return; // different business entirely
      if (data.deviceId === selfId) return; // our own announcement looping back

      peers.set(data.deviceId, {
        id: data.deviceId,
        ip: rinfo.address,
        port: data.httpPort,
        deviceName: data.deviceName,
        source: "auto",
        lastSeen: Date.now(),
      });
    } catch {
      // not our packet format — ignore
    }
  });

  socket.on("error", (err) => {
    console.warn("[lan-discovery] socket error (ignored, discovery just stays off):", err.message);
  });

  socket.bind(UDP_PORT, () => {
    socket?.setBroadcast(true);
  });

  const announce = () => {
    if (!socket) return;
    const payload = JSON.stringify({
      type: "attendms-announce",
      deviceId: selfId,
      deviceName,
      httpPort,
      businessId: ownBusinessId,
    });
    const buf = Buffer.from(payload);
    socket.send(buf, 0, buf.length, UDP_PORT, "255.255.255.255", (err) => {
      if (err) console.warn("[lan-discovery] broadcast failed (ignored):", err.message);
    });
  };

  announce();
  setInterval(announce, ANNOUNCE_INTERVAL_MS);
}
