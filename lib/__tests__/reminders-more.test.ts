import { describe, expect, it } from "vitest";
import { remindersFor } from "../reminders";
import { SYSTEM_CATEGORIES as cats } from "../categories";
import { tx } from "../../tests/fixtures";

const prefs = { budget: true, bills: true, weekly: true };
const base = { cats, budgetRows: [], prefs, signedUpDaysAgo: 30 };

describe("reminders: edge cases", () => {
  it("treats sample data as no data, so new users still get their nudge", () => {
    const r = remindersFor({ ...base, today: "2026-10-22", tx: [tx("2026-10-01", -100, "food", { source: "sample" })] });
    expect(r.map((x) => x.key)).toEqual(["nudge:first", "nudge:second"]);
  });

  it("stays quiet on the day you sign up", () => {
    expect(remindersFor({ ...base, today: "2026-10-22", tx: [], signedUpDaysAgo: 0 })).toEqual([]);
  });

  it("doesn't remind about next month's bills on the last day of the month", () => {
    const rent = ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"].map((d) => tx(d, -14000, "bills", { merchant_name: "Landlord Rent" }));
    expect(remindersFor({ ...base, today: "2026-10-31", tx: rent }).some((r) => r.key.startsWith("bill:"))).toBe(false);
  });

  it("doesn't remind about a bill already paid this month", () => {
    const rent = ["2026-08-05", "2026-09-05", "2026-10-04"].map((d) => tx(d, -14000, "bills", { merchant_name: "Landlord Rent" }));
    expect(remindersFor({ ...base, today: "2026-10-04", tx: rent }).some((r) => r.key.startsWith("bill:"))).toBe(false);
  });

  it("uses the right ordinal in bill reminders", () => {
    const sub = ["2026-08-22", "2026-09-22"].map((d) => tx(d, -199, "subs", { merchant_name: "Netflix" }));
    const r = remindersFor({ ...base, today: "2026-10-21", tx: sub }).find((x) => x.key.startsWith("bill:"))!;
    expect(r.body).toContain("22nd");
    expect(r.url).toBe("/insights#recurring");
  });

  it("only sends the weekly summary on Mondays, and can be switched off", () => {
    const rows = [tx("2026-10-20", -1000, "food"), tx("2026-10-14", -1000, "food")];
    expect(remindersFor({ ...base, today: "2026-10-27", tx: rows }).some((r) => r.key.startsWith("weekly"))).toBe(false); // Tuesday
    const monday = remindersFor({ ...base, today: "2026-10-26", tx: rows });
    expect(monday.find((r) => r.key === "weekly:2026-10-26")?.body).toBe("About the same as the week before.");
    expect(remindersFor({ ...base, today: "2026-10-26", tx: rows, prefs: { ...prefs, weekly: false } }).some((r) => r.key.startsWith("weekly"))).toBe(false);
  });

  it("uses stable keys, so the daily job never sends the same reminder twice", () => {
    const rows = [tx("2026-10-05", -9500, "food")];
    const budgetRows = [{ category_id: "food", month: "2026-10-01", limit_paise: 1000000 }];
    const day1 = remindersFor({ ...base, today: "2026-10-20", tx: rows, budgetRows }).map((r) => r.key);
    const day2 = remindersFor({ ...base, today: "2026-10-21", tx: rows, budgetRows }).map((r) => r.key);
    expect(day1).toContain("budget80:food:2026-10-01");
    expect(day2).toContain("budget80:food:2026-10-01");
  });

  it("writes reminders short enough for a lock screen", () => {
    const rows = [tx("2026-10-05", -12000, "food"), tx("2026-10-06", -6000, "shop")];
    const budgetRows = [{ category_id: "food", month: "2026-10-01", limit_paise: 1000000 }, { category_id: "shop", month: "2026-10-01", limit_paise: 500000 }];
    for (const r of remindersFor({ ...base, today: "2026-10-26", tx: rows, budgetRows })) {
      expect(r.title.length).toBeLessThanOrEqual(60);
      expect(r.body.length).toBeLessThanOrEqual(160);
      expect(r.url.startsWith("/")).toBe(true);
    }
  });
});
