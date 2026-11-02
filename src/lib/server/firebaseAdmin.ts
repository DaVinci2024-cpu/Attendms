// The Admin SDK authenticates with a service account and bypasses Firestore
// security rules by design — this (the local Next.js server, reached only
// via Electron's own loaded-from-localhost window) is now the ONLY code
// path allowed to read/write Firestore. The browser/renderer never talks to
// Firestore directly anymore (contrast firebase.ts, still used by the
// Netlify PWA branch, where the browser *is* the Firestore client and
// everything hangs on security rules instead).
//
// Initialization is lazy via a Proxy: importing this module never throws,
// so the server (and a business that hasn't connected Firebase yet) keeps
// working — only code paths that actually touch `db`/`authAdmin` fail, and
// every API route that does already wraps the call in isFirebaseConfigured()
// or a try/catch that turns it into a clean JSON error instead of a 500.
//
// Ported structurally from retailrp/src/lib/firebase-admin.ts.
import "server-only";
import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";
import { readStoredFirebaseConfig } from "./firebaseConfigStore";

interface ResolvedConfig {
  serviceAccount: Record<string, string>;
  firestoreDatabaseId: string;
}

let app: App | null = null;
let firestore: Firestore | null = null;
let authAdminInstance: Auth | null = null;
let initError: Error | null = null;

// The stored-per-install config (Settings > Cloud Sync) is the real path.
// The two env vars below exist purely so this is testable/runnable without
// going through the Settings UI first (e.g. this repo's own CI/dev use) —
// they are not a "legacy deployment" path the way retailrp's were, since
// Attendms has no prior desktop release to stay compatible with.
function resolveConfig(): ResolvedConfig {
  const stored = readStoredFirebaseConfig();
  if (stored) {
    return {
      serviceAccount: stored.serviceAccount as Record<string, string>,
      firestoreDatabaseId: stored.firestoreDatabaseId || "(default)",
    };
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    return {
      serviceAccount: JSON.parse(raw),
      firestoreDatabaseId: process.env.FIREBASE_FIRESTORE_DATABASE_ID || "(default)",
    };
  }

  throw new Error(
    "Firebase is not configured for this installation yet. Go to System > Cloud Sync to connect " +
      "this install to your own Firebase project. The app still runs fully offline without it — only " +
      "cloud sync, LAN pairing by Firebase project, and portal sign-in are unavailable until it's set up."
  );
}

function init(): App {
  if (app) return app;
  if (initError) throw initError;
  try {
    const { serviceAccount } = resolveConfig();
    app =
      getApps().length === 0
        ? initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
        : getApps()[0];
    return app;
  } catch (err) {
    initError = err instanceof Error ? err : new Error(String(err));
    throw initError;
  }
}

function initFirestore(): Firestore {
  if (firestore) return firestore;
  const { firestoreDatabaseId } = resolveConfig();
  firestore = getFirestore(init(), firestoreDatabaseId);
  return firestore;
}

function initAuth(): Auth {
  if (authAdminInstance) return authAdminInstance;
  authAdminInstance = getAuth(init());
  return authAdminInstance;
}

export function isFirebaseConfigured(): boolean {
  if (readStoredFirebaseConfig()) return true;
  return !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
}

// Safe to show in the UI — the project id, never the private key. Returns
// null without throwing if nothing is configured yet.
export function getConfiguredProjectId(): string | null {
  try {
    return resolveConfig().serviceAccount.project_id || null;
  } catch {
    return null;
  }
}

export const db: Firestore = new Proxy({} as Firestore, {
  get(_target, prop) {
    const instance = initFirestore();
    const value = Reflect.get(instance as unknown as object, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export const authAdmin: Auth = new Proxy({} as Auth, {
  get(_target, prop) {
    const instance = initAuth();
    const value = Reflect.get(instance as unknown as object, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
