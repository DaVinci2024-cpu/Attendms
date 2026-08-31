"use client";

import { useEffect } from "react";

/**
 * Caches the app shell (JS/CSS bundles + face-api model files) so the
 * kiosk can still open with zero network — separate from Firestore's own
 * offline persistence, which handles the data/write side. Registration
 * failure (unsupported browser, non-HTTPS context) is non-fatal: the app
 * still works fully online without it.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
