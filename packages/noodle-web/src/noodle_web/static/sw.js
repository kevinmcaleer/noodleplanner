/**
 * NoodlePlanner service worker (issue #809).
 *
 * Exists so the app is installable as a Progressive Web App and opens from
 * its own window like a regular application. It is deliberately conservative
 * about caching, because the plan lives in the page and the app must never
 * show a stale shell after a deployment:
 *
 *   - Same-origin /static/ assets: cache-first. Their URLs carry a per-deploy
 *     ?v= hash, so a cached copy is never out of date, and the whole cache is
 *     dropped when the version below changes.
 *   - Navigations (the app page itself): network-first, falling back to the
 *     last good copy only when the network is unavailable, so the app still
 *     opens offline with the plans held in the browser's storage.
 *   - Everything else (/api/, /render, POSTs, cross-origin CDNs): untouched.
 *
 * `__STATIC_VERSION__` is substituted by the /sw.js route from the same hash
 * the templates use for cache-busting, so every deployment installs a fresh
 * worker and clears the previous cache.
 */
const VERSION = "__STATIC_VERSION__";
const CACHE = "noodleplanner-" + VERSION;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/static/");
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (request.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});
