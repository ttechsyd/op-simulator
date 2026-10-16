// card art comes from optcgapi; keep every face we've shown so the game works offline
const CACHE = "card-art-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  if (!url.includes("/Card_Images/")) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(url);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === "opaque") cache.put(url, res.clone());
      return res;
    }),
  );
});
