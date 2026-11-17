import { describe, expect, it } from "vitest";
import { SYSTEM_CATEGORIES as cats } from "../categories";
import { budgetBoostOf, isBudgetBoost, moneyIn, monthView } from "../finance";
import { MONEY_IN_SOURCES, subName } from "../taxonomy";
import { tx } from "../../tests/fixtures";
import type { BudgetRow } from "../types";

const salary = tx("2026-11-01", 60000, "income", { subcategory_id: "salary", merchant_name: "Acme Payroll" });
const gig = tx("2026-11-05", 5000, "income", { subcategory_id: "freelance", merchant_name: "Upwork client", adds_to_budget: true });
const gift = tx("2026-11-06", 2000, "income", { subcategory_id: "gifts", merchant_name: "Mom" });
const food = tx("2026-11-07", -1500, "food");
const budgetRows: BudgetRow[] = cats.filter((c) => c.kind === "spend").map((c) => ({ category_id: c.id, month: "2026-11-01", limit_paise: c.id === "food" ? 1000000 : 0 }));

describe("extra money", () => {
  it("every source has a name and salary isn't one of them", () => {
    for (const s of MONEY_IN_SOURCES) expect(subName("income", s)).toBeTruthy();
    expect(MONEY_IN_SOURCES).not.toContain("salary");
  });

  it("splits money in into salary and extra money, and what was added to the budget", () => {
    const m = moneyIn([salary, gig, gift, food]);
    expect(m).toMatchObject({ income: 6700000, salary: 6000000, extra: 700000, toBudget: 500000 });
  });

  it("only extra money you chose to add raises the budget, never salary or money out", () => {
    expect(isBudgetBoost(gig)).toBe(true);
    expect(isBudgetBoost(gift)).toBe(false);
    expect(isBudgetBoost({ ...salary, adds_to_budget: true })).toBe(false);
    expect(isBudgetBoost({ ...gig, amount_paise: -500000 })).toBe(false);
    expect(isBudgetBoost({ ...gig, category_id: "people" })).toBe(false);
    expect(budgetBoostOf([salary, gig, gift, food])).toBe(500000);
  });

  it("adds to this month's budget and what's safe to spend", () => {
    const without = monthView({ today: "2026-11-10", tx: [salary, gift, food], cats, budgetRows });
    const withGig = monthView({ today: "2026-11-10", tx: [salary, gift, food, gig], cats, budgetRows });
    expect(without.budgetTotal).toBe(1000000);
    expect(withGig).toMatchObject({ baseBudget: 1000000, budgetBoost: 500000, budgetTotal: 1500000 });
    expect(withGig.safePerDay).toBeGreaterThan(without.safePerDay);
  });

  it("does nothing to the budget until there are budgets to add it to", () => {
    const none = budgetRows.map((r) => ({ ...r, limit_paise: 0 }));
    const v = monthView({ today: "2026-11-10", tx: [gig, food], cats: cats.map((c) => ({ ...c, default_budget_paise: 0 })), budgetRows: none });
    expect(v).toMatchObject({ baseBudget: 0, budgetBoost: 0, budgetTotal: 0 });
  });

  it("last month's extra money doesn't count this month", () => {
    const old = { ...gig, date: "2026-10-28" };
    expect(monthView({ today: "2026-11-10", tx: [old, food], cats, budgetRows }).budgetBoost).toBe(0);
  });
});
