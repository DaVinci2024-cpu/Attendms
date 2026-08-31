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
    // Registering this during local dev actively fights next dev's hot
    // reload/fast refresh — the service worker's cache-first strategy for
    // /_next/static/* can keep serving an old JS bundle indefinitely even
    // after pulling new code and restarting the dev server, which looks
    // exactly like "my fix isn't taking effect" with no obvious cause.
    // Only register it in production builds.
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
