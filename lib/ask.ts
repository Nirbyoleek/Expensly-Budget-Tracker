import { BRANDS, KEYWORDS } from "./ingest/merchants";
import { monthView, netWorth, shiftDays, spendBetween } from "./finance";
import { inr } from "./money";
import { analyse } from "./analytics";
import { TAXONOMY } from "./taxonomy";
import { monthStart } from "./dates";
import type { Account, BudgetRow, Category, IncomePlanRow, Transaction } from "./types";

/**
 * Answers common money questions from your data with plain rules.
 * This is the v1 stand-in for Ask Expensly; phase 4 hands open questions to an AI model with read-only tools.
 */
export function answerQuestion(q: string, ctx: { today: string; tx: Transaction[]; cats: Category[]; budgetRows: BudgetRow[]; accounts: Account[]; incomePlans?: IncomePlanRow[] }): string {
  const s = q.toLowerCase();
  const v = monthView(ctx);
  const spendCats = ctx.cats.filter((c) => c.kind === "spend");

  const cat = spendCats.find(
    (c) =>
      s.includes(c.id) ||
      c.name.toLowerCase().split(/[ &]+/).some((w) => w.length > 3 && s.includes(w)) ||
      (KEYWORDS[c.id] ?? []).some((w) => new RegExp(`\\b${w}\\b`).test(s)) ||
      BRANDS.some((b) => b.cat === c.id && b.keys.some((k) => s.includes(k))),
  );

  // A merchant you've paid ("how much on swiggy", "zomato this month")
  const merchantNames = [...new Set(ctx.tx.map((t) => t.merchant_name))];
  const merchant = merchantNames.filter((m) => m.length >= 3 && s.includes(m.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sub = TAXONOMY.flatMap((c) => c.subs.map((x) => ({ cat: c.id, ...x })))
    .filter((x) => x.id !== "other")
    .find((x) => new RegExp(`\\b${esc(x.name.toLowerCase().replace(/s$/, ""))}s?\\b`).test(s));
  const thisMonth = monthStart(ctx.today);
  const allTime = /all time|ever|total|six months|6 months/.test(s);

  if (/fee|interest|charges?|gst|penalt/.test(s)) {
    const a = analyse({ ...ctx, budgetRows: ctx.budgetRows });
    return a.fees.total
      ? `You've paid **${inr(a.fees.total)}** in fees and interest over six months${a.fees.thisMonth ? `, ${inr(a.fees.thisMonth)} of it this month` : ""}. Biggest: ${a.fees.bySub[0].name.toLowerCase()} at ${inr(a.fees.bySub[0].total)}.`
      : "No interest, GST on charges, late fees or forex markups in the last six months. Nice.";
  }
  if (/health|score|how am i doing|doing ok/.test(s)) {
    const a = analyse({ ...ctx, budgetRows: ctx.budgetRows });
    const weakest = [...a.health.parts].sort((x, y) => x.score / x.max - y.score / y.max)[0];
    return `Your money health is **${a.health.score}/100** (${a.health.label.toLowerCase()}). The quickest win: ${weakest.label.toLowerCase()}. ${weakest.note}`;
  }
  if (merchant && !/week/.test(s)) {
    const rows = ctx.tx.filter((t) => t.merchant_name === merchant && t.amount_paise < 0 && (allTime || t.date >= thisMonth));
    const total = -rows.reduce((a, t) => a + t.amount_paise, 0);
    return rows.length
      ? `**${inr(total)}** at ${merchant} ${allTime ? "in the last six months" : "this month"}, across ${rows.length} payment${rows.length === 1 ? "" : "s"} (about ${inr(Math.round(total / rows.length))} each).`
      : `Nothing at ${merchant} ${allTime ? "recently" : "this month"} yet.`;
  }
  if (sub && !/week/.test(s)) {
    const rows = ctx.tx.filter((t) => t.category_id === sub.cat && t.subcategory_id === sub.id && t.date >= (allTime ? "0000" : thisMonth));
    const total = -rows.reduce((a, t) => a + t.amount_paise, 0);
    return `**${inr(Math.max(0, total))}** on ${sub.name.toLowerCase()} ${allTime ? "in the last six months" : "this month"}, ${rows.filter((t) => t.amount_paise < 0).length} payment${rows.filter((t) => t.amount_paise < 0).length === 1 ? "" : "s"}.`;
  }

  if (/week/.test(s)) {
    const now = spendBetween(ctx.tx, ctx.cats, shiftDays(ctx.today, -6), ctx.today, cat?.id);
    const before = spendBetween(ctx.tx, ctx.cats, shiftDays(ctx.today, -13), shiftDays(ctx.today, -7), cat?.id);
    const pct = before ? Math.round((now / before - 1) * 100) : 0;
    return `${cat ? cat.name : "All spending"}: **${inr(now)}** in the last 7 days, against ${inr(before)} the week before${before ? ` (${pct >= 0 ? "+" : "−"}${Math.abs(pct)}%)` : ""}.`;
  }
  if (/net ?worth|wealth|assets|how rich/.test(s)) {
    const nw = netWorth(ctx.accounts);
    return ctx.accounts.length
      ? `Your net worth is **${inr(nw.total)}**: ${inr(nw.assets)} in assets and ${inr(nw.liabilities)} owed.`
      : "Add your accounts in Wealth and I'll total them up.";
  }
  if (/subscri|recurring|bills? (?:due|coming)/.test(s)) {
    const subs = v.recurring.filter((r) => r.category_id === "subs");
    if (!subs.length) return "I haven't spotted any subscriptions yet. They show up after two months of the same charge.";
    const total = subs.reduce((a, r) => a + r.amount, 0);
    return `You pay for **${subs.length} subscriptions**: ${inr(total)} a month, ${inr(total * 12)} a year. The biggest is ${[...subs].sort((a, b) => b.amount - a.amount)[0].name}.`;
  }
  if (/biggest|most|top|largest|where.*(go|went)/.test(s)) {
    const top = Object.entries(v.spentByCat).sort((a, b) => b[1] - a[1])[0];
    if (!top) return "No spending logged this month yet.";
    const c = ctx.cats.find((x) => x.id === top[0]);
    return `Your biggest category this month is **${c?.name}** at ${inr(top[1])}, ${Math.round((top[1] / v.spent) * 100)}% of spending.`;
  }
  if (/save|saving|salary|income|left (?:at|by) (?:the )?(?:month|end)|payday/.test(s) && ctx.incomePlans?.length) {
    const i = analyse(ctx).income;
    if (i) {
      const pay = i.daysToPayday !== null && !i.salaryArrived ? ` Salary is due in ${i.daysToPayday} day${i.daysToPayday === 1 ? "" : "s"}.` : "";
      return `On ${inr(i.plan.total)} a month you're set to keep **${inr(Math.max(0, i.projectedLeft))}** after spending this month, a ${Math.round(i.projectedRate * 100)}% savings rate (goal ${i.plan.savings_goal_pct}%). To hit the goal, keep everyday spend under ${inr(i.dailyAllowance)} a day.${pay}`;
    }
  }
  if (/save|saving/.test(s)) {
    return v.income
      ? `You've kept **${inr(v.saved)}** of this month's income so far, a ${Math.round((v.saved / v.income) * 100)}% savings rate.`
      : `You've spent ${inr(v.spent)} this month. Add your income to see your savings rate.`;
  }
  if (/afford|safe|can i spend|left/.test(s)) {
    return `You can spend about **${inr(v.safePerDay)} a day** for the next ${v.daysLeft} days and stay within budget, after ${inr(v.upcomingTotal)} of bills still due.`;
  }
  if (cat) {
    const spent = v.spentByCat[cat.id] ?? 0;
    const budget = v.budgets[cat.id] ?? 0;
    return `You've spent **${inr(spent)}** on ${cat.name.toLowerCase()} this month${budget ? `, ${Math.round((spent / budget) * 100)}% of its ${inr(budget)} budget` : ""}.`;
  }
  if (/spen[dt]|total/.test(s)) return `You've spent **${inr(v.spent)}** this month, ${Math.round((v.spent / Math.max(1, v.budgetTotal)) * 100)}% of your budget.`;
  return "Try asking about a merchant (“how much on Swiggy”), a type of spend (“food delivery this month”), fees and interest, your money health, this week against last, savings, what's safe to spend, subscriptions or net worth.";
}
