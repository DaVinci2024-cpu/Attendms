// Minimal hand-written service worker (no Workbox/next-pwa) so the kiosk's
// own app shell survives a cold load with zero network — Firestore's own
// persistence (src/lib/firebase.ts) already handles offline data/writes;
// this is the other half: can the page itself even open.
//
// Bump this on every deploy that should invalidate old cached pages/assets.
const CACHE_NAME = "attendms-shell-v4";

// Precached at install time — not left to happen opportunistically the
// first time someone visits "/" — so the kiosk shell is guaranteed to be
// answerable offline the moment this service worker has installed once,
// rather than depending on exactly which page a past visit happened to
// load. Without this, a request the runtime cache below never happened to
// see falls through to the browser's own "you're offline" page instead of
// this app, which is indistinguishable from the app itself being broken.
const PRECACHE_URLS = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
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
            // ignoreSearch so a shortcut/bookmark that adds a query string
            // (e.g. a desktop "install" shortcut) still finds the precached
            // root instead of falling through to the browser's own offline
            // page.
            (await caches.match("/", { ignoreSearch: true })) ||
            Response.error()
        )
    );
  }
});
