import { describe, expect, it } from "vitest";
import { remindersFor } from "../reminders";
import { SYSTEM_CATEGORIES as cats } from "../categories";
import type { Transaction } from "../types";

const t = (date: string, amount: number, category_id: string, merchant_name = "Shop"): Transaction =>
  ({ id: Math.random().toString(36), date, amount_paise: amount * 100, merchant_name, merchant_raw: null, category_id, subcategory_id: null, source: "import", reviewed: true, note: null, account_id: null, import_id: null }) as Transaction;
const prefs = { budget: true, bills: true, weekly: true };

describe("remindersFor", () => {
  it("nudges people who never added anything", () => {
    expect(remindersFor({ today: "2026-10-26", tx: [], cats, budgetRows: [], prefs, signedUpDaysAgo: 0 })).toEqual([]);
    expect(remindersFor({ today: "2026-10-26", tx: [], cats, budgetRows: [], prefs, signedUpDaysAgo: 5 }).map((r) => r.key)).toEqual(["nudge:first", "nudge:second"]);
  });

  it("warns at 80% and over 100%, once per category per month", () => {
    const tx = [t("2026-10-05", -8500, "food"), t("2026-10-06", -6000, "shop")];
    const budgetRows = [{ category_id: "food", month: "2026-10-01", limit_paise: 1000000 }, { category_id: "shop", month: "2026-10-01", limit_paise: 500000 }];
    const keys = remindersFor({ today: "2026-10-20", tx, cats, budgetRows, prefs, signedUpDaysAgo: 30 }).map((r) => r.key);
    expect(keys).toContain("budget80:food:2026-10-01");
    expect(keys).toContain("budget100:shop:2026-10-01");
    const off = remindersFor({ today: "2026-10-20", tx, cats, budgetRows, prefs: { ...prefs, budget: false }, signedUpDaysAgo: 30 });
    expect(off.some((r) => r.key.startsWith("budget"))).toBe(false);
  });

  it("reminds about a regular bill the day before", () => {
    const tx = ["2026-07-05", "2026-08-05", "2026-09-05"].map((d) => t(d, -14000, "bills", "Landlord Rent"));
    const r = remindersFor({ today: "2026-10-04", tx, cats, budgetRows: [], prefs, signedUpDaysAgo: 90 });
    expect(r.find((x) => x.key.startsWith("bill:"))?.title).toBe("Landlord Rent is due tomorrow");
  });

  it("sends a Monday summary", () => {
    const tx = [t("2026-10-20", -1000, "food"), t("2026-10-14", -500, "food")];
    const r = remindersFor({ today: "2026-10-26", tx, cats, budgetRows: [], prefs, signedUpDaysAgo: 30 });
    expect(r.find((x) => x.key === "weekly:2026-10-26")?.body).toMatch(/100% more/);
  });
});
