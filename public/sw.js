/* Expensly service worker: shows reminders. Pushes arrive empty; the messages are fetched with
   the signed-in cookie so nothing personal travels through the push service. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let items = [];
    try {
      const res = await fetch("/api/notifications/pending", { credentials: "include", cache: "no-store" });
      if (res.ok) items = (await res.json()).items || [];
    } catch (_) { /* offline: fall through to a generic note */ }
    if (!items.length) items = [{ key: "generic", title: "Expensly", body: "You have a new update.", url: "/home" }];
    // iOS requires a notification for every push, so always show at least one.
    await Promise.all(items.slice(0, 3).map((n) =>
      self.registration.showNotification(n.title, { body: n.body, tag: n.key, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: n.url || "/home" } }),
    ));
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/home";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) { await c.focus(); if ("navigate" in c) await c.navigate(url); return; }
    }
    await self.clients.openWindow(url);
  })());
});
