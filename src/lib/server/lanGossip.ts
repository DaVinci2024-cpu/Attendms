// Pushes this machine's local-store changes out to every known LAN peer, on
// a timer, entirely independent of internet access — this is what actually
// moves data between machines once lanDiscovery.ts has found them (or a
// peer was added manually). Each peer runs this same loop, sending its own
// changes back the other way, which is what makes the sync bidirectional.
//
// Ported from retailrp/src/lib/lanGossip.ts.
import "server-only";
import { getPeers } from "./lanDiscovery";
import { SYNCED_TABLES } from "@/lib/db";
import { recordsSince } from "./localStore";

const GOSSIP_INTERVAL_MS = 3000;
const EPOCH = new Date(0).toISOString();

// Tracks, per peer, the last point we know they already have our data up
// to — so each tick only sends what's new. Resets on restart, which just
// means the next tick or two re-sends a bit of already-known data;
// harmless, since the receiving side's merge is a no-op for anything it
// already has the same or a newer version of.
const lastSentTo = new Map<string, string>();
let started = false;

async function gossipTick() {
  const peers = getPeers();
  if (peers.length === 0) return;

  for (const peer of peers) {
    const since = lastSentTo.get(peer.id) || EPOCH;
    const changes: Record<string, unknown[]> = {};
    let hasChanges = false;
    let newest = since;

    for (const table of SYNCED_TABLES) {
      const records = recordsSince(table, since);
      if (records.length > 0) {
        changes[table] = records;
        hasChanges = true;
        for (const r of records) {
          const updatedAt = r.updated_at as string;
          if (updatedAt > newest) newest = updatedAt;
        }
      }
    }

    if (!hasChanges) continue;

    try {
      const res = await fetch(`http://${peer.ip}:${peer.port}/api/lan/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) lastSentTo.set(peer.id, newest);
    } catch {
      // Peer went offline/unreachable this tick — retried next tick with
      // the same `since`, nothing lost.
    }
  }
}

export function startLanGossip() {
  if (started) return;
  started = true;
  setInterval(() => {
    gossipTick().catch(() => {});
  }, GOSSIP_INTERVAL_MS);
}
