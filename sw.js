const CACHE_NAME = "qgis2web-sync-v2";
const SHELL_FILES = ["./", "./index.html", "./style.css", "./app.js"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
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

// Netværk først, cache kun som offline-fallback. Cache-først ville betyde at
// en ny udgivelse fra QGIS aldrig nåede frem uden at rydde browserens data.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const kopi = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, kopi));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
