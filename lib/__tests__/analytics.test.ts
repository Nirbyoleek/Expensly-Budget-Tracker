import { describe, expect, it } from "vitest";
import { analyse, merchantProfile, recurringPayments, unusualActivity, weekdayOf } from "../analytics";
import { SYSTEM_CATEGORIES as cats } from "../categories";
import { sampleTransactions } from "../sample";
import type { Transaction } from "../types";

const TODAY = "2026-10-22";
let n = 0;
const tx = (date: string, rupees: number, merchant: string, category_id: string, subcategory_id: string | null = null): Transaction => ({
  id: "t" + n++, date, amount_paise: rupees * 100, merchant_name: merchant, merchant_raw: null, category_id, subcategory_id,
  source: "import", reviewed: true, note: null, account_id: null, import_id: null,
});

describe("recurring payments", () => {
  const rows = [
    tx("2026-07-03", -199, "Netflix", "subs", "streaming"),
    tx("2026-08-03", -199, "Netflix", "subs", "streaming"),
    tx("2026-09-03", -199, "Netflix", "subs", "streaming"),
    tx("2026-10-03", -249, "Netflix", "subs", "streaming"),
    tx("2026-08-11", -1100, "WBSEDCL", "bills", "electricity"),
    tx("2026-09-11", -1450, "WBSEDCL", "bills", "electricity"),
    tx("2026-10-11", -1260, "WBSEDCL", "bills", "electricity"),
    tx("2026-04-20", -1499, "Old app", "subs", "cloud"),
    tx("2026-05-20", -1499, "Old app", "subs", "cloud"),
  ];
  const rec = recurringPayments(rows, cats, TODAY);

  it("finds monthly charges and predicts the next date", () => {
    const nf = rec.find((r) => r.name === "Netflix")!;
    expect([nf.cadence, nf.next, nf.amount]).toEqual(["monthly", "2026-11-03", 24900]);
  });
  it("spots a price rise", () => {
    expect(rec.find((r) => r.name === "Netflix")!.priceChange).toEqual({ from: 19900, to: 24900, date: "2026-10-03" });
  });
  it("allows utilities to vary without calling it a price change", () => {
    const e = rec.find((r) => r.name === "WBSEDCL")!;
    expect([e.variable, e.priceChange]).toEqual([true, null]);
  });
  it("drops subscriptions that stopped", () => {
    expect(rec.some((r) => r.name === "Old app")).toBe(false);
  });
  it("raises a price alert", () => {
    expect(unusualActivity(rows, cats, TODAY, rec).some((a) => a.kind === "price" && a.title.includes("Netflix went up 25%"))).toBe(true);
  });
});

describe("unusual activity", () => {
  it("flags a spend far above your usual and a likely double charge", () => {
    const rows = [
      tx("2026-08-02", -300, "Swiggy", "food", "delivery"),
      tx("2026-08-20", -320, "Swiggy", "food", "delivery"),
      tx("2026-09-05", -280, "Swiggy", "food", "delivery"),
      tx("2026-10-18", -2400, "Swiggy", "food", "delivery"),
      tx("2026-10-19", -1299, "Amazon", "shop", "marketplace"),
      tx("2026-10-19", -1299, "Amazon", "shop", "marketplace"),
    ];
    const kinds = unusualActivity(rows, cats, TODAY, []).map((a) => a.kind).sort();
    expect(kinds).toEqual(["duplicate", "unusual"]);
  });
});

describe("whole-month analysis on sample data", () => {
  const all = sampleTransactions(TODAY).map((s, i) => ({ ...s, id: "s" + i, merchant_raw: null, source: "sample" as const, note: null, account_id: null, import_id: null }));
  const a = analyse({ tx: all, cats, budgetRows: [], today: TODAY });

  it("breaks categories into subcategories that add up", () => {
    const food = a.breakdown.find((b) => b.id === "food")!;
    expect(food.subs.reduce((s, x) => s + x.total, 0)).toBe(food.total);
    expect(food.subs.map((s) => s.id)).toContain("delivery");
  });
  it("scores health between 0 and 100 with explained parts", () => {
    expect(a.health.score).toBeGreaterThan(0);
    expect(a.health.score).toBeLessThanOrEqual(100);
    expect(a.health.parts.every((p) => p.score >= 0 && p.score <= p.max && p.note.length > 0)).toBe(true);
  });
  it("counts SIPs as savings, not spending", () => {
    expect(a.split.savings).toBe(500000);
  });
  it("forecasts at least what's already spent", () => {
    expect(a.forecast.total).toBeGreaterThanOrEqual(a.forecast.spent);
  });
  it("tells the month as a story", () => {
    expect(a.story[0]).toMatch(/^October so far/);
  });
  it("profiles a merchant", () => {
    const p = merchantProfile(all, "Swiggy");
    expect(p.count).toBeGreaterThan(3);
    expect(p.avg).toBeGreaterThan(0);
  });
});

it("weekday index starts on Monday", () => {
  expect(weekdayOf("2026-10-19")).toBe(0);
  expect(weekdayOf("2026-10-25")).toBe(6);
});
