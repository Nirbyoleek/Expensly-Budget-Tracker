/* Expensly service worker: shows reminders. Pushes arrive empty; the messages are fetched with
   the signed-in cookie so nothing personal travels through the push service. */
const STATIC = "expensly-static-v1";
const PAGES = "expensly-pages-v1";
// Pages kept for offline use. Only the main tabs, and only after you've opened them signed in.
const APP_PAGES = ["/home", "/activity", "/budgets", "/insights", "/wealth"];
// Registered as /sw.js?dev by `next dev`, whose build files keep the same names between builds:
// caching them would mix old chunks with a new runtime ("originalFactory.call" errors).
const DEV = /[?&]dev(&|=|$)/.test((self.location && self.location.search) || "");

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(["/offline", "/icons/icon-192.png"])).catch(() => undefined).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("expensly-") && ((k !== STATIC && k !== PAGES) || (DEV && k === STATIC))) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener("message", (e) => {
  if (e.data === "clear-pages") e.waitUntil(caches.delete(PAGES));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Build files never change once published (their names carry a hash): cache first.
  if (DEV && url.pathname.startsWith("/_next/")) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.open(STATIC).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Page loads: always the network when there is one; the last copy (or an offline page) when not.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const path = new URL(res.url || req.url).pathname;
        if (path === "/login") await caches.delete(PAGES);
        else if (res.ok && !res.redirected && APP_PAGES.includes(url.pathname) && !url.search) (await caches.open(PAGES)).put(url.pathname, res.clone());
        return res;
      } catch (_) {
        const cached = APP_PAGES.includes(url.pathname) ? await (await caches.open(PAGES)).match(url.pathname) : null;
        return cached || (await caches.match("/offline")) || new Response("You're offline.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    })());
  }
});

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
