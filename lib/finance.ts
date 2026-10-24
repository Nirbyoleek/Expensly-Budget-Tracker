import { addMonths, dayOf, daysInMonth, monthShort, monthStart } from "./dates";
import type { Account, BudgetRow, Category, Transaction } from "./types";

/**
 * Every number on the dashboard comes from here. Pure functions over plain rows,
 * so they run the same on the server and in tests.
 */

export const FIXED_CATS = new Set(["bills", "subs"]);

export type MonthView = {
  today: string;
  month: string; // YYYY-MM-01
  day: number;
  dim: number;
  daysLeft: number; // including today
  pace: number; // share of month gone, 0–1
  budgets: Record<string, number>;
  budgetTotal: number;
  spentByCat: Record<string, number>;
  spent: number;
  income: number;
  saved: number;
  safePerDay: number;
  upcomingBills: Recurring[];
  upcomingTotal: number;
  paceDiff: number; // positive = under pace
  projected: number;
  dayTotals: Record<number, number>;
  dayDetail: Record<number, { count: number; top: string }>;
  unreviewed: number;
  /** Money in, by kind, this month. */
  moneyIn: MoneyIn;
  /** Spend before refunds and paybacks; `spent` is the net figure. */
  grossSpent: number;
};

export type Recurring = {
  key: string;
  name: string;
  amount: number; // positive paise
  day: number;
  category_id: string;
  paidThisMonth: boolean;
  months: number;
};

const spendSet = (cats: Category[]) => new Set(cats.filter((c) => c.kind === "spend").map((c) => c.id));

export const inMonth = (tx: Transaction[], month: string) => tx.filter((t) => t.date.startsWith(month.slice(0, 7)));

/** Net spend per category. Refunds (positive rows in a spend category) reduce it. */
export function spentByCategory(tx: Transaction[], cats: Category[]): Record<string, number> {
  const spend = spendSet(cats);
  const out: Record<string, number> = {};
  for (const t of tx) if (spend.has(t.category_id)) out[t.category_id] = (out[t.category_id] ?? 0) - t.amount_paise;
  for (const k of Object.keys(out)) out[k] = Math.max(0, out[k]);
  return out;
}

/**
 * Every rupee that came in this period, by kind. Only income is "earned"; refunds and money back
 * from people already reduce spending, and transfers between your own accounts are neutral.
 */
export type MoneyIn = { income: number; refunds: number; fromPeople: number; transfers: number; investments: number; total: number; count: number };
export function moneyIn(tx: Transaction[]): MoneyIn {
  const out: MoneyIn = { income: 0, refunds: 0, fromPeople: 0, transfers: 0, investments: 0, total: 0, count: 0 };
  for (const t of tx) {
    if (t.amount_paise <= 0) continue;
    out.total += t.amount_paise;
    out.count++;
    if (t.category_id === "income") out.income += t.amount_paise;
    else if (t.category_id === "people") out.fromPeople += t.amount_paise;
    else if (t.category_id === "xfer") out.transfers += t.amount_paise;
    else if (t.category_id === "invest") out.investments += t.amount_paise;
    else out.refunds += t.amount_paise;
  }
  return out;
}

/** Everything that went out to spend categories, before refunds and paybacks are taken off. */
export function grossSpend(tx: Transaction[], cats: Category[]) {
  const spend = spendSet(cats);
  return tx.filter((t) => t.amount_paise < 0 && spend.has(t.category_id)).reduce((a, t) => a - t.amount_paise, 0);
}

export const incomeOf = (tx: Transaction[]) => tx.filter((t) => t.category_id === "income" && t.amount_paise > 0).reduce((a, t) => a + t.amount_paise, 0);

/** The latest budget set on or before this month wins; otherwise the category default. */
export function resolveBudgets(rows: BudgetRow[], cats: Category[], month: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cats) {
    if (c.kind !== "spend") continue;
    const row = rows
      .filter((r) => r.category_id === c.id && r.month <= month)
      .sort((a, b) => b.month.localeCompare(a.month))[0];
    out[c.id] = row ? row.limit_paise : c.default_budget_paise;
  }
  return out;
}

/** Everyday spending per day of month, leaving out rent and subscriptions so the pattern shows. */
/** How many everyday spends each day had, and the biggest one, for chart tooltips. */
export function dayDetail(tx: Transaction[], cats: Category[]): Record<number, { count: number; top: string }> {
  const spend = spendSet(cats);
  const out: Record<number, { count: number; top: string; max: number }> = {};
  for (const t of tx) {
    if (!spend.has(t.category_id) || FIXED_CATS.has(t.category_id) || t.amount_paise >= 0) continue;
    const d = dayOf(t.date);
    const cur = out[d] ?? { count: 0, top: "", max: 0 };
    cur.count++;
    if (-t.amount_paise > cur.max) { cur.max = -t.amount_paise; cur.top = t.merchant_name; }
    out[d] = cur;
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { count: v.count, top: v.top }]));
}

export function dayTotals(tx: Transaction[], cats: Category[]): Record<number, number> {
  const spend = spendSet(cats);
  const out: Record<number, number> = {};
  for (const t of tx) {
    if (!spend.has(t.category_id) || FIXED_CATS.has(t.category_id) || t.amount_paise >= 0) continue;
    const d = dayOf(t.date);
    out[d] = (out[d] ?? 0) - t.amount_paise;
  }
  return out;
}

/**
 * A merchant charged in at least two of the last four months, for roughly the same amount
 * (within 20%), at most twice a month, is treated as recurring.
 */
export function detectRecurring(tx: Transaction[], today: string, cats: Category[]): Recurring[] {
  const spend = spendSet(cats);
  const thisMonth = monthStart(today);
  const from = addMonths(thisMonth, -3);
  const groups = new Map<string, Transaction[]>();
  for (const t of tx) {
    if (t.amount_paise >= 0 || !spend.has(t.category_id) || t.date < from || t.date > today) continue;
    if (["food", "groc", "trans"].includes(t.category_id)) continue; // daily spends repeat by nature
    const key = t.merchant_name.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    const byMonth = new Map<string, Transaction[]>();
    for (const t of list) byMonth.set(t.date.slice(0, 7), [...(byMonth.get(t.date.slice(0, 7)) ?? []), t]);
    if (byMonth.size < 2 || [...byMonth.values()].some((m) => m.length > 2)) continue;
    const amounts = list.map((t) => -t.amount_paise).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    if (amounts.some((a) => Math.abs(a - median) > median * 0.2)) continue;
    const latest = [...list].sort((a, b) => b.date.localeCompare(a.date))[0];
    out.push({
      key,
      name: latest.merchant_name,
      amount: -latest.amount_paise,
      day: dayOf(latest.date),
      category_id: latest.category_id,
      paidThisMonth: byMonth.has(thisMonth.slice(0, 7)),
      months: byMonth.size,
    });
  }
  return out.sort((a, b) => a.day - b.day);
}

export function monthView(args: {
  today: string;
  tx: Transaction[];
  cats: Category[];
  budgetRows: BudgetRow[];
}): MonthView & { recurring: Recurring[] } {
  const { today, cats } = args;
  const month = monthStart(today);
  const day = dayOf(today);
  const dim = daysInMonth(today);
  const daysLeft = dim - day + 1;
  const mtx = inMonth(args.tx, month);
  const budgets = resolveBudgets(args.budgetRows, cats, month);
  const budgetTotal = Object.values(budgets).reduce((a, b) => a + b, 0);
  const spentByCat = spentByCategory(mtx, cats);
  const spent = Object.values(spentByCat).reduce((a, b) => a + b, 0);
  const income = incomeOf(mtx);
  const recurring = detectRecurring(args.tx, today, cats);
  const upcomingBills = recurring.filter((r) => !r.paidThisMonth && r.day >= day);
  const upcomingTotal = upcomingBills.reduce((a, r) => a + r.amount, 0);
  const pace = day / dim;
  const fixedSpent = [...FIXED_CATS].reduce((a, k) => a + (spentByCat[k] ?? 0), 0);
  const variable = spent - fixedSpent;
  const projected = Math.round(fixedSpent + upcomingTotal + (variable / day) * dim);
  return {
    today, month, day, dim, daysLeft, pace, budgets, budgetTotal, spentByCat, spent, income,
    saved: income - spent,
    safePerDay: Math.max(0, Math.floor((budgetTotal - spent - upcomingTotal) / daysLeft)),
    upcomingBills, upcomingTotal,
    paceDiff: Math.round(budgetTotal * pace - spent),
    projected,
    dayTotals: dayTotals(mtx, cats),
    dayDetail: dayDetail(mtx, cats),
    unreviewed: args.tx.filter((t) => !t.reviewed).length,
    moneyIn: moneyIn(mtx),
    grossSpent: grossSpend(mtx, cats),
    recurring,
  };
}

export function cashflow(tx: Transaction[], cats: Category[], today: string, months = 6) {
  const cur = monthStart(today);
  return Array.from({ length: months }, (_, i) => {
    const m = addMonths(cur, i - months + 1);
    const mtx = inMonth(tx, m);
    const spent = Object.values(spentByCategory(mtx, cats)).reduce((a, b) => a + b, 0);
    return { month: m, label: monthShort(m), income: incomeOf(mtx), spent };
  });
}

/** Sum of everyday spend between two days of the current month (inclusive). */
export function spendBetween(tx: Transaction[], cats: Category[], fromIso: string, toIso: string, category?: string) {
  const spend = spendSet(cats);
  return tx
    .filter((t) => spend.has(t.category_id) && (!category || t.category_id === category) && t.date >= fromIso && t.date <= toIso)
    .reduce((a, t) => a - t.amount_paise, 0);
}

export function shiftDays(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export type Insight = { id: string; tone: "good" | "bad" | "warn" | "info"; glyph: string; title: string; body: string; href?: string };

export function insights(v: ReturnType<typeof monthView>, tx: Transaction[], cats: Category[]): Insight[] {
  const out: Insight[] = [];
  if (v.unreviewed)
    out.push({ id: "review", tone: "warn", glyph: "●", title: `${v.unreviewed} transaction${v.unreviewed > 1 ? "s" : ""} to review`, body: "Check categories so reports stay accurate. Swipe right in Activity to approve.", href: "/activity?filter=review" });

  if (v.spent > 0) {
    const diff = v.budgetTotal - v.projected;
    out.push(
      diff >= 0
        ? { id: "proj", tone: "good", glyph: "↗", title: `On course to finish ${fmt(diff)} under budget`, body: `Projected spend this month is ${fmt(v.projected)} at your current daily pace.` }
        : { id: "proj", tone: "bad", glyph: "!", title: `Heading ${fmt(-diff)} over budget`, body: `Projected spend this month is ${fmt(v.projected)} at your current daily pace.` },
    );
  }

  // Biggest week-over-week swing among everyday categories.
  const end = v.today, mid = shiftDays(end, -7), start = shiftDays(end, -14);
  const swings = ["food", "groc", "shop", "fun", "trans"]
    .map((c) => ({ c, now: spendBetween(tx, cats, shiftDays(mid, 1), end, c), before: spendBetween(tx, cats, shiftDays(start, 1), mid, c) }))
    .filter((s) => s.before > 0 && s.now > 0)
    .map((s) => ({ ...s, pct: Math.round((s.now / s.before - 1) * 100) }))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const s = swings[0];
  if (s && Math.abs(s.pct) >= 15) {
    const name = cats.find((c) => c.id === s.c)?.name ?? s.c;
    out.push({ id: "wow", tone: s.pct > 0 ? "warn" : "good", glyph: s.pct > 0 ? "▲" : "▼", title: `${name} is ${s.pct > 0 ? "up" : "down"} ${Math.abs(s.pct)}% this week`, body: `${fmt(s.now)} in the last 7 days vs ${fmt(s.before)} the week before.` });
  }

  const unsorted = inMonth(tx, v.month).filter((t) => t.category_id === "uncat" && t.amount_paise < 0);
  if (unsorted.length) {
    const total = -unsorted.reduce((a, t) => a + t.amount_paise, 0);
    out.push({ id: "uncat", tone: "warn", glyph: "?", title: `${fmt(total)} isn't sorted yet`, body: `${unsorted.length} spend${unsorted.length === 1 ? "" : "s"} this month ${unsorted.length === 1 ? "has" : "have"} no category. File them so budgets and insights are right.`, href: "/activity?filter=uncat" });
  }

  const subs = v.recurring.filter((r) => r.category_id === "subs");
  if (subs.length) {
    const total = subs.reduce((a, r) => a + r.amount, 0);
    const top = [...subs].sort((a, b) => b.amount - a.amount)[0];
    out.push({ id: "subs", tone: "info", glyph: "↻", title: `Subscriptions cost ${fmt(total * 12)} a year`, body: `${top.name} is the priciest at ${fmt(top.amount)} a month. ${subs.length} active.` });
  }

  const noSpend = Array.from({ length: v.day }, (_, i) => i + 1).filter((d) => !v.dayTotals[d]).length;
  out.push({ id: "nospend", tone: "info", glyph: "◎", title: `${noSpend} no-spend day${noSpend === 1 ? "" : "s"} this month`, body: "Days with no everyday spending. Bills and subscriptions don't count." });
  return out;
}

export function netWorth(accounts: Account[]) {
  const assets = accounts.filter((a) => a.balance_paise > 0).reduce((s, a) => s + a.balance_paise, 0);
  const liabilities = -accounts.filter((a) => a.balance_paise < 0).reduce((s, a) => s + a.balance_paise, 0);
  return { assets, liabilities, total: assets - liabilities };
}

const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const fmt = (p: number) => "₹" + nf.format(Math.round(Math.abs(p) / 100));
