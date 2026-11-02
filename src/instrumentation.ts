// Runs once when the Node.js server process starts (Next's instrumentation
// hook — stable since Next 15, no config flag needed). This is where the
// LAN discovery UDP listener/broadcaster and the LAN gossip interval get
// started, matching retailrp's server.ts calling startDiscovery(PORT) and
// startLanGossip() once at the top of its own startServer(). Guarded so it
// only runs for the actual Node server runtime, never the edge runtime
// (which this app never uses, but Next calls register() for both if
// configured for both).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startDiscovery } = await import("@/lib/server/lanDiscovery");
  const { startLanGossip } = await import("@/lib/server/lanGossip");

  const port = Number(process.env.PORT) || 3000;
  startDiscovery(port);
  startLanGossip();
}
