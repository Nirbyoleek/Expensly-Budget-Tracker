import { describe, expect, it } from "vitest";
import { SYSTEM_CATEGORIES as cats } from "../categories";
import { cashflow, detectRecurring, insights, monthView, netWorth, resolveBudgets, spentByCategory } from "../finance";
import { sampleTransactions } from "../sample";
import { answerQuestion } from "../ask";
import type { Transaction } from "../types";

const TODAY = "2026-10-22";
let n = 0;
const tx = (date: string, rupees: number, name: string, cat: string, reviewed = true): Transaction => ({
  id: String(++n), date, amount_paise: rupees * 100, merchant_name: name, merchant_raw: null, category_id: cat, subcategory_id: null,
  source: "manual", reviewed, note: null, account_id: null, import_id: null,
});

describe("spending", () => {
  it("nets refunds against their category and ignores transfers and income", () => {
    const rows = [tx(TODAY, -2499, "Amazon", "shop"), tx(TODAY, 1499, "Myntra refund", "shop"), tx(TODAY, -18460, "CRED", "xfer"), tx(TODAY, 95000, "Salary", "income")];
    expect(spentByCategory(rows, cats)).toEqual({ shop: 100000 });
  });

  it("carries the latest budget forward and falls back to defaults", () => {
    const b = resolveBudgets([{ category_id: "food", month: "2026-08-01", limit_paise: 1000000 }, { category_id: "food", month: "2026-11-01", limit_paise: 5 }], cats, "2026-10-01");
    expect(b.food).toBe(1000000);
    expect(b.groc).toBe(700000);
    expect(b.income).toBeUndefined();
  });
});

describe("recurring", () => {
  it("finds a monthly charge and knows whether it is paid this month", () => {
    const rows = [tx("2026-08-26", -219, "iCloud+", "subs"), tx("2026-09-26", -219, "iCloud+", "subs"), tx("2026-09-12", -1499, "Myntra", "shop")];
    const r = detectRecurring(rows, TODAY, cats);
    expect(r.map((x) => [x.name, x.day, x.paidThisMonth])).toEqual([["iCloud+", 26, false]]);
  });

  it("ignores daily spends and wildly different amounts", () => {
    const rows = [tx("2026-08-03", -340, "Swiggy", "food"), tx("2026-09-03", -340, "Swiggy", "food"), tx("2026-08-07", -500, "Amazon", "shop"), tx("2026-09-07", -2400, "Amazon", "shop")];
    expect(detectRecurring(rows, TODAY, cats)).toHaveLength(0);
  });
});

describe("month view on sample data", () => {
  const all = sampleTransactions(TODAY).map((s, i) => ({ ...s, id: "s" + i, merchant_raw: null, source: "sample" as const, note: null, account_id: null, import_id: null }));
  const v = monthView({ today: TODAY, tx: all, cats, budgetRows: [] });

  it("computes a safe daily amount from what is left after bills due", () => {
    expect(v.daysLeft).toBe(10);
    expect(v.safePerDay).toBe(Math.max(0, Math.floor((v.budgetTotal - v.spent - v.upcomingTotal) / 10)));
    expect(v.upcomingBills.map((b) => b.name)).toEqual(["Airtel broadband", "iCloud+"]);
  });

  it("produces income and savings", () => {
    expect(v.income).toBe(9500000);
    expect(v.saved).toBe(v.income - v.spent);
  });

  it("builds six months of cash flow ending this month", () => {
    const cf = cashflow(all, cats, TODAY);
    expect(cf.map((c) => c.label)).toEqual(["May", "Jun", "Jul", "Aug", "Sep", "Oct"]);
    expect(cf[5].spent).toBe(v.spent);
  });

  it("writes insights", () => {
    const ins = insights(v, all, cats);
    expect(ins.map((i) => i.id)).toContain("proj");
    expect(ins.map((i) => i.id)).toContain("subs");
  });
});

describe("net worth", () => {
  it("separates assets from card debt", () => {
    const acc = (b: number) => ({ id: "a", name: "x", type: "bank" as const, balance_paise: b, last4: null, is_sample: false, updated_at: "" });
    expect(netWorth([acc(100), acc(-30)])).toEqual({ assets: 100, liabilities: 30, total: 70 });
  });
});

describe("ask", () => {
  const all = sampleTransactions(TODAY).map((s, i) => ({ ...s, id: "s" + i, merchant_raw: null, source: "sample" as const, note: null, account_id: null, import_id: null }));
  const ctx = { today: TODAY, tx: all, cats, budgetRows: [], accounts: [] };
  it.each([
    ["How much on food this month?", "Food & dining"],
    ["food this week vs last", "last 7 days"],
    ["My biggest category", "biggest category"],
    ["subscriptions", "subscriptions"],
    ["how much can I spend today", "a day"],
  ])("%s", (q, needle) => expect(answerQuestion(q, ctx).toLowerCase()).toContain(needle.toLowerCase()));
});
