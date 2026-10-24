import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/** Runs public/sw.js in a sandbox with a fake service-worker environment. */
function loadWorker(fetchImpl: (url: string) => Promise<Response>) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; options: { body: string; tag: string; data: { url: string } } }[] = [];
  const opened: string[] = [];
  const self = {
    addEventListener: (t: string, h: (e: unknown) => void) => { handlers[t] = h; },
    skipWaiting: vi.fn(),
    registration: { showNotification: vi.fn(async (title: string, options: never) => { shown.push({ title, options }); }) },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => []), openWindow: vi.fn(async (u: string) => { opened.push(u); }) },
  };
  const code = readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8");
  vm.runInNewContext(code, { self, fetch: fetchImpl, Promise });
  const fire = async (type: string, extra: object = {}) => {
    let done: Promise<unknown> = Promise.resolve();
    handlers[type]({ waitUntil: (p: Promise<unknown>) => { done = p; }, ...extra });
    await done;
  };
  return { fire, shown, opened, self };
}

describe("service worker", () => {
  it("fetches the waiting messages with the user's login and shows them", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ items: [{ key: "budget80:food", title: "80% of Food used", body: "₹2,000 left", url: "/budgets" }] })));
    const w = loadWorker(fetch);
    await w.fire("push");
    expect(fetch).toHaveBeenCalledWith("/api/notifications/pending", expect.objectContaining({ credentials: "include" }));
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]).toMatchObject({ title: "80% of Food used", options: { body: "₹2,000 left", tag: "budget80:food", data: { url: "/budgets" } } });
  });

  it("always shows something, because iPhone requires a notification for every push", async () => {
    const w = loadWorker(async () => { throw new Error("offline"); });
    await w.fire("push");
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe("Expensly");
  });

  it("shows at most three at once", async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, title: `T${i}`, body: "b", url: "/home" }));
    const w = loadWorker(async () => new Response(JSON.stringify({ items })));
    await w.fire("push");
    expect(w.shown).toHaveLength(3);
  });

  it("opens the reminder's page when tapped", async () => {
    const w = loadWorker(async () => new Response("{}"));
    const close = vi.fn();
    await w.fire("notificationclick", { notification: { close, data: { url: "/wealth#recurring" } } });
    expect(close).toHaveBeenCalled();
    expect(w.opened).toEqual(["/wealth#recurring"]);
  });
});

describe("service worker: offline", () => {
  function offlineWorker(network: (req: { url: string; mode?: string }) => Promise<Response>) {
    const stores = new Map<string, Map<string, Response>>();
    const open = async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      const key = (r: string | { url: string }) => new URL(typeof r === "string" ? r : r.url, "https://app.test").pathname;
      return { match: async (r: string | { url: string }) => m.get(key(r))?.clone(), put: async (r: string | { url: string }, res: Response) => { m.set(key(r), res); }, addAll: async (urls: string[]) => { for (const u of urls) m.set(u, new Response(`cached ${u}`)); } };
    };
    const caches = {
      open,
      delete: async (n: string) => stores.delete(n),
      keys: async () => [...stores.keys()],
      match: async (u: string) => { for (const m of stores.values()) if (m.has(u)) return m.get(u)!.clone(); return undefined; },
    };
    const handlers: Record<string, (e: unknown) => void> = {};
    const self = { addEventListener: (t: string, h: (e: unknown) => void) => { handlers[t] = h; }, skipWaiting: vi.fn(), clients: { claim: vi.fn() }, location: { origin: "https://app.test" }, registration: {} };
    vm.runInNewContext(readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8"), { self, fetch: network, caches, URL, Response, Promise });
    const request = async (url: string, mode = "navigate", method = "GET") => {
      let res: Promise<Response> | undefined;
      handlers.fetch({ request: { url: `https://app.test${url}`, mode, method }, respondWith: (p: Promise<Response>) => { res = p; } });
      return res ? await res : undefined;
    };
    const install = async () => { let p: Promise<unknown> = Promise.resolve(); handlers.install({ waitUntil: (x: Promise<unknown>) => { p = x; } }); await p; };
    const message = async (data: string) => { let p: Promise<unknown> = Promise.resolve(); handlers.message({ data, waitUntil: (x: Promise<unknown>) => { p = x; } }); await p; };
    return { request, install, message, stores };
  }

  it("serves the last copy of a tab when the network is gone, and the offline page otherwise", async () => {
    let online = true;
    const w = offlineWorker(async (req) => { if (!online) throw new TypeError("Failed to fetch"); return new Response(`fresh ${new URL(req.url).pathname}`); });
    await w.install();
    expect(await (await w.request("/home"))!.text()).toBe("fresh /home");
    online = false;
    expect(await (await w.request("/home"))!.text()).toBe("fresh /home");
    expect(await (await w.request("/settings"))!.text()).toBe("cached /offline");
  });

  it("leaves API calls, posts and other sites alone", async () => {
    const w = offlineWorker(async () => new Response("x"));
    expect(await w.request("/api/export", "cors")).toBeUndefined();
    expect(await w.request("/home", "navigate", "POST")).toBeUndefined();
  });

  it("forgets saved pages when you sign out", async () => {
    const w = offlineWorker(async (req) => new Response(`fresh ${new URL(req.url).pathname}`));
    await w.request("/activity");
    expect(w.stores.get("expensly-pages-v1")?.size).toBe(1);
    await w.message("clear-pages");
    expect(w.stores.has("expensly-pages-v1")).toBe(false);
  });
});
