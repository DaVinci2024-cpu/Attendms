// Deliberately NOT behind requireAuth: on a business's very first setup,
// nobody has a Firebase-backed session yet at all (there's no Firebase
// project connected to sign in against until this very endpoint connects
// one) — the same chicken-and-egg retailrp's equivalent route avoids the
// same way. Anyone able to reach this already has filesystem/physical
// access to this machine (it only listens on localhost — see
// electron/main.cjs), so there's nothing this endpoint protects that
// local access doesn't already grant — see src/app/system/page.tsx's own
// top comment for why that page is reachable with no sign-in too.
import {
  isFirebaseConfigured,
  getConfiguredProjectId,
} from "@/lib/server/firebaseAdmin";
import {
  saveFirebaseConfig,
  clearFirebaseConfig,
  validateServiceAccount,
  validateWebConfig,
  readStoredFirebaseConfig,
} from "@/lib/server/firebaseConfigStore";

// Must match the exit code electron/main.cjs checks for on the spawned
// server process — that specific code means "config changed on purpose,
// relaunch me", not "the server crashed" (which shows an error dialog
// instead). Firebase Admin's connection is cached for the life of this
// process (see firebaseAdmin.ts), so there's no clean way to swap it out
// live without risking an in-flight Firestore call running against
// half-old state — a fresh process is the simplest correct fix.
const RESTART_EXIT_CODE = 42;

export async function GET() {
  return Response.json({
    configured: isFirebaseConfigured(),
    projectId: getConfiguredProjectId(),
    hasWebConfig: !!readStoredFirebaseConfig()?.webConfig,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { serviceAccount, firestoreDatabaseId, webConfig } = body ?? {};

  const serviceAccountError = validateServiceAccount(serviceAccount);
  if (serviceAccountError) return Response.json({ error: serviceAccountError }, { status: 400 });

  // Required the first time this install connects a project — without it,
  // Firebase Auth's client SDK (RequireAdmin.tsx, portal sign-in) has
  // nothing to initialize with and nobody could ever sign in. A later
  // reconnect (e.g. just rotating the service account) may omit it, in
  // which case whatever web config is already stored is kept as-is.
  const existing = readStoredFirebaseConfig();
  if (!webConfig && !existing?.webConfig) {
    return Response.json(
      { error: "The Firebase web app config (apiKey, authDomain, ...) is required." },
      { status: 400 }
    );
  }
  if (webConfig) {
    const webConfigError = validateWebConfig(webConfig);
    if (webConfigError) return Response.json({ error: webConfigError }, { status: 400 });
  }

  try {
    saveFirebaseConfig({
      serviceAccount,
      firestoreDatabaseId,
      webConfig: webConfig ?? existing?.webConfig,
    });
  } catch (err) {
    return Response.json(
      {
        error: "Could not save the Firebase configuration",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }

  // Respond first, then exit — the client needs to see success before the
  // server (and the Electron window with it) goes away to restart.
  setTimeout(() => process.exit(RESTART_EXIT_CODE), 200);
  return Response.json({ success: true, projectId: serviceAccount.project_id, restarting: true });
}

export async function DELETE() {
  clearFirebaseConfig();
  setTimeout(() => process.exit(RESTART_EXIT_CODE), 200);
  return Response.json({ success: true, restarting: true });
}
