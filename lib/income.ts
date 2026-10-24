import { addMonths, dayOf, daysInMonth, monthStart } from "./dates";
import type { IncomePlanRow, Transaction } from "./types";

/**
 * Your planned income versus what actually arrived, and what that means for saving.
 * The plan is what you told Expensly; "received" is what the statements show.
 */

export type IncomePlan = IncomePlanRow & { total: number };

/** The latest plan set on or before this month. */
export function resolvePlan(rows: IncomePlanRow[], month: string): IncomePlan | null {
  const row = rows.filter((r) => r.month <= month).sort((a, b) => b.month.localeCompare(a.month))[0];
  if (!row || row.salary_paise + row.other_paise <= 0) return null;
  return { ...row, total: Number(row.salary_paise) + Number(row.other_paise) };
}

const pad = (n: number) => String(n).padStart(2, "0");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export type IncomeStatus = {
  plan: IncomePlan;
  received: number;
  salaryReceived: number;
  /** The salary credit we matched this month, if any. */
  salaryDate: string | null;
  salaryArrived: boolean;
  nextPayday: string | null;
  daysToPayday: number | null;
  /** Planned income minus forecast spend and investments: what should be left at month end. */
  projectedLeft: number;
  projectedRate: number;
  goal: number;
  goalGap: number;
  /** 50/30/20-style targets scaled to your savings goal. */
  targets: { needs: number; wants: number; savings: number };
  /** Daily everyday spend that still lands the savings goal. */
  dailyAllowance: number;
  /** Salary seen in each of the last 6 months (oldest first), to spot raises or missing pay. */
  history: { month: string; amount: number }[];
  /** Income you received that's not in the plan (freelance, refunds excluded). */
  extra: number;
};

export function incomeStatus(args: {
  plan: IncomePlan; tx: Transaction[]; today: string;
  forecastTotal: number; spentSoFar: number; invested: number; dueBills: number;
}): IncomeStatus {
  const { plan, tx, today } = args;
  const month = monthStart(today), day = dayOf(today), dim = daysInMonth(today);
  const incomeRows = tx.filter((t) => t.category_id === "income" && t.amount_paise > 0);
  const thisMonth = incomeRows.filter((t) => t.date >= month && t.date <= today);
  const received = sum(thisMonth.map((t) => t.amount_paise));

  // A salary credit: tagged salary, or the biggest credit within 25% of the planned salary.
  const isSalary = (t: Transaction) => t.subcategory_id === "salary" || (plan.salary_paise > 0 && Math.abs(t.amount_paise - plan.salary_paise) <= plan.salary_paise * 0.25);
  const salaryRows = thisMonth.filter(isSalary);
  const salaryReceived = sum(salaryRows.map((t) => t.amount_paise));
  const salaryArrived = plan.salary_paise === 0 || salaryReceived >= plan.salary_paise * 0.75;

  let nextPayday: string | null = null, daysToPayday: number | null = null;
  if (plan.payday) {
    const pd = Math.min(plan.payday, dim);
    if (!salaryArrived && pd >= day) { nextPayday = `${month.slice(0, 8)}${pad(pd)}`; daysToPayday = pd - day; }
    else {
      const nm = addMonths(month, 1);
      const npd = Math.min(plan.payday, daysInMonth(nm));
      nextPayday = `${nm.slice(0, 8)}${pad(npd)}`;
      daysToPayday = dim - day + npd;
    }
  }

  const expected = Math.max(plan.total, received);
  const projectedLeft = expected - args.forecastTotal - args.invested;
  const goal = Math.round((plan.total * plan.savings_goal_pct) / 100);
  const savingsSoFar = args.invested + Math.max(0, projectedLeft);
  const remainingDays = dim - day + 1;
  // What you can spend per day on everyday things and still save `goal` (investments count as saved).
  const room = expected - goal - args.spentSoFar - args.dueBills + Math.min(args.invested, goal);
  const savingsPct = plan.savings_goal_pct / 100;
  const wantsPct = Math.max(0, Math.min(0.3, 1 - savingsPct - 0.5));
  const needsPct = Math.max(0, 1 - savingsPct - wantsPct);

  const history = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(month, i - 5);
    return { month: m, amount: sum(incomeRows.filter((t) => t.date.startsWith(m.slice(0, 7)) && isSalary(t)).map((t) => t.amount_paise)) };
  });

  return {
    plan, received, salaryReceived, salaryDate: salaryRows[0]?.date ?? null, salaryArrived, nextPayday, daysToPayday,
    projectedLeft,
    projectedRate: expected ? (savingsSoFar) / expected : 0,
    goal,
    goalGap: savingsSoFar - goal,
    targets: { needs: Math.round(plan.total * needsPct), wants: Math.round(plan.total * wantsPct), savings: goal },
    dailyAllowance: Math.max(0, Math.floor(room / remainingDays)),
    history,
    extra: sum(thisMonth.filter((t) => !isSalary(t)).map((t) => t.amount_paise)),
  };
}
