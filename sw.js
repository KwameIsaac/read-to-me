// sw.js — minimal offline cache for the app shell (not the CDN libs)
const CACHE = "read-to-me-v2";
const ASSETS = ["./", "index.html", "style.css", "db.js", "parsers.js", "reader.js", "app.js", "manifest.json", "icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached))
  );
});
