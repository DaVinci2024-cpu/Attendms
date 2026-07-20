// Phase 0 prototype: a single hardcoded "demo company" stands in for real
// multi-tenant company documents (see spec section on Build order).
export const DEMO_COMPANY_ID = "demo_company";
export const DEMO_COMPANY_NAME = "Demo Company";
export const DEMO_ADMIN_EMAIL = "admin@demo.local";
export const DEMO_KIOSK_ID = "kiosk_demo_01";

export const CONSENT_POLICY_VERSION = "v1";

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
