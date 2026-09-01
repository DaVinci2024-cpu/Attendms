// Minimal hand-written service worker (no Workbox/next-pwa) so the kiosk's
// own app shell survives a cold load with zero network — Firestore's own
// persistence (src/lib/firebase.ts) already handles offline data/writes;
// this is the other half: can the page itself even open.
//
// Bump this on every deploy that should invalidate old cached pages/assets.
const CACHE_NAME = "attendms-shell-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

function isImmutableAsset(url) {
  // /_next/static/* filenames are content-hashed by the build; /models/*
  // are the vendored face-api weight files. Both are safe to cache forever
  // once fetched once.
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/models/");
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // leave Firebase/etc. alone
  if (event.request.method !== "GET") return;

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      })
    );
    return;
  }

  if (event.request.mode === "navigate") {
    // Network-first for pages, so a fresh deploy is picked up whenever
    // there's connectivity; falls back to the last cached copy of that
    // exact page when offline, or the cached "/" as a last resort.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(
          async () =>
            (await caches.match(event.request)) ||
            (await caches.match("/")) ||
            Response.error()
        )
    );
  }
});
