import { detectRecurring, monthView, shiftDays, spendBetween } from "./finance";
import { dayOf, monthStart } from "./dates";
import type { BudgetRow, Category, Transaction } from "./types";

export type Reminder = { key: string; title: string; body: string; url: string };
export type Prefs = { budget: boolean; bills: boolean; weekly: boolean };

const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const rs = (p: number) => "₹" + nf.format(Math.round(Math.abs(p) / 100));
const weekdayOf = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay(); // 0 = Sunday

/**
 * What to tell someone today. Every reminder has a stable key so the daily job sends it once:
 * the 80% warning for Food in October fires on the first day you cross it, never again that month.
 */
export function remindersFor(args: {
  today: string;
  tx: Transaction[];
  cats: Category[];
  budgetRows: BudgetRow[];
  prefs: Prefs;
  signedUpDaysAgo: number;
}): Reminder[] {
  const { today, tx, cats, budgetRows, prefs } = args;
  const out: Reminder[] = [];
  const real = tx.filter((t) => t.source !== "sample");

  // Signed up but never added anything: one nudge on day 1, one more on day 4.
  if (!real.length) {
    if (args.signedUpDaysAgo >= 1)
      out.push({ key: "nudge:first", title: "See what's safe to spend", body: "Import last month's bank or card statement. It takes about a minute and everything gets sorted for you.", url: "/home?add=statement" });
    if (args.signedUpDaysAgo >= 4)
      out.push({ key: "nudge:second", title: "Try it with a few spends", body: "Type something like “chai 20, auto 60, lunch 180” and Expensly does the rest.", url: "/home?add=quick" });
    return out;
  }

  const month = monthStart(today);
  const v = monthView({ today, tx, cats, budgetRows });

  if (prefs.budget) {
    const names = Object.fromEntries(cats.map((c) => [c.id, c.name]));
    for (const [cat, limit] of Object.entries(v.budgets)) {
      if (limit <= 0) continue;
      const spent = v.spentByCat[cat] ?? 0;
      const pct = spent / limit;
      const name = names[cat] ?? cat;
      if (pct >= 1)
        out.push({ key: `budget100:${cat}:${month}`, title: `${name} is over budget`, body: `${rs(spent)} of ${rs(limit)} this month, ${rs(spent - limit)} over with ${v.daysLeft - 1} days to go.`, url: "/budgets" });
      else if (pct >= 0.8)
        out.push({ key: `budget80:${cat}:${month}`, title: `${Math.round(pct * 100)}% of your ${name} budget used`, body: `${rs(limit - spent)} left for the next ${v.daysLeft} days, about ${rs((limit - spent) / v.daysLeft)} a day.`, url: "/budgets" });
    }
  }

  if (prefs.bills) {
    const tomorrow = shiftDays(today, 1);
    const sameMonth = tomorrow.slice(0, 7) === today.slice(0, 7);
    for (const r of detectRecurring(tx, today, cats)) {
      if (r.paidThisMonth || !sameMonth || r.day !== dayOf(tomorrow)) continue;
      out.push({ key: `bill:${r.key}:${tomorrow}`, title: `${r.name} is due tomorrow`, body: `Usually ${rs(r.amount)} around the ${r.day}${ordinal(r.day)}. Keep it in your account.`, url: "/wealth#recurring" });
    }
  }

  // Mondays: last week vs the week before, everyday spending only.
  if (prefs.weekly && weekdayOf(today) === 1) {
    const last = spendBetween(tx, cats, shiftDays(today, -7), shiftDays(today, -1));
    const before = spendBetween(tx, cats, shiftDays(today, -14), shiftDays(today, -8));
    if (last > 0 || before > 0) {
      const diff = before > 0 ? Math.round((last / before - 1) * 100) : null;
      out.push({
        key: `weekly:${today}`,
        title: `Last week: ${rs(last)} spent`,
        body: diff === null ? "Open Expensly to see where it went." : diff > 0 ? `${diff}% more than the week before. Tap to see what changed.` : diff < 0 ? `${-diff}% less than the week before. Nice.` : "About the same as the week before.",
        url: "/insights",
      });
    }
  }
  return out;
}

function ordinal(n: number) {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}
