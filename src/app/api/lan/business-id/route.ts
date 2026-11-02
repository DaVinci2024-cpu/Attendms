import { setStoredBusinessId } from "@/lib/server/lanDiscovery";

// Same RESTART_EXIT_CODE mechanism as /api/settings/firebase-config — the
// running process already has the old business id captured in a closure
// (see lanDiscovery.ts's startDiscovery), so a pairing-code change only
// takes effect cleanly from a fresh process.
const RESTART_EXIT_CODE = 42;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const businessId = body?.businessId as string | undefined;
  if (!businessId) {
    return Response.json({ error: "A pairing code is required" }, { status: 400 });
  }
  try {
    setStoredBusinessId(businessId);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
  setTimeout(() => process.exit(RESTART_EXIT_CODE), 200);
  return Response.json({ success: true, restarting: true });
}
