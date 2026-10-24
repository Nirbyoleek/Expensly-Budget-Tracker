import { describe, expect, it } from "vitest";
import { incomeStatus, resolvePlan } from "../income";
import type { Transaction } from "../types";

const row = (month: string, salary: number, payday = 1, goal = 20) => ({ month, salary_paise: salary * 100, other_paise: 0, payday, savings_goal_pct: goal });
const tx = (date: string, rupees: number, sub: string | null): Transaction => ({ id: date + rupees, date, amount_paise: rupees * 100, merchant_name: "Acme", merchant_raw: null, category_id: "income", subcategory_id: sub, source: "import", reviewed: true, note: null, account_id: null, import_id: null });

describe("income plan", () => {
  it("uses the latest plan on or before the month", () => {
    const rows = [row("2026-01-01", 60000), row("2026-09-01", 85000), row("2026-12-01", 95000)];
    expect(resolvePlan(rows, "2026-10-01")!.total).toBe(8500000);
    expect(resolvePlan(rows, "2026-05-01")!.total).toBe(6000000);
    expect(resolvePlan([], "2026-10-01")).toBe(null);
  });

  it("knows salary arrived and what's left", () => {
    const plan = resolvePlan([row("2026-09-01", 85000)], "2026-10-01")!;
    const s = incomeStatus({ plan, tx: [tx("2026-10-01", 84500, "salary")], today: "2026-10-22", forecastTotal: 5000000, spentSoFar: 4000000, invested: 500000, dueBills: 100000 });
    expect(s.salaryArrived).toBe(true);
    expect(s.projectedLeft).toBe(8500000 - 5000000 - 500000);
    expect(s.goal).toBe(1700000);
    expect(s.nextPayday).toBe("2026-11-01");
  });

  it("counts down to a payday that hasn't come", () => {
    const plan = resolvePlan([row("2026-09-01", 85000, 28)], "2026-10-01")!;
    const s = incomeStatus({ plan, tx: [], today: "2026-10-22", forecastTotal: 0, spentSoFar: 0, invested: 0, dueBills: 0 });
    expect([s.salaryArrived, s.daysToPayday, s.nextPayday]).toEqual([false, 6, "2026-10-28"]);
  });
});
