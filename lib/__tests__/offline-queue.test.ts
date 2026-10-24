import { describe, expect, it, vi } from "vitest";
import { enqueue, flush, isOfflineError, pendingCount, type QueuedRow } from "../offline-queue";

function memoryStore(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); }, clear: () => m.clear(), key: () => null, get length() { return m.size; } };
}
const row = (name: string): QueuedRow => ({ date: "2026-10-22", amount_paise: -2000, merchant_name: name, merchant_raw: null, category_id: "food", subcategory_id: null, source: "manual", reviewed: true });

describe("offline quick-add queue", () => {
  it("keeps entries until they're sent, oldest first", async () => {
    const s = memoryStore();
    enqueue([row("Chai")], s);
    enqueue([row("Auto"), row("Lunch")], s);
    expect(pendingCount(s)).toBe(3);
    const send = vi.fn(async (rows: QueuedRow[]) => ({ ok: true, added: rows.length }));
    expect(await flush(send, s)).toEqual({ added: 3, failed: 0, left: 0 });
    expect(send.mock.calls.map((c) => c[0].map((r) => r.merchant_name))).toEqual([["Chai"], ["Auto", "Lunch"]]);
  });

  it("stops at a network error and keeps the rest for next time", async () => {
    const s = memoryStore();
    enqueue([row("A")], s); enqueue([row("B")], s);
    const send = vi.fn().mockResolvedValueOnce({ ok: true, added: 1 }).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await flush(send, s)).toEqual({ added: 1, failed: 0, left: 1 });
  });

  it("drops an entry the server refuses, so it can't block the queue", async () => {
    const s = memoryStore();
    enqueue([row("Bad")], s); enqueue([row("Good")], s);
    const send = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, added: 1 });
    expect(await flush(send, s)).toEqual({ added: 1, failed: 1, left: 0 });
  });

  it("ignores empty or corrupt storage", async () => {
    const s = memoryStore();
    expect(enqueue([], s)).toBe(false);
    s.setItem("expensly.offline-queue.v1", "{not json");
    expect(pendingCount(s)).toBe(0);
    expect(pendingCount(undefined)).toBe(0);
  });

  it("tells a dropped connection from a server error", () => {
    expect(isOfflineError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isOfflineError(new Error("Load failed"))).toBe(true);
    expect(isOfflineError(new Error("Amount must be positive"))).toBe(false);
  });
});
