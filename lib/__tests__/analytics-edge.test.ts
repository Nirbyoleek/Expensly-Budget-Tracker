import { describe, expect, it } from "vitest";
import { feesSummary, merchantProfile, needsWants, noSpendStreaks, unusualActivity, weekdayOf, weekdayPattern, healthScore, analyse, headlineInsights } from "../analytics";
import { SYSTEM_CATEGORIES as cats } from "../categories";
import { days, tx } from "../../tests/fixtures";

const TODAY = "2026-10-24";

describe("weekday pattern", () => {
  it("doesn't treat days before your first transaction as zero-spend days", () => {
    // ₹100 every day for the last 14 days only
    const rows = days("2026-10-11", TODAY).map((d) => tx(d, -100, "food"));
    const w = weekdayPattern(rows, cats, TODAY, 90);
    expect(w.avg.every((a) => a === 10000)).toBe(true);
  });

  it("leaves one-off big purchases (over ₹5,000) out of the everyday average", () => {
    const rows = [...days("2026-10-11", TODAY).map((d) => tx(d, -100, "food")), tx("2026-10-17", -60000, "shop")];
    expect(weekdayPattern(rows, cats, TODAY, 90).avg[weekdayOf("2026-10-17")]).toBe(10000);
  });

  it("finds the most expensive day of the week", () => {
    const rows = days("2026-10-11", TODAY).map((d) => tx(d, weekdayOf(d) === 5 ? -900 : -100, "food"));
    expect(weekdayPattern(rows, cats, TODAY).peak).toBe(5); // Saturday
  });
});

describe("unusual activity", () => {
  const history = ["2026-07-05", "2026-08-05", "2026-09-05", "2026-09-20"].map((d) => tx(d, -300, "food", { merchant_name: "Cafe Mocha" }));

  it("flags a charge far above your usual at a regular merchant, once per merchant", () => {
    const rows = [...history, tx("2026-10-10", -2400, "food", { merchant_name: "Cafe Mocha" }), tx("2026-10-12", -1800, "food", { merchant_name: "Cafe Mocha" })];
    const alerts = unusualActivity(rows, cats, TODAY, []).filter((a) => a.kind === "unusual");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toMatch(/8\.0× your usual at Cafe Mocha/);
  });

  it("spots a possible double charge but not small or daily things", () => {
    const rows = [tx("2026-10-20", -1499, "shop", { merchant_name: "Myntra" }), tx("2026-10-21", -1499, "shop", { merchant_name: "Myntra" }), tx("2026-10-20", -60, "trans", { merchant_name: "Auto" }), tx("2026-10-20", -60, "trans", { merchant_name: "Auto" })];
    const d = unusualActivity(rows, cats, TODAY, []).filter((a) => a.kind === "duplicate");
    expect(d.map((a) => a.title)).toEqual(["Charged twice by Myntra?"]);
  });
});

describe("other analytics", () => {
  it("adds up fees by type", () => {
    const f = feesSummary([tx("2026-10-01", -500, "fees", { subcategory_id: "interest" }), tx("2026-09-01", -90, "fees", { subcategory_id: "gst" }), tx("2026-10-02", -10, "fees")], TODAY);
    expect(f).toMatchObject({ total: 60000, thisMonth: 51000, count: 3 });
    expect(f.bySub[0]).toMatchObject({ id: "interest", total: 50000 });
  });

  it("splits needs, wants, avoidable and savings", () => {
    const s = needsWants([tx("2026-10-02", -1000, "groc"), tx("2026-10-02", -400, "food"), tx("2026-10-03", -50, "fees"), tx("2026-10-04", -2000, "invest"), tx("2026-10-05", 30000, "income")], cats, "2026-10-01");
    expect(s).toEqual({ needs: 100000, wants: 40000, avoidable: 5000, savings: 200000, income: 3000000 });
  });

  it("counts no-spend streaks", () => {
    const s = noSpendStreaks([tx("2026-10-01", -10, "food"), tx("2026-10-10", -10, "food")], cats, "2026-10-14");
    expect(s).toEqual({ current: 4, longest: 8, days: 12 });
  });

  it("profiles a merchant", () => {
    const rows = ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"].map((d, i) => tx(d, -(100 + i * 100), "food", { merchant_name: "Swiggy" }));
    const p = merchantProfile([...rows, tx("2026-09-23", 50, "food", { merchant_name: "Swiggy" })], "swiggy");
    expect(p).toMatchObject({ total: 100000, count: 4, avg: 25000, refunds: 5000, everyDays: 7, weekday: "Tuesday", first: "2026-09-01" });
    expect(p.largest?.amount_paise).toBe(-40000);
  });

  it("keeps the health score within 0–100 and explains every part", () => {
    const rows = days("2026-08-01", TODAY).map((d) => tx(d, -300, "food"));
    const h = healthScore({ tx: rows, cats, budgetRows: [], today: TODAY, forecast: 1000000 });
    expect(h.score).toBeGreaterThanOrEqual(0);
    expect(h.score).toBeLessThanOrEqual(100);
    expect(h.parts.reduce((n, p) => n + p.max, 0)).toBe(100);
    for (const p of h.parts) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(p.max);
      expect(p.note.length).toBeGreaterThan(5);
    }
  });

  it("runs the whole analysis on empty data without crashing", () => {
    const a = analyse({ tx: [], cats, budgetRows: [], today: TODAY });
    expect(a.forecast.total).toBe(0);
    expect(Array.isArray(headlineInsights(a))).toBe(true);
  });
});
