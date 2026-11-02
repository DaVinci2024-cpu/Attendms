// Public on purpose — see getStoredWebConfig's comment in
// firebaseConfigStore.ts. Kept as its own endpoint (rather than folded into
// /api/settings/firebase-config's response) specifically so it can stay
// unauthenticated while the main status endpoint's sibling POST/DELETE
// don't need to think about that distinction.
import { getStoredWebConfig } from "@/lib/server/firebaseConfigStore";

export async function GET() {
  return Response.json({ webConfig: getStoredWebConfig() });
}
