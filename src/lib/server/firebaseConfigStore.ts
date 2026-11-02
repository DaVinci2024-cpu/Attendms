// Where THIS installation's own Firebase project credentials live —
// separate from the app's install folder on purpose. Every kiosk/admin
// machine runs the exact same installer; what must differ per business is
// which Firebase project its data goes to. Baking one business's service
// account into the installer would mean every install shares one Firestore
// project, so a second hospital/clinic's attendance data would land in the
// first one's database. Storing it here instead — written by that
// business's own admin from Settings > Cloud Sync, after installing — is
// what makes each install its own isolated business. Also what makes an
// in-place app update safe: the installer only ever touches the app's own
// folder, never this one, so an update can never wipe a business's
// connection to its own data.
//
// Ported structurally from retailrp/src/lib/firebaseConfigStore.ts.
import "server-only";
import fs from "fs";
import path from "path";
import { getStateHome } from "./stateHome";

const STATE_DIR = path.join(getStateHome(), ".attendms");
const CONFIG_FILE = path.join(STATE_DIR, "firebase-service-account.json");

// The public web config (apiKey, authDomain, ...) Firebase Auth's client
// SDK needs to sign in — a completely different, non-secret credential from
// the service account above (which firebase-admin uses server-side). Every
// Firebase project has one; Firebase console -> Project settings -> Your
// apps -> SDK setup and configuration shows it as a ready-to-copy object.
// Without this, RequireAdmin.tsx/portal sign-in has nothing to initialize
// Firebase Auth with — see the note on getStoredWebConfig below for why
// this matters even before a service account is ever connected.
export interface StoredWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

export interface StoredFirebaseConfig {
  serviceAccount: Record<string, unknown>;
  firestoreDatabaseId?: string;
  webConfig?: StoredWebConfig;
}

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

export function readStoredFirebaseConfig(): StoredFirebaseConfig | null {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Only the handful of fields Firestore actually needs to connect — this is
// deliberately not a full schema validator. A service account JSON with
// these present is real; anything else pasted in here (an empty file, the
// wrong kind of Firebase config, random JSON) is caught before it's
// written to disk at all.
export function validateServiceAccount(serviceAccount: unknown): string | null {
  if (!serviceAccount || typeof serviceAccount !== "object") return "Not a valid JSON object";
  const sa = serviceAccount as Record<string, unknown>;
  if (sa.type !== "service_account") {
    return 'This doesn\'t look like a Firebase service account file (missing "type": "service_account")';
  }
  if (!sa.project_id) return "Missing project_id";
  if (!sa.private_key) return "Missing private_key";
  if (!sa.client_email) return "Missing client_email";
  return null;
}

export function validateWebConfig(webConfig: unknown): string | null {
  if (!webConfig || typeof webConfig !== "object") return "Not a valid JSON object";
  const wc = webConfig as Record<string, unknown>;
  if (!wc.apiKey) return "Missing apiKey";
  if (!wc.authDomain) return "Missing authDomain";
  if (!wc.projectId) return "Missing projectId";
  return null;
}

// Read by the public /api/settings/firebase-web-config route, which the
// root layout embeds into every page server-side (see src/app/layout.tsx)
// so Firebase Auth's client SDK has something to initialize with on first
// paint, with no async race against RequireAdmin's own effect. Safe to
// expose with no auth check: a web config's fields are meant to ship inside
// a public client bundle by design, same as the old NEXT_PUBLIC_FIREBASE_*
// build-time env vars this replaces — nothing here is a secret the way the
// service account's private_key is.
export function getStoredWebConfig(): StoredWebConfig | null {
  return readStoredFirebaseConfig()?.webConfig ?? null;
}

export function saveFirebaseConfig(config: StoredFirebaseConfig) {
  ensureStateDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function clearFirebaseConfig() {
  try {
    fs.unlinkSync(CONFIG_FILE);
  } catch {
    // already gone — fine
  }
}
