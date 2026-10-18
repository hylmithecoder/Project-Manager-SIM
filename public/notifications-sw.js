/* Notifications only: no offline cache or fetch interception. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL(event.notification.data?.url || "/", self.location.origin);
    if (url.origin !== self.location.origin || url.pathname !== "/") return;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== url.origin) continue;
      await client.navigate(url.href);
      await client.focus();
      return;
    }
    await self.clients.openWindow(url.href);
  })());
});
