// sw.js — minimal offline cache for the app shell (not the CDN libs)
//
// IMPORTANT: skipWaiting + clients.claim() + stale-cache cleanup are
// required here. Without them, once a service worker has installed on a
// device, pushing fixed files to GitHub Pages does NOT reach that device
// until every tab is fully closed — the old SW keeps serving its old
// cached copies of index.html/app.js/etc forever. That caused a real
// "fix shipped but the user's phone still runs the broken version" bug.
const CACHE = "read-to-me-v4";
const ASSETS = ["./", "index.html", "style.css", "db.js", "parsers.js", "reader.js", "app.js", "manifest.json", "icon.svg"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Network-first for our own app files, so fixes always reach the
  // device on the next reload; fall back to cache only when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
