import { getPeers, addManualPeer } from "@/lib/server/lanDiscovery";

export async function GET() {
  return Response.json({ peers: getPeers() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const ip = body?.ip as string | undefined;
  if (!ip) return Response.json({ error: "IP address is required" }, { status: 400 });
  const peer = addManualPeer(ip, Number(body?.port) || 3000);
  return Response.json({ peer });
}
