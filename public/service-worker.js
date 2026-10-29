// The Second Renaissance Discourse forum, which used to be served on
// forum.secondrenaissance.net and forum.lifeitself.org, registered a service
// worker at this path. It keeps serving the old forum's cached pages to past
// visitors. Browsers check this file for updates, so this version replaces it:
// it clears the old caches, unregisters itself and reloads open pages, which
// then follow the redirects to this forum. This forum registers no service
// worker of its own.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: "window" });
    windows.forEach((client) => client.navigate(client.url));
  })());
});
