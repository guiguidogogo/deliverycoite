// Legacy cleanup worker. HubRegional does not use an offline cache here because
// old precached bundles caused stale API calls on mobile browsers.
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await self.registration.unregister();
    for (const client of clients) {
      client.navigate(client.url);
    }
  })());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
