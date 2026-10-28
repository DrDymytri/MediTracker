// Caches the app shell so MediTrack opens offline. Health records are never cached here;
// they live in IndexedDB. Cross-origin requests (USDA food search) always go to the network.
const CACHE = "meditrack-v1";
// Works at the site root or under a sub-path such as /MediTrack/.
const ROOT = self.registration.scope;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([ROOT])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Network first for pages so new deployments show up; cache is the offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(ROOT, copy)); return response; })
        .catch(() => caches.match(ROOT)),
    );
    return;
  }

  // Cache first for hashed static assets, filled on first use.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); }
      return response;
    })),
  );
});
