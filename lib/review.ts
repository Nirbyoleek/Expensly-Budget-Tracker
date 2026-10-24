import { addMonths, daysInMonth, monthStart } from "./dates";
import { grossSpend, incomeOf, inMonth, moneyIn, spentByCategory } from "./finance";
import type { Category, Transaction } from "./types";

/**
 * A finished month, looked back on: where the money went, how it compares with the month before,
 * and a few honest lines worth reading. Pure; `tx` should cover the month and the one before it.
 */
export type MonthReview = ReturnType<typeof monthReview>;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function monthReview(tx: Transaction[], cats: Category[], monthIso: string) {
  const month = monthStart(monthIso), prevMonth = addMonths(month, -1);
  const cur = inMonth(tx, month), prev = inMonth(tx, prevMonth);
  const spendIds = new Set(cats.filter((c) => c.kind === "spend").map((c) => c.id));
  const byCat = spentByCategory(cur, cats), prevByCat = spentByCategory(prev, cats);
  const spent = sum(Object.values(byCat)), prevSpent = sum(Object.values(prevByCat));
  const income = incomeOf(cur), prevIncome = incomeOf(prev);
  const invested = -sum(cur.filter((t) => t.category_id === "invest" && t.amount_paise < 0).map((t) => t.amount_paise));
  const name = (id: string) => cats.find((c) => c.id === id)?.name ?? id;
  const color = (id: string) => cats.find((c) => c.id === id)?.color ?? "#9CA3AF";

  const categories = Object.entries(byCat)
    .filter(([, v]) => v > 0)
    .map(([id, total]) => ({ id, name: name(id), color: color(id), total, prev: prevByCat[id] ?? 0, share: spent ? total / spent : 0 }))
    .sort((a, b) => b.total - a.total);

  const outs = cur.filter((t) => t.amount_paise < 0 && spendIds.has(t.category_id));
  const biggest = [...outs].sort((a, b) => a.amount_paise - b.amount_paise).slice(0, 3);
  const merchants = new Map<string, { name: string; total: number; count: number }>();
  for (const t of outs) {
    const k = t.merchant_name.trim().toLowerCase();
    const m = merchants.get(k) ?? { name: t.merchant_name, total: 0, count: 0 };
    m.total -= t.amount_paise; m.count++;
    merchants.set(k, m);
  }
  const topMerchants = [...merchants.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  const mostVisited = [...merchants.values()].sort((a, b) => b.count - a.count)[0] ?? null;

  const days = daysInMonth(month);
  const spendDays = new Set(outs.filter((t) => !["bills", "subs", "fees", "invest"].includes(t.category_id)).map((t) => t.date));
  const fees = -sum(cur.filter((t) => t.category_id === "fees").map((t) => t.amount_paise));
  const saved = income ? income - spent : null;

  const lines: string[] = [];
  const rs = (p: number) => "₹" + Math.round(Math.abs(p) / 100).toLocaleString("en-IN");
  if (prevSpent) {
    const d = spent - prevSpent, pct = Math.round((Math.abs(d) / prevSpent) * 100);
    lines.push(pct < 3 ? "You spent about the same as the month before." : `You spent ${rs(d)} ${d > 0 ? "more" : "less"} than the month before (${pct}%).`);
  }
  const mover = categories.filter((c) => c.prev > 0 || c.total > 100000).map((c) => ({ ...c, d: c.total - c.prev })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  if (mover && Math.abs(mover.d) >= 50000) lines.push(`${mover.name} ${mover.d > 0 ? "went up" : "came down"} the most: ${rs(mover.d)} ${mover.d > 0 ? "more" : "less"}.`);
  if (saved !== null && income) lines.push(saved >= 0 ? `You kept ${Math.round((saved / income) * 100)}% of what you earned.` : `You spent ${rs(-saved)} more than you earned.`);
  if (mostVisited && mostVisited.count >= 4) lines.push(`${mostVisited.name} was your regular: ${mostVisited.count} times, ${rs(mostVisited.total)} in all.`);
  if (fees > 0) lines.push(`${rs(fees)} went on fees and interest.`);
  if (outs.length && days - spendDays.size >= 5) lines.push(`${days - spendDays.size} days without everyday spending.`);

  return {
    month, prevMonth, spent, prevSpent, income, prevIncome, saved, invested, fees,
    gross: grossSpend(cur, cats), moneyIn: moneyIn(cur),
    categories, biggest, topMerchants, noSpendDays: days - spendDays.size, days,
    count: cur.length, lines,
  };
}
