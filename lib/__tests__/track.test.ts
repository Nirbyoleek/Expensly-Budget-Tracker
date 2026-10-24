import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: (fn: () => unknown) => { void fn(); } }));

import { EVENTS, normalisePath, track, trackAs } from "../track";
import { isTestAccount } from "../test-accounts";

describe("usage analytics", () => {
  it("groups pages and drops anything that isn't an app page", () => {
    expect(normalisePath("/review/2026-09")).toBe("/review/[month]");
    expect(normalisePath("/activity?filter=review")).toBe("/activity");
    expect(normalisePath("/settings/capture/")).toBe("/settings/capture");
    expect(normalisePath("/u/someone@example.com")).toBeNull();
    expect(normalisePath("/totally-unknown")).toBeNull();
    expect(normalisePath("/" + "a".repeat(80))).toBeNull();
  });

  it("writes the event name with trimmed details and never throws", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const db = { from: vi.fn(() => ({ insert })) };
    track(db as never, "budget_set", { custom: true, label: "x".repeat(200) });
    await Promise.resolve();
    expect(db.from).toHaveBeenCalledWith("events");
    const row = (insert.mock.calls[0] as unknown as [{ name: string; props: { label: string } }])[0];
    expect(row.name).toBe("budget_set");
    expect(row.props.label).toHaveLength(60);

    const broken = { from: () => ({ insert: async () => { throw new Error("db down"); } }) };
    expect(() => trackAs(broken as never, null, "account_deleted")).not.toThrow();
  });

  it("only uses names the database accepts", () => {
    for (const e of EVENTS) expect(e).toMatch(/^[a-z0-9_]{2,40}$/);
  });

  it("recognises the automated test accounts and nobody else", () => {
    expect(isTestAccount("e2e-abc123-x9@expensly.test")).toBe(true);
    expect(isTestAccount("E2E-ABC@EXPENSLY.TEST")).toBe(true);
    expect(isTestAccount("nirbyoleek@gmail.com")).toBe(false);
    expect(isTestAccount("e2e-x@expensly.test.evil.com")).toBe(false);
    expect(isTestAccount(null)).toBe(false);
  });
});
