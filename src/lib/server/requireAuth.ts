// Server-side identity + permission resolution for the local API routes
// (src/app/api/**) — the equivalent of retailrp's middleware/auth.ts, but
// verifying a real Firebase ID token instead of a self-issued JWT.
//
// Why a Firebase ID token and not retailrp's own bcrypt+JWT system: Attendms
// already has a complete, working Firebase-Auth-based identity layer
// (RequireAdmin.tsx, the employee portal, permission grants keyed by
// Firebase Auth uid) that the PWA branch has used all along. Rebuilding
// that as a separate local username/password system here would duplicate
// it, not replace it, and would mean migrating every employee's existing
// portal password into a new scheme for no real gain. Instead, the
// browser/renderer keeps signing in through Firebase Auth exactly as
// before (RequireAdmin.tsx is unchanged) and sends its ID token on every
// local API request; this file verifies that token and re-derives the same
// admin/permission-grant/shift-supervisor-grant logic firestore.rules used
// to enforce, now in server code instead of security rules — because
// firebase-admin bypasses rules entirely by design (see firebaseAdmin.ts),
// something has to enforce it from here on.
//
// firebase-admin's verifyIdToken() checks the token's signature against
// Google's public certs (cached after the first fetch) and its expiry —
// both fully local after that first fetch, so this keeps working across a
// kiosk's offline stretches for any token minted before it went offline.
import "server-only";
import { authAdmin, db, isFirebaseConfigured } from "./firebaseAdmin";
import type { Permission } from "@/lib/types";

export interface AccessContext {
  uid: string;
  email: string | null;
  isAdmin: boolean;
  permissions: Set<Permission>;
}

async function resolvePermissions(uid: string, isAdmin: boolean): Promise<Set<Permission>> {
  if (isAdmin) return new Set<Permission>();
  const permissions = new Set<Permission>();
  const now = Date.now();

  const grantSnap = await db.collection("permissionGrants").doc(uid).get();
  if (grantSnap.exists) {
    const grant = grantSnap.data() as {
      permissions: Permission[];
      startsAtMillis?: number | null;
      expiresAtMillis: number | null;
    };
    const started = grant.startsAtMillis == null || now >= grant.startsAtMillis;
    const notExpired = grant.expiresAtMillis == null || now < grant.expiresAtMillis;
    if (started && notExpired) {
      for (const p of grant.permissions) permissions.add(p);
    }
  }

  const supervisorSnap = await db.collection("shiftSupervisorGrants").doc(uid).get();
  if (supervisorSnap.exists) {
    const grant = supervisorSnap.data() as {
      permissions: Permission[];
      startsAtMillis: number;
      expiresAtMillis: number;
    };
    if (now >= grant.startsAtMillis && now < grant.expiresAtMillis) {
      for (const p of grant.permissions) permissions.add(p);
    }
  }

  return permissions;
}

// Returns null (never throws) when the request isn't authenticated or
// Firebase isn't configured yet — callers decide what that means for them
// (most routes 401; a few, like the kiosk's own unauthenticated punch
// sync, don't call this at all).
export async function resolveAccess(request: Request): Promise<AccessContext | null> {
  if (!isFirebaseConfigured()) return null;

  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;

  try {
    const decoded = await authAdmin.verifyIdToken(token);
    const companySnap = await db.collection("company").limit(1).get();
    const adminUids: string[] = companySnap.empty
      ? []
      : (companySnap.docs[0].data().adminUids ?? []);
    // Bootstrap case: nobody has claimed admin in this Firebase project
    // yet, so any signed-in user is treated as admin for this one-time
    // purpose — exactly the exception the old firestore.rules documented
    // for the company doc's very first write. Without this, the very
    // sync that's supposed to push a fresh install's first
    // ensureAdminBootstrap() write (see dexieRepo.ts) up to Firestore
    // would itself be blocked by the admin-only gate on the "company"
    // table (see ADMIN_ONLY_TABLES in the sync API routes) — a deadlock
    // equivalent to the one retailrp solves with a separate unauthenticated
    // /register endpoint. Attendms doesn't need that separate endpoint:
    // its admin accounts are real Firebase Auth accounts from the start
    // (RequireAdmin.tsx), so this one-line exception on the already-
    // existing sync path is enough.
    const isAdmin = adminUids.length === 0 || adminUids.includes(decoded.uid);
    const permissions = await resolvePermissions(decoded.uid, isAdmin);
    return { uid: decoded.uid, email: decoded.email ?? null, isAdmin, permissions };
  } catch {
    return null;
  }
}

export function hasPermission(access: AccessContext | null, permission: Permission): boolean {
  if (!access) return false;
  return access.isAdmin || access.permissions.has(permission);
}

export function unauthorized(message = "Missing or invalid session"): Response {
  return Response.json({ error: message }, { status: 401 });
}

export function forbidden(message = "Not allowed"): Response {
  return Response.json({ error: message }, { status: 403 });
}
