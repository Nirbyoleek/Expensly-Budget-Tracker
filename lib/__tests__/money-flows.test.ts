import { describe, expect, it } from "vitest";
import { cashflow, grossSpend, moneyIn, monthView, netWorth, resolveBudgets, spentByCategory, spendBetween, shiftDays } from "../finance";
import { SYSTEM_CATEGORIES as cats } from "../categories";
import { tx } from "../../tests/fixtures";

const TODAY = "2026-10-20";

describe("spending is net of refunds and paybacks", () => {
  const rows = [
    tx("2026-10-02", -2000, "people"), // sent to a friend
    tx("2026-10-03", 500, "people"), // friend paid back part
    tx("2026-10-04", -3000, "food"),
    tx("2026-10-05", 1000, "food"), // refund
    tx("2026-10-06", 50000, "income"),
    tx("2026-10-07", -20000, "xfer"), // card bill: not spending
    tx("2026-10-07", 20000, "xfer"), // matching credit on the card
    tx("2026-10-08", -5000, "invest"), // SIP: savings, not spending
    tx("2026-10-09", 2000, "invest"), // redemption
  ];

  it("subtracts refunds and paybacks per category", () => {
    expect(spentByCategory(rows, cats)).toEqual({ people: 150000, food: 200000 });
  });

  it("never lets a category go negative when more came back than went out", () => {
    expect(spentByCategory([tx("2026-10-01", -100, "shop"), tx("2026-10-02", 400, "shop")], cats)).toEqual({ shop: 0 });
  });

  it("splits money in by kind", () => {
    expect(moneyIn(rows)).toEqual({ income: 5000000, refunds: 100000, fromPeople: 50000, transfers: 2000000, investments: 200000, total: 7350000, count: 5 });
  });

  it("reports gross spend before anything came back", () => {
    expect(grossSpend(rows, cats)).toBe(500000);
  });
});

describe("monthView", () => {
  const rows = [
    tx("2026-10-01", -14000, "bills", { merchant_name: "Landlord" }),
    tx("2026-10-05", -2000, "food"),
    tx("2026-10-10", -1000, "groc"),
    tx("2026-10-12", 60000, "income"),
    tx("2026-10-15", -500, "food", { reviewed: false }),
  ];
  const v = monthView({ today: TODAY, tx: rows, cats, budgetRows: [{ category_id: "food", month: "2026-09-01", limit_paise: 300000 }] });

  it("counts days, pace and totals for the month", () => {
    expect(v).toMatchObject({ month: "2026-10-01", day: 20, dim: 31, daysLeft: 12, spent: 1750000, income: 6000000, saved: 4250000, unreviewed: 1 });
    expect(v.pace).toBeCloseTo(20 / 31, 5);
  });

  it("carries a budget forward from an earlier month", () => {
    expect(v.budgets.food).toBe(300000);
  });

  it("gives a safe daily amount that never goes below zero", () => {
    expect(v.safePerDay).toBe(Math.floor((v.budgetTotal - v.spent - v.upcomingTotal) / v.daysLeft));
    const broke = monthView({ today: TODAY, tx: [tx("2026-10-02", -900000, "shop")], cats, budgetRows: [] });
    expect(broke.safePerDay).toBe(0);
  });

  it("keeps rent out of the daily heatmap", () => {
    expect(v.dayTotals[1]).toBeUndefined();
    expect(v.dayTotals[5]).toBe(200000);
    expect(v.dayDetail[5]).toEqual({ count: 1, top: "Shop" });
  });
});

describe("resolveBudgets", () => {
  it("uses the latest row on or before the month, else the default", () => {
    const rows = [
      { category_id: "food", month: "2026-08-01", limit_paise: 500000 },
      { category_id: "food", month: "2026-10-01", limit_paise: 700000 },
      { category_id: "food", month: "2026-11-01", limit_paise: 900000 },
    ];
    const b = resolveBudgets(rows, cats, "2026-10-01");
    expect(b.food).toBe(700000);
    expect(b.groc).toBe(cats.find((c) => c.id === "groc")!.default_budget_paise);
    expect(b.income).toBeUndefined(); // only spend categories have budgets
  });
});

describe("cashflow and helpers", () => {
  it("returns six months oldest first with income and net spend", () => {
    const c = cashflow([tx("2026-09-10", -1000, "food"), tx("2026-09-11", 40000, "income"), tx("2026-10-02", -500, "food")], cats, TODAY);
    expect(c.map((m) => m.label)).toEqual(["May", "Jun", "Jul", "Aug", "Sep", "Oct"]);
    expect(c[4]).toMatchObject({ income: 4000000, spent: 100000 });
    expect(c[5].spent).toBe(50000);
  });

  it("sums spend between two dates, optionally for one category", () => {
    const rows = [tx("2026-10-01", -100, "food"), tx("2026-10-03", -200, "groc"), tx("2026-10-05", -400, "food")];
    expect(spendBetween(rows, cats, "2026-10-01", "2026-10-03")).toBe(30000);
    expect(spendBetween(rows, cats, "2026-10-01", "2026-10-31", "food")).toBe(50000);
  });

  it("shifts days across month and year ends", () => {
    expect(shiftDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("adds up net worth from accounts", () => {
    const a = (balance_paise: number) => ({ id: "a", name: "A", type: "bank" as const, balance_paise, last4: null, is_sample: false, updated_at: "" });
    expect(netWorth([a(500000), a(200000), a(-150000)])).toEqual({ assets: 700000, liabilities: 150000, total: 550000 });
  });
});
