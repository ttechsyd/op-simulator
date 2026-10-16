// card art comes from optcgapi; keep every face we've shown so the game works offline
const CACHE = "card-art-v1";
// bump when the fetch logic changes so phones pick up the new worker

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  if (!url.includes("/Card_Images/") && !url.includes("/images/cardlist/card/")) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(url);
      if (hit) return hit;
      // only the app's own validated downloads write the cache: a cross-origin image fetched
      // here is opaque, and a throttled error page looks exactly like a card face
      return fetch(e.request);
    }),
  );
});
