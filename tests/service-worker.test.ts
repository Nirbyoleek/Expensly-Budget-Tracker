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
