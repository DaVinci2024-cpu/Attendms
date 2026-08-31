// Single real company for now (no multi-tenant auth/claims yet — that's
// still later work if this ever needs to serve more than one company).
// Configure via env vars for your actual deployment; the fallbacks below
// only exist so local dev/build doesn't hard-fail with nothing set.
export const COMPANY_ID = process.env.NEXT_PUBLIC_COMPANY_ID || "company_default";
export const COMPANY_NAME =
  process.env.NEXT_PUBLIC_COMPANY_NAME || "Unnamed Company";
export const ADMIN_EMAIL =
  process.env.NEXT_PUBLIC_ADMIN_EMAIL || "admin@example.com";
export const KIOSK_ID = process.env.NEXT_PUBLIC_KIOSK_ID || "kiosk_lobby_01";

export const CONSENT_POLICY_VERSION = "v2-uganda-dppa-2019";

// Euclidean distance below which a face is considered a candidate match.
// Spec starting point of 0.5; expect to tune per-deployment/lighting.
export const FACE_MATCH_THRESHOLD = 0.5;

// Lockout window after a successful punch, per employee.
export const PUNCH_DEBOUNCE_MS = 5000;

// Wrong PIN attempts allowed for a single face-match candidate before it is
// dropped and logged as suspicious (spec: "not silently retried indefinitely").
export const MAX_PIN_ATTEMPTS = 3;

// How often (ms) the kiosk detection loop runs face detection.
export const DETECTION_INTERVAL_MS = 700;

// Employees don't have real work emails, so the portal login uses a
// synthetic, non-deliverable email under this fake domain — Firebase Auth
// requires an email-shaped identifier even though nothing is ever sent to
// it. The employee-facing "username" is portalUsername, not this.
export function portalEmail(employeeId: string): string {
  return `${employeeId}@${COMPANY_ID}.attendms.local`;
}
