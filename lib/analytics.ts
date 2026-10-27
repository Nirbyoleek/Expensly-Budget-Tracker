import { addMonths, dayOf, daysInMonth, monthLong, monthShort, monthStart } from "./dates";
import { FIXED_CATS, incomeOf, inMonth, resolveBudgets, shiftDays, spentByCategory } from "./finance";
import { TAXONOMY_BY_ID, groupFor, subName, type Group } from "./taxonomy";
import type { BudgetRow, Category, IncomePlanRow, Transaction } from "./types";
import { incomeStatus, resolvePlan, type IncomePlan, type IncomeStatus } from "./income";

/**
 * The deeper analysis behind the Insights tab. Pure functions over plain rows.
 * All amounts are paise; "spend" means money out in a spend category, net of refunds.
 */

const DAY = 86400000;
const toMs = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);
/** 0 = Monday … 6 = Sunday */
export const weekdayOf = (iso: string) => (new Date(toMs(iso)).getUTCDay() + 6) % 7;
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mkey = (name: string) => name.trim().toLowerCase();

function spendIds(cats: Category[]) {
  return new Set(cats.filter((c) => c.kind === "spend").map((c) => c.id));
}
/** Money-out rows in spend categories. */
function outflows(tx: Transaction[], cats: Category[]) {
  const s = spendIds(cats);
  return tx.filter((t) => t.amount_paise < 0 && s.has(t.category_id));
}
const isEveryday = (t: Transaction) => !FIXED_CATS.has(t.category_id) && t.category_id !== "fees" && !(t.category_id === "bills");

/* ───────────────────────── category & subcategory breakdown ───────────────────────── */

export type SubSlice = { id: string | null; name: string; total: number; count: number };
export type CategoryBreakdown = {
  id: string; name: string; color: string; group: Group;
  total: number; count: number;
  /** Average of the three months before this one, full months. */
  avg3: number;
  /** Same days of last month, for a fair "so far" comparison. */
  lastMonthToDate: number;
  subs: SubSlice[];
  topMerchants: { name: string; total: number; count: number }[];
};

export function categoryBreakdown(tx: Transaction[], cats: Category[], today: string): CategoryBreakdown[] {
  const month = monthStart(today), day = dayOf(today);
  const cur = inMonth(tx, month);
  const spent = spentByCategory(cur, cats);
  const prev = [1, 2, 3].map((k) => spentByCategory(inMonth(tx, addMonths(month, -k)), cats));
  const lastStart = addMonths(month, -1);
  const lastToDate = spentByCategory(tx.filter((t) => t.date >= lastStart && t.date <= `${lastStart.slice(0, 8)}${String(Math.min(day, daysInMonth(lastStart))).padStart(2, "0")}`), cats);
  return cats
    .filter((c) => c.kind === "spend" && ((spent[c.id] ?? 0) > 0 || prev.some((p) => (p[c.id] ?? 0) > 0)))
    .map((c) => {
      const rows = cur.filter((t) => t.category_id === c.id);
      const subMap = new Map<string, SubSlice>();
      const merch = new Map<string, { name: string; total: number; count: number }>();
      for (const t of rows) {
        const k = t.subcategory_id ?? "";
        const s = subMap.get(k) ?? { id: t.subcategory_id, name: subName(c.id, t.subcategory_id) ?? "Other", total: 0, count: 0 };
        s.total -= t.amount_paise;
        if (t.amount_paise < 0) s.count++;
        subMap.set(k, s);
        const m = merch.get(mkey(t.merchant_name)) ?? { name: t.merchant_name, total: 0, count: 0 };
        m.total -= t.amount_paise;
        if (t.amount_paise < 0) m.count++;
        merch.set(mkey(t.merchant_name), m);
      }
      const nonEmptyPrev = prev.filter((p) => p !== undefined);
      return {
        id: c.id, name: c.name, color: c.color, group: groupFor(c.id, cats),
        total: spent[c.id] ?? 0,
        count: rows.filter((t) => t.amount_paise < 0).length,
        avg3: Math.round(sum(nonEmptyPrev.map((p) => p[c.id] ?? 0)) / 3),
        lastMonthToDate: lastToDate[c.id] ?? 0,
        subs: [...subMap.values()].filter((s) => s.total > 0).sort((a, b) => b.total - a.total),
        topMerchants: [...merch.values()].filter((m) => m.total > 0).sort((a, b) => b.total - a.total).slice(0, 5),
      };
    })
    .sort((a, b) => b.total - a.total);
}

/* ───────────────────────── needs, wants, savings ───────────────────────── */

export type Split = { needs: number; wants: number; avoidable: number; savings: number; income: number };

export function needsWants(tx: Transaction[], cats: Category[], month: string): Split {
  const m = inMonth(tx, month);
  const spent = spentByCategory(m, cats);
  const out: Split = { needs: 0, wants: 0, avoidable: 0, savings: 0, income: incomeOf(m) };
  for (const [id, v] of Object.entries(spent)) {
    const g = groupFor(id, cats);
    if (g === "needs" || g === "wants" || g === "avoidable") out[g] += v;
  }
  out.savings = Math.max(0, -sum(m.filter((t) => t.category_id === "invest").map((t) => t.amount_paise)));
  return out;
}

/* ───────────────────────── merchants ───────────────────────── */

export type MerchantStat = {
  key: string; name: string; category_id: string; subcategory_id: string | null;
  total: number; count: number; avg: number; first: string; last: string;
  /** Spend per month, oldest first, over `months`. */
  byMonth: number[];
  /** Change this month vs the average of the earlier months, as a fraction. */
  trend: number | null;
};

export function merchantStats(tx: Transaction[], cats: Category[], today: string, months = 6): MerchantStat[] {
  const cur = monthStart(today);
  const monthList = Array.from({ length: months }, (_, i) => addMonths(cur, i - months + 1));
  const map = new Map<string, Transaction[]>();
  for (const t of outflows(tx, cats)) {
    if (t.date < monthList[0]) continue;
    const k = mkey(t.merchant_name);
    map.set(k, [...(map.get(k) ?? []), t]);
  }
  const out: MerchantStat[] = [];
  for (const [key, list] of map) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const byMonth = monthList.map((m) => -sum(list.filter((t) => t.date.startsWith(m.slice(0, 7))).map((t) => t.amount_paise)));
    const total = sum(byMonth);
    const earlier = byMonth.slice(0, -1).filter((v) => v > 0);
    const latest = list[list.length - 1];
    out.push({
      key, name: latest.merchant_name, category_id: latest.category_id, subcategory_id: latest.subcategory_id,
      total, count: list.length, avg: Math.round(total / list.length), first: list[0].date, last: latest.date,
      byMonth,
      trend: earlier.length >= 2 ? byMonth[byMonth.length - 1] / (sum(earlier) / earlier.length) - 1 : null,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

/* ───────────────────────── recurring payments ───────────────────────── */

export type Cadence = "weekly" | "monthly" | "quarterly" | "yearly";
export type RecurringItem = {
  key: string; name: string; category_id: string; subcategory_id: string | null;
  cadence: Cadence; amount: number; monthly: number; last: string; next: string;
  count: number; variable: boolean;
  /** Latest charge vs the one before, when it went up or down by more than 3%. */
  priceChange: { from: number; to: number; date: string } | null;
  dueSoon: boolean;
};

const CADENCES: [Cadence, number, number, number][] = [
  // name, min gap, max gap, typical days
  ["weekly", 5, 9, 7],
  ["monthly", 25, 36, 30],
  ["quarterly", 80, 100, 91],
  ["yearly", 340, 390, 365],
];
const VARIABLE_SUBS = new Set(["electricity", "water", "gas", "mobile", "fuel"]);
const NEVER_RECURRING = new Set(["food", "groc", "trans", "shop", "fun", "people", "cash", "fees", "travel"]);

export function recurringPayments(tx: Transaction[], cats: Category[], today: string): RecurringItem[] {
  const groups = new Map<string, Transaction[]>();
  const spend = spendIds(cats);
  for (const t of tx) {
    if (t.amount_paise >= 0 || t.date > today) continue;
    if (!spend.has(t.category_id) && t.category_id !== "invest") continue;
    if (NEVER_RECURRING.has(t.category_id)) continue;
    const k = mkey(t.merchant_name);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: RecurringItem[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const gaps = list.slice(1).map((t, i) => daysBetween(list[i].date, t.date)).filter((g) => g > 2);
    if (!gaps.length) continue;
    const g = median(gaps);
    const cad = CADENCES.find(([, lo, hi]) => g >= lo && g <= hi);
    if (!cad) continue;
    if (cad[0] === "weekly" && list.length < 3) continue;
    const amounts = list.map((t) => -t.amount_paise);
    const med = median(amounts);
    const latest = list[list.length - 1];
    // Judge steadiness on the earlier charges: a single new price is a price change, not noise.
    const earlier = amounts.slice(0, -1), emed = median(earlier);
    const variable = VARIABLE_SUBS.has(latest.subcategory_id ?? "") || earlier.some((a) => Math.abs(a - emed) > emed * 0.25) || Math.abs(amounts[amounts.length - 1] - emed) > emed * 0.6;
    // Very irregular amounts that aren't utilities aren't a subscription.
    if (variable && !VARIABLE_SUBS.has(latest.subcategory_id ?? "") && latest.category_id !== "bills") continue;
    const prevAmt = amounts.length >= 2 ? amounts[amounts.length - 2] : null;
    const curAmt = amounts[amounts.length - 1];
    const priceChange = !variable && prevAmt && Math.abs(curAmt - prevAmt) > prevAmt * 0.03 ? { from: prevAmt, to: curAmt, date: latest.date } : null;
    let next = shiftDays(latest.date, cad[3]);
    if (cad[0] === "monthly") {
      // same day next month reads better than +30 days
      const nm = addMonths(monthStart(latest.date), 1);
      next = `${nm.slice(0, 8)}${String(Math.min(dayOf(latest.date), daysInMonth(nm))).padStart(2, "0")}`;
    }
    // A monthly charge that missed two cycles has probably been cancelled.
    if (daysBetween(latest.date, today) > cad[3] * 1.8) continue;
    const amount = variable ? med : curAmt;
    const monthly = Math.round(amount * (30.4 / cad[3]));
    const until = daysBetween(today, next);
    out.push({ key, name: latest.merchant_name, category_id: latest.category_id, subcategory_id: latest.subcategory_id, cadence: cad[0], amount, monthly, last: latest.date, next, count: list.length, variable, priceChange, dueSoon: until >= 0 && until <= 7 });
  }
  return out.sort((a, b) => a.next.localeCompare(b.next));
}

/* ───────────────────────── unusual activity ───────────────────────── */

export type Alert = { id: string; kind: "unusual" | "duplicate" | "new" | "price" | "fees" | "big"; title: string; body: string; tx?: Transaction };

export function unusualActivity(tx: Transaction[], cats: Category[], today: string, recurring: RecurringItem[]): Alert[] {
  const month = monthStart(today);
  const out: Alert[] = [];
  const flows = outflows(tx, cats);
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of flows) byMerchant.set(mkey(t.merchant_name), [...(byMerchant.get(mkey(t.merchant_name)) ?? []), t]);
  const recurringKeys = new Set(recurring.map((r) => r.key));
  const recent = flows.filter((t) => t.date >= shiftDays(today, -30));

  // Much bigger than usual at a merchant you use often: the biggest one per merchant, not every one
  const flagged = new Set<string>();
  for (const t of [...recent].sort((a, b) => a.amount_paise - b.amount_paise)) {
    if (flagged.has(mkey(t.merchant_name))) continue;
    const hist = (byMerchant.get(mkey(t.merchant_name)) ?? []).filter((h) => h.id !== t.id && h.date < t.date);
    if (hist.length < 3) continue;
    const med = median(hist.map((h) => -h.amount_paise));
    if (-t.amount_paise > med * 2.5 && -t.amount_paise - med > 50000) {
      flagged.add(mkey(t.merchant_name));
      out.push({ id: `u-${t.id}`, kind: "unusual", title: `${(-t.amount_paise / med).toFixed(1)}× your usual at ${t.merchant_name}`, body: `${fmt(-t.amount_paise)} on ${t.date.slice(8)} ${monthShort(t.date)}; you normally spend about ${fmt(med)} there.`, tx: t });
    }
  }

  // Same merchant, same amount, within two days: maybe charged twice
  const seen = new Map<string, Transaction>();
  for (const t of [...recent].sort((a, b) => a.date.localeCompare(b.date))) {
    if (-t.amount_paise < 10000) continue; // ₹100 chai twice a day is normal
    const k = `${mkey(t.merchant_name)}|${t.amount_paise}`;
    const prev = seen.get(k);
    if (prev && daysBetween(prev.date, t.date) <= 2 && !recurringKeys.has(mkey(t.merchant_name)) && t.category_id !== "food" && t.category_id !== "trans")
      out.push({ id: `d-${t.id}`, kind: "duplicate", title: `Charged twice by ${t.merchant_name}?`, body: `Two charges of ${fmt(-t.amount_paise)} ${prev.date === t.date ? "on the same day" : "a day apart"}. Worth checking if you only bought once.`, tx: t });
    seen.set(k, t);
  }

  // A big first purchase somewhere new
  for (const t of recent) {
    if (-t.amount_paise < 300000 || t.date < month || !["shop", "fun", "travel", "food", "care", "home", "edu", "gym"].includes(t.category_id)) continue;
    const earlier = (byMerchant.get(mkey(t.merchant_name)) ?? []).filter((h) => h.date < t.date);
    if (!earlier.length) out.push({ id: `n-${t.id}`, kind: "new", title: `First time at ${t.merchant_name}`, body: `${fmt(-t.amount_paise)}, your first payment there in six months.`, tx: t });
  }

  for (const r of recurring) {
    if (r.priceChange && r.priceChange.to > r.priceChange.from && daysBetween(r.priceChange.date, today) <= 45)
      out.push({ id: `p-${r.key}`, kind: "price", title: `${r.name} went up ${Math.round((r.priceChange.to / r.priceChange.from - 1) * 100)}%`, body: `Now ${fmt(r.priceChange.to)} ${r.cadence === "monthly" ? "a month" : r.cadence === "yearly" ? "a year" : "each time"}, was ${fmt(r.priceChange.from)}. That's ${fmt((r.priceChange.to - r.priceChange.from) * (365 / CADENCES.find((c) => c[0] === r.cadence)![3]))} more a year.` });
  }
  return out;
}

/* ───────────────────────── fees & interest ───────────────────────── */

export function feesSummary(tx: Transaction[], today: string, months = 6) {
  const from = addMonths(monthStart(today), -(months - 1));
  const rows = tx.filter((t) => t.category_id === "fees" && t.date >= from);
  const bySub = new Map<string, number>();
  for (const t of rows) bySub.set(t.subcategory_id ?? "bank", (bySub.get(t.subcategory_id ?? "bank") ?? 0) - t.amount_paise);
  const thisMonth = -sum(rows.filter((t) => t.date >= monthStart(today)).map((t) => t.amount_paise));
  return {
    total: -sum(rows.map((t) => t.amount_paise)),
    thisMonth,
    bySub: [...bySub.entries()].map(([id, total]) => ({ id, name: subName("fees", id) ?? "Charges", total })).filter((s) => s.total > 0).sort((a, b) => b.total - a.total),
    count: rows.length,
  };
}

/* ───────────────────────── when you spend ───────────────────────── */

export function weekdayPattern(tx: Transaction[], cats: Category[], today: string, days = 90) {
  const flows = outflows(tx, cats);
  // Don't count days before your first transaction as zero-spend days.
  const first = flows.reduce((m, t) => (t.date < m ? t.date : m), today);
  const from = [shiftDays(today, -days + 1), first].sort().reverse()[0];
  const span = Math.max(1, daysBetween(from, today) + 1);
  const totals = Array(7).fill(0), counts = Array(7).fill(0);
  // One-off big purchases (over ₹5,000) aren't "everyday": they'd inflate every future day.
  for (const t of flows) if (t.date >= from && t.date <= today && isEveryday(t) && -t.amount_paise <= 500000) totals[weekdayOf(t.date)] -= t.amount_paise;
  // how many of each weekday are in the window
  for (let i = 0; i < span; i++) counts[weekdayOf(shiftDays(today, -i))]++;
  const avg = totals.map((v, i) => Math.round(v / Math.max(1, counts[i])));
  const weekday = sum(avg.slice(0, 5)) / 5, weekend = (avg[5] + avg[6]) / 2;
  const peak = avg.indexOf(Math.max(...avg));
  return { avg, peak, weekendRatio: weekday > 0 ? weekend / weekday : null };
}

/** Share of a month's everyday spend in the first, middle and last ten days, averaged over full months. */
export function monthThirds(tx: Transaction[], cats: Category[], today: string) {
  const cur = monthStart(today);
  const parts = [0, 0, 0];
  for (const t of outflows(tx, cats)) {
    if (t.date >= cur || !isEveryday(t)) continue;
    const d = dayOf(t.date);
    parts[d <= 10 ? 0 : d <= 20 ? 1 : 2] -= t.amount_paise;
  }
  const total = sum(parts);
  return total ? parts.map((p) => p / total) : null;
}

/** Days with no everyday spend: current streak and longest this month. */
export function noSpendStreaks(tx: Transaction[], cats: Category[], today: string) {
  const month = monthStart(today);
  const spentDays = new Set(outflows(tx, cats).filter((t) => isEveryday(t) && t.date >= month).map((t) => t.date));
  let current = 0;
  for (let d = today; d >= month && !spentDays.has(d); d = shiftDays(d, -1)) current++;
  let longest = 0, run = 0;
  for (let i = 1; i <= dayOf(today); i++) {
    const iso = `${month.slice(0, 8)}${String(i).padStart(2, "0")}`;
    run = spentDays.has(iso) ? 0 : run + 1;
    longest = Math.max(longest, run);
  }
  return { current, longest, days: dayOf(today) - spentDays.size };
}

/* ───────────────────────── forecast ───────────────────────── */

/**
 * Month-end spend: what's spent, plus recurring payments still due, plus everyday spend for each
 * remaining day at that weekday's recent average (Saturdays cost more than Tuesdays).
 */
export function forecastMonth(tx: Transaction[], cats: Category[], today: string, recurring: RecurringItem[]) {
  const month = monthStart(today), dim = daysInMonth(today), day = dayOf(today);
  const spent = sum(Object.values(spentByCategory(inMonth(tx, month), cats)));
  const { avg } = weekdayPattern(tx, cats, shiftDays(today, -1), 56);
  let everyday = 0;
  for (let d = day + 1; d <= dim; d++) everyday += avg[weekdayOf(`${month.slice(0, 8)}${String(d).padStart(2, "0")}`)];
  const end = `${month.slice(0, 8)}${dim}`;
  const due = recurring.filter((r) => r.next > today && r.next <= end && r.category_id !== "invest");
  const dueTotal = sum(due.map((r) => r.amount));
  return { spent, everyday, dueTotal, due, total: spent + everyday + dueTotal };
}

/* ───────────────────────── financial health ───────────────────────── */

export type HealthStatus = "great" | "ok" | "work" | "unknown";
export type HealthPart = {
  id: string; label: string; score: number; max: number;
  /** Where you are, in plain words. */
  note: string;
  /** The headline figure, e.g. "−57%" or "5.7×". */
  value: string;
  /** What full marks looks like. */
  target: string;
  /** One concrete thing to do next, when there's something to do. */
  fix: string | null;
  href: string | null;
  action: string | null;
  status: HealthStatus;
};

const statusOf = (score: number, max: number, known = true): HealthStatus => (!known ? "unknown" : score >= max * 0.8 ? "great" : score >= max * 0.4 ? "ok" : "work");

export function healthScore(args: { tx: Transaction[]; cats: Category[]; budgetRows: BudgetRow[]; today: string; forecast: number; plan?: IncomePlan | null }) {
  const { tx, cats, today } = args;
  const month = monthStart(today);
  const prevMonths = [1, 2, 3].map((k) => addMonths(month, -k));
  const splits = [month, ...prevMonths].map((m) => needsWants(tx, cats, m));
  const avgIncome = sum(splits.map((s) => s.income)) / splits.filter((s) => s.income > 0).length || 0;
  const cur = splits[0];
  const plan = args.plan ?? null;
  const income = plan ? Math.max(plan.total, cur.income) : Math.max(cur.income, avgIncome);
  const spentAll = cur.needs + cur.wants + cur.avoidable;
  const parts: HealthPart[] = [];
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const pctTxt = (x: number) => `${x < 0 ? "−" : ""}${Math.abs(Math.round(x * 100))}%`;

  // 1. Savings: this month against your goal when you've told us your income, else last month.
  if (plan) {
    const goal = Math.max(0.05, plan.savings_goal_pct / 100);
    const left = income - args.forecast;
    const r = left / income;
    const score = Math.round(30 * clamp(r / goal));
    const cut = Math.max(0, Math.round(goal * income - left));
    parts.push({
      id: "save", label: "Savings rate", max: 30, score, status: statusOf(score, 30), value: pctTxt(r), target: `Keep ${plan.savings_goal_pct}% (${fmt(goal * income)})`,
      note: left < 0 ? `On course to spend ${fmt(-left)} more than your ${fmt(income)} income this month.` : `On course to keep ${fmt(left)} of ${fmt(income)} this month.`,
      fix: score >= 30 ? null : `Spend ${fmt(cut)} less this month to reach your goal.`,
      href: "/insights#categories", action: "See where it's going",
    });
  } else {
    const last = splits[1];
    const lastSpent = last.needs + last.wants + last.avoidable;
    const rate = last.income > 0 ? (last.income - lastSpent) / last.income : null;
    const score = rate === null ? 15 : Math.round(30 * clamp(rate / 0.25));
    parts.push({
      id: "save", label: "Savings rate", max: 30, score, status: statusOf(score, 30, rate !== null), value: rate === null ? "—" : pctTxt(rate), target: "Keep 25% or more",
      note: rate === null ? "Expensly doesn't know your income yet, so this is a neutral guess." : rate < 0 ? `Last month you spent ${fmt(lastSpent - last.income)} more than came in.` : `Last month you kept ${fmt(last.income - lastSpent)} of ${fmt(last.income)}.`,
      fix: rate === null ? "Add your monthly income to score this properly." : score >= 30 ? null : "Set a savings goal so Expensly can pace your spending.",
      href: "/insights#income", action: rate === null ? "Add income" : "Set a goal",
    });
  }

  // 2. Budget pace: only categories that have a budget, so spending elsewhere can't sink it.
  const budgets = resolveBudgets(args.budgetRows, cats, month);
  const spentNow = spentByCategory(inMonth(tx, month), cats);
  const budgeted = Object.keys(budgets).filter((id) => budgets[id] > 0);
  const budgetTotal = sum(budgeted.map((id) => budgets[id]));
  const spentNowTotal = sum(Object.values(spentNow));
  const scale = spentNowTotal > 0 ? Math.max(1, args.forecast / spentNowTotal) : 1; // how much more the month is likely to add
  const projected = sum(budgeted.map((id) => spentNow[id] ?? 0)) * scale;
  const ratio = budgetTotal ? projected / budgetTotal : null;
  const over = budgeted.filter((id) => (spentNow[id] ?? 0) > budgets[id]).map((id) => cats.find((c) => c.id === id)?.name ?? id);
  const outside = sum(Object.entries(spentNow).filter(([id]) => !(budgets[id] > 0)).map(([, v]) => v));
  {
    const score = ratio === null ? 10 : Math.round(20 * clamp((1.4 - ratio) / 0.4));
    parts.push({
      id: "budget", label: "Budget pace", max: 20, score, status: statusOf(score, 20, ratio !== null),
      value: ratio === null ? "—" : ratio >= 2 ? `${ratio.toFixed(1)}×` : pctTxt(ratio), target: "Finish at or under budget",
      note: ratio === null ? "No budgets set yet." : `Heading for ${fmt(projected)} against ${fmt(budgetTotal)} budgeted${over.length ? `; ${over.slice(0, 2).join(" and ")}${over.length > 2 ? ` +${over.length - 2}` : ""} already over` : ""}.${outside > 0 ? ` ${fmt(outside)} more went to categories with no budget.` : ""}`,
      fix: ratio === null ? "Set budgets for the categories you spend most in." : ratio > 1 ? (budgetTotal < spentNowTotal * 0.5 ? "Your budgets cover only part of your spending. Set realistic ones for every big category." : "Slow down in the categories that are over, or raise budgets that were set too low.") : null,
      href: "/budgets", action: ratio === null ? "Set budgets" : "Open budgets",
    });
  }

  // 3. Fees and interest: money that buys nothing.
  {
    const feeShare = spentAll ? cur.avoidable / spentAll : 0;
    const score = Math.round(15 * clamp(1 - feeShare / 0.03));
    parts.push({
      id: "fees", label: "Avoidable fees", max: 15, score, status: statusOf(score, 15), value: cur.avoidable ? fmt(cur.avoidable) : "₹0", target: "Under 3% of spending",
      note: cur.avoidable ? `${fmt(cur.avoidable)} in interest, late fees and charges this month (${pctTxt(feeShare)} of spending).` : "No interest or late fees this month.",
      fix: cur.avoidable ? "Pay card bills in full by the due date and turn on autopay for the minimum, so interest never starts." : null,
      href: "/activity?cat=fees", action: cur.avoidable ? "See the charges" : null,
    });
  }

  // 4. Wants against income.
  {
    const share = income ? cur.wants / income : null;
    const score = share === null ? 8 : Math.round(15 * clamp((0.5 - share) / 0.2));
    parts.push({
      id: "wants", label: "Wants vs income", max: 15, score, status: statusOf(score, 15, share !== null), value: share === null ? "—" : pctTxt(share), target: "Under 30% of income",
      note: share === null ? "Add your income to see this." : share >= 1 ? `${fmt(cur.wants)} on wants, more than your whole ${fmt(income)} income.` : `${fmt(cur.wants)} on wants so far, out of ${fmt(income)} income.`,
      fix: share === null ? "Add your monthly income." : share > 0.3 ? `Bring wants down by ${fmt(cur.wants - income * 0.3)} to get full marks.` : null,
      href: share === null ? "/insights#income" : "/insights#categories", action: share === null ? "Add income" : "See your wants",
    });
  }

  // 5. Investing in each of the last three months.
  {
    const invested = splits.slice(0, 3).filter((s) => s.savings > 0).length;
    const score = Math.round((10 * invested) / 3);
    parts.push({
      id: "invest", label: "Investing", max: 10, score, status: statusOf(score, 10), value: `${invested} of 3 months`, target: "Invest every month",
      note: invested ? `You invested in ${invested} of the last 3 months.` : "No SIPs or investments seen in the last 3 months.",
      fix: invested === 3 ? null : invested ? "Make it automatic with a monthly SIP." : "Start a monthly SIP, even ₹500, and point a goal at it.",
      href: "/wealth", action: invested === 3 ? null : "Set up a goal",
    });
  }

  // 6. Keeping up: transactions waiting for a look.
  {
    const recent = tx.filter((t) => t.date >= addMonths(month, -1));
    const unreviewed = recent.filter((t) => !t.reviewed).length;
    const score = Math.round(10 * clamp(1 - unreviewed / Math.max(10, recent.length * 0.2)));
    parts.push({
      id: "review", label: "Up to date", max: 10, score, status: statusOf(score, 10), value: unreviewed ? `${unreviewed} to check` : "All done", target: "Nothing waiting",
      note: unreviewed ? `${unreviewed} transaction${unreviewed > 1 ? "s" : ""} waiting for a quick check.` : "Everything is reviewed.",
      fix: unreviewed ? "A minute of swiping keeps every number here accurate." : null,
      href: "/activity?filter=review", action: unreviewed ? "Review now" : null,
    });
  }

  const score = sum(parts.map((p) => p.score));
  const label = score >= 80 ? "Excellent" : score >= 65 ? "Healthy" : score >= 45 ? "Fair" : "Needs attention";
  // The single change worth the most points.
  const top = [...parts].filter((p) => p.fix && p.max - p.score > 0).sort((a, b) => b.max - b.score - (a.max - a.score))[0] ?? null;
  return { score, label, parts, top: top ? { id: top.id, label: top.label, gain: top.max - top.score, fix: top.fix!, href: top.href, action: top.action } : null };
}

/* ───────────────────────── the month in words ───────────────────────── */

export function monthStory(a: { today: string; breakdown: CategoryBreakdown[]; fees: ReturnType<typeof feesSummary>; weekday: ReturnType<typeof weekdayPattern>; streaks: ReturnType<typeof noSpendStreaks>; forecast: ReturnType<typeof forecastMonth>; merchants: MerchantStat[]; tx: Transaction[]; cats: Category[] }): string[] {
  const out: string[] = [];
  const month = monthStart(a.today), day = dayOf(a.today);
  const spent = sum(a.breakdown.map((b) => b.total));
  const lastToDate = sum(a.breakdown.map((b) => b.lastMonthToDate));
  if (spent) {
    const diff = spent - lastToDate;
    out.push(
      `${monthLong(month).split(" ")[0]} so far: ${fmt(spent)} spent in ${day} day${day > 1 ? "s" : ""}` +
        (lastToDate ? `, ${fmt(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than the same point last month.` : "."),
    );
  }
  const subs = a.breakdown.flatMap((b) => b.subs.filter((s) => s.id).map((s) => ({ ...s, cat: b.id })));
  const topSub = subs.sort((x, y) => y.total - x.total)[0];
  if (topSub && TAXONOMY_BY_ID[topSub.cat]?.group !== "needs")
    out.push(`${topSub.name} is your biggest want: ${fmt(topSub.total)} across ${topSub.count} payment${topSub.count === 1 ? "" : "s"}.`);
  const grew = a.breakdown.filter((b) => b.avg3 > 50000 && b.total > b.avg3 * 1.2 && b.group !== "needs").sort((x, y) => y.total - y.avg3 - (x.total - x.avg3))[0];
  if (grew) out.push(`${grew.name} has already passed your 3-month average of ${fmt(grew.avg3)} by ${fmt(grew.total - grew.avg3)}.`);
  if (a.fees.thisMonth > 0) out.push(`${fmt(a.fees.thisMonth)} went to interest, GST and card fees: money that buys nothing.`);
  if (a.weekday.weekendRatio && a.weekday.weekendRatio > 1.3) out.push(`Weekends cost you ${a.weekday.weekendRatio.toFixed(1)}× a weekday. ${WEEKDAY_LONG[a.weekday.peak]}s are the priciest.`);
  if (a.streaks.longest >= 3) out.push(`Longest no-spend run this month: ${a.streaks.longest} days.`);
  const delivery = a.merchants.filter((m) => m.subcategory_id === "delivery");
  const orders = sum(delivery.map((m) => m.byMonth[m.byMonth.length - 1] > 0 ? a.tx.filter((t) => mkey(t.merchant_name) === m.key && t.date >= month && t.amount_paise < 0).length : 0));
  if (orders >= 4) out.push(`${orders} food delivery orders this month, about one every ${Math.max(1, Math.round(day / orders))} day${Math.round(day / orders) > 1 ? "s" : ""}.`);
  if (a.forecast.total > spent) out.push(`At this rate the month ends near ${fmt(a.forecast.total)}${a.forecast.dueTotal ? `, including ${fmt(a.forecast.dueTotal)} of bills still due` : ""}.`);
  return out;
}

const WEEKDAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/* ───────────────────────── everything at once ───────────────────────── */

export function analyse(args: { tx: Transaction[]; cats: Category[]; budgetRows: BudgetRow[]; today: string; incomePlans?: IncomePlanRow[] }) {
  const { tx, cats, today, budgetRows } = args;
  const month = monthStart(today);
  const plan = resolvePlan(args.incomePlans ?? [], month);
  const breakdown = categoryBreakdown(tx, cats, today);
  const merchants = merchantStats(tx, cats, today);
  const recurring = recurringPayments(tx, cats, today);
  const alerts = unusualActivity(tx, cats, today, recurring);
  const fees = feesSummary(tx, today);
  const weekday = weekdayPattern(tx, cats, today);
  const thirds = monthThirds(tx, cats, today);
  const streaks = noSpendStreaks(tx, cats, today);
  const forecast = forecastMonth(tx, cats, today, recurring);
  const health = healthScore({ tx, cats, budgetRows, today, forecast: forecast.total, plan });
  // Last month's score, judged on how the month actually ended, for a "since last month" arrow.
  const prevEnd = shiftDays(month, -1), prevMonth = monthStart(prevEnd);
  const prevSpent = sum(Object.values(spentByCategory(inMonth(tx, prevMonth), cats)));
  const healthPrev = tx.some((t) => t.date.startsWith(prevMonth.slice(0, 7)))
    ? healthScore({ tx: tx.filter((t) => t.date <= prevEnd), cats, budgetRows, today: prevEnd, forecast: Math.max(0, prevSpent), plan: resolvePlan(args.incomePlans ?? [], prevMonth) }).score
    : null;
  const split = needsWants(tx, cats, month);
  const income: IncomeStatus | null = plan
    ? incomeStatus({ plan, tx, today, forecastTotal: forecast.total, spentSoFar: forecast.spent, invested: split.savings, dueBills: forecast.dueTotal })
    : null;
  const splitLast = needsWants(tx, cats, addMonths(month, -1));
  const biggest = outflows(inMonth(tx, month), cats).sort((a, b) => a.amount_paise - b.amount_paise).slice(0, 5);
  const story = monthStory({ today, breakdown, fees, weekday, streaks, forecast, merchants, tx, cats });
  if (income) {
    const left = income.projectedLeft;
    story.splice(1, 0,
      left >= 0
        ? `On your ${fmt(income.plan.total)} income you're set to keep about ${fmt(left + split.savings)} this month (${Math.round(income.projectedRate * 100)}%)${income.goalGap >= 0 ? `, ahead of your ${income.plan.savings_goal_pct}% goal.` : `, ${fmt(-income.goalGap)} short of your ${income.plan.savings_goal_pct}% goal.`}`
        : `At this pace you'll spend ${fmt(-left)} more than your ${fmt(income.plan.total)} income this month.`,
    );
    if (!income.salaryArrived && income.daysToPayday !== null) story.push(`Salary is due in ${income.daysToPayday} day${income.daysToPayday === 1 ? "" : "s"}; it hasn't shown up in your statements yet.`);
  }
  return { income, breakdown, merchants, recurring, alerts, fees, weekday, thirds, streaks, forecast, health, healthPrev, split, splitLast, biggest, story };
}

export type Analysis = ReturnType<typeof analyse>;

/** Everything Expensly knows about one merchant, for the merchant sheet. */
export function merchantProfile(tx: Transaction[], name: string) {
  const k = mkey(name);
  const rows = tx.filter((t) => mkey(t.merchant_name) === k).sort((a, b) => b.date.localeCompare(a.date));
  const out = rows.filter((t) => t.amount_paise < 0);
  const total = -sum(out.map((t) => t.amount_paise));
  const refunds = sum(rows.filter((t) => t.amount_paise > 0).map((t) => t.amount_paise));
  const gaps = out.slice(1).map((t, i) => daysBetween(t.date, out[i].date)).filter((g) => g > 0);
  return {
    rows, total, refunds, count: out.length,
    avg: out.length ? Math.round(total / out.length) : 0,
    median: median(out.map((t) => -t.amount_paise)),
    largest: out.reduce<Transaction | null>((m, t) => (!m || t.amount_paise < m.amount_paise ? t : m), null),
    everyDays: gaps.length ? median(gaps) : null,
    first: rows[rows.length - 1]?.date ?? null,
    weekday: out.length >= 4 ? WEEKDAY_LONG[mode(out.map((t) => weekdayOf(t.date)))] : null,
  };
}

function mode(xs: number[]) {
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const fmt = (p: number) => "₹" + nf.format(Math.round(Math.abs(p) / 100));

/** The most useful few findings, as cards for the Overview rail. */
export function headlineInsights(a: Analysis): { id: string; tone: "good" | "bad" | "warn" | "info"; glyph: string; title: string; body: string; href?: string }[] {
  const out: ReturnType<typeof headlineInsights> = [];
  out.push({ id: "health", tone: a.health.score >= 65 ? "good" : a.health.score >= 45 ? "warn" : "bad", glyph: String(a.health.score), title: `Money health: ${a.health.label.toLowerCase()}`, body: [...a.health.parts].sort((x, y) => x.score / x.max - y.score / y.max)[0].note, href: "/insights" });
  if (a.income) {
    const i = a.income;
    out.push(i.goalGap >= 0
      ? { id: "income", tone: "good", glyph: "₹", title: `On track to save ${fmt(i.projectedLeft + a.split.savings)}`, body: `${Math.round(i.projectedRate * 100)}% of your income, above your ${i.plan.savings_goal_pct}% goal. Keep everyday spend under ${fmt(i.dailyAllowance)} a day.`, href: "/insights" }
      : { id: "income", tone: "warn", glyph: "₹", title: `${fmt(-i.goalGap)} short of your savings goal`, body: `Spend under ${fmt(i.dailyAllowance)} a day on everyday things to still save ${fmt(i.goal)} this month.`, href: "/insights" });
  } else {
    out.push({ id: "income", tone: "info", glyph: "₹", title: "Add your monthly income", body: "Tell Expensly your salary and payday for savings forecasts, a daily allowance and a fairer health score.", href: "/insights#income" });
  }
  for (const al of a.alerts.filter((x) => x.kind === "duplicate" || x.kind === "price").slice(0, 2))
    out.push({ id: al.id, tone: "bad", glyph: al.kind === "price" ? "↑" : "⧉", title: al.title, body: al.body, href: "/insights" });
  if (a.fees.thisMonth > 0) out.push({ id: "fees", tone: "bad", glyph: "!", title: `${fmt(a.fees.thisMonth)} lost to fees this month`, body: a.fees.bySub.map((f) => f.name.toLowerCase()).slice(0, 3).join(", ") + ". Paying the card in full avoids most of it.", href: "/activity?q=is:fees" });
  const topSub = a.breakdown.flatMap((b) => b.subs.filter((s) => s.id).map((s) => ({ ...s, b }))).sort((x, y) => y.total - x.total).find((s) => s.b.group === "wants");
  if (topSub) out.push({ id: "topsub", tone: "info", glyph: "◆", title: `${topSub.name}: ${fmt(topSub.total)} so far`, body: `${topSub.count} payments, your biggest want this month.`, href: `/activity?cat=${topSub.b.id}&sub=${topSub.id}` });
  return out;
}
