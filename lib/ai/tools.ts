import { analyse } from "@/lib/analytics";
import { addMonths, monthStart } from "@/lib/dates";
import { monthView, netWorth, resolveBudgets, spentByCategory, inMonth } from "@/lib/finance";
import { TAXONOMY, TAXONOMY_BY_ID, groupFor, subName } from "@/lib/taxonomy";
import type { Account, BudgetRow, Category, Goal, IncomePlanRow, Transaction } from "@/lib/types";

/**
 * Read-only tools Ask Expensly can call. They run on the server over data already loaded under the
 * signed-in user's row-level security, and return compact JSON in rupees (not paise) so the model
 * never has to convert. Nothing here can change data.
 */

export type AiContext = {
  today: string;
  tx: Transaction[];
  cats: Category[];
  budgetRows: BudgetRow[];
  accounts: Account[];
  goals: Goal[];
  incomePlans: IncomePlanRow[];
};

const r = (paise: number) => Math.round(paise / 100);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const weekday = (iso: string) => WEEKDAYS[(new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7];

const CATEGORY_LIST = TAXONOMY.map((c) => `${c.id} (${c.name}: ${c.subs.map((s) => s.id).join(", ")})`).join("; ");

export const TOOLS = [
  {
    name: "get_overview",
    description:
      "This month at a glance: spent so far, budget, safe-to-spend per day, projected month-end spend, planned income and savings, money health score with its parts, and unreviewed count. Call this first for any general question about how the month is going.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "query_transactions",
    description:
      "List individual transactions with filters. Amounts are rupees; negative = money out, positive = money in. Use for questions about specific purchases, merchants or dates. Returns at most `limit` rows plus totals over ALL matches.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date YYYY-MM-DD (inclusive)" },
        to: { type: "string", description: "End date YYYY-MM-DD (inclusive)" },
        category: { type: "string", description: `Category id. One of: ${CATEGORY_LIST}` },
        subcategory: { type: "string", description: "Subcategory id within the category" },
        merchant: { type: "string", description: "Case-insensitive substring of the merchant name" },
        direction: { type: "string", enum: ["out", "in", "any"] },
        min_amount: { type: "number", description: "Minimum absolute amount in rupees" },
        max_amount: { type: "number", description: "Maximum absolute amount in rupees" },
        sort: { type: "string", enum: ["newest", "oldest", "largest"] },
        limit: { type: "integer", minimum: 1, maximum: 60 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "spending_summary",
    description:
      "Totals of money OUT in spend categories (net of refunds; transfers, card bill payments and investments excluded), grouped one way, over a date range. Use for 'how much on X', comparisons between periods, trends by month, or habits by weekday.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
        group_by: { type: "string", enum: ["category", "subcategory", "merchant", "month", "weekday", "needs_wants"] },
        category: { type: "string", description: "Optional: only this category id" },
        top: { type: "integer", minimum: 1, maximum: 40 },
      },
      required: ["from", "to", "group_by"],
      additionalProperties: false,
    },
  },
  {
    name: "get_recurring",
    description: "Subscriptions, bills, EMIs and SIPs Expensly detected: cadence, amount, next expected date, monthly cost, and any recent price change.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_budgets",
    description: "Each category's monthly budget this month (0 = no budget set) against what's spent so far, plus the share of the month gone.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_alerts_and_patterns",
    description:
      "Unusual charges, possible double charges, first-time big merchants, price rises, fees and interest paid, weekday spending pattern, no-spend streaks, top merchants with 6-month trend, and categories above their 3-month average.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_accounts_and_goals",
    description: "Account balances (cards and loans negative), net worth, its recent history, and savings goals with progress and target dates.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

/** A short label for the UI while a tool runs. */
export const TOOL_LABEL: Record<ToolName, string> = {
  get_overview: "Checking this month",
  query_transactions: "Looking through transactions",
  spending_summary: "Adding up spending",
  get_recurring: "Checking subscriptions and bills",
  get_budgets: "Checking budgets",
  get_alerts_and_patterns: "Looking for patterns",
  get_accounts_and_goals: "Checking accounts and goals",
};

type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function runTool(name: string, input: Input, ctx: AiContext): unknown {
  const spendIds = new Set(ctx.cats.filter((c) => c.kind === "spend").map((c) => c.id));
  const catName = (id: string) => TAXONOMY_BY_ID[id]?.name ?? ctx.cats.find((c) => c.id === id)?.name ?? id;
  const month = monthStart(ctx.today);

  switch (name as ToolName) {
    case "get_overview": {
      const v = monthView(ctx);
      const a = analyse(ctx);
      return {
        today: ctx.today,
        days_left_in_month: v.daysLeft,
        spent_this_month: r(v.spent),
        spent_before_refunds_and_paybacks: r(v.grossSpent),
        income_received_this_month: r(v.income),
        money_in_this_month: {
          total: r(v.moneyIn.total), income: r(v.moneyIn.income), refunds: r(v.moneyIn.refunds),
          back_from_people: r(v.moneyIn.fromPeople), own_transfers_and_card_payments: r(v.moneyIn.transfers), investments_redeemed: r(v.moneyIn.investments),
          note: "spent_this_month is net: refunds and money back from people are already subtracted",
        },
        total_budget: r(v.budgetTotal),
        safe_to_spend_per_day: r(v.safePerDay),
        bills_still_due: r(v.upcomingTotal),
        forecast_month_end_spend: r(a.forecast.total),
        forecast_parts: { spent: r(a.forecast.spent), everyday_ahead: r(a.forecast.everyday), bills_due: r(a.forecast.dueTotal) },
        income_plan: a.income
          ? {
              monthly_income: r(a.income.plan.total),
              salary: r(a.income.plan.salary_paise),
              other_income: r(a.income.plan.other_paise),
              payday: a.income.plan.payday,
              salary_arrived: a.income.salaryArrived,
              days_to_payday: a.income.daysToPayday,
              savings_goal_percent: a.income.plan.savings_goal_pct,
              savings_goal: r(a.income.goal),
              projected_savings: r(Math.max(0, a.income.projectedLeft) + a.split.savings),
              projected_savings_rate_percent: Math.round(a.income.projectedRate * 100),
              daily_allowance_to_hit_goal: r(a.income.dailyAllowance),
            }
          : "Not set. Suggest adding it in Settings → Your income for savings forecasts.",
        needs_wants_this_month: { needs: r(a.split.needs), wants: r(a.split.wants), fees: r(a.split.avoidable), invested: r(a.split.savings) },
        health_score: { score: a.health.score, label: a.health.label, parts: a.health.parts.map((p) => ({ part: p.label, score: `${p.score}/${p.max}`, note: p.note })) },
        unreviewed_transactions: v.unreviewed,
        data_covers_from: addMonths(month, -5),
      };
    }

    case "query_transactions": {
      const from = str(input.from), to = str(input.to), cat = str(input.category), sub = str(input.subcategory);
      const merchant = str(input.merchant)?.toLowerCase(), dir = str(input.direction) ?? "any";
      const min = num(input.min_amount), max = num(input.max_amount);
      let rows = ctx.tx.filter((t) =>
        (!from || t.date >= from) && (!to || t.date <= to) &&
        (!cat || t.category_id === cat) && (!sub || t.subcategory_id === sub) &&
        (!merchant || t.merchant_name.toLowerCase().includes(merchant) || (t.note ?? "").toLowerCase().includes(merchant)) &&
        (dir === "any" || (dir === "out" ? t.amount_paise < 0 : t.amount_paise > 0)) &&
        (min === undefined || Math.abs(t.amount_paise) >= min * 100) && (max === undefined || Math.abs(t.amount_paise) <= max * 100),
      );
      const totalOut = -rows.filter((t) => t.amount_paise < 0).reduce((s, t) => s + t.amount_paise, 0);
      const totalIn = rows.filter((t) => t.amount_paise > 0).reduce((s, t) => s + t.amount_paise, 0);
      const sort = str(input.sort) ?? "newest";
      rows = [...rows].sort((a, b) => (sort === "largest" ? Math.abs(b.amount_paise) - Math.abs(a.amount_paise) : sort === "oldest" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
      const limit = Math.min(60, Math.max(1, num(input.limit) ?? 25));
      return {
        matches: rows.length,
        total_out: r(totalOut),
        total_in: r(totalIn),
        rows: rows.slice(0, limit).map((t) => ({
          date: t.date, day: weekday(t.date), merchant: t.merchant_name, amount: r(t.amount_paise),
          category: catName(t.category_id), subcategory: subName(t.category_id, t.subcategory_id) ?? undefined,
          note: t.note ?? undefined, reviewed: t.reviewed || undefined,
        })),
        truncated: rows.length > limit || undefined,
      };
    }

    case "spending_summary": {
      const from = str(input.from) ?? month, to = str(input.to) ?? ctx.today, only = str(input.category);
      const group = str(input.group_by) ?? "category";
      const rows = ctx.tx.filter((t) => spendIds.has(t.category_id) && t.date >= from && t.date <= to && (!only || t.category_id === only));
      const key = (t: Transaction) => {
        switch (group) {
          case "subcategory": return `${catName(t.category_id)} · ${subName(t.category_id, t.subcategory_id) ?? "Other"}`;
          case "merchant": return t.merchant_name;
          case "month": return t.date.slice(0, 7);
          case "weekday": return weekday(t.date);
          case "needs_wants": return groupFor(t.category_id, ctx.cats);
          default: return catName(t.category_id);
        }
      };
      const agg = new Map<string, { total: number; count: number }>();
      for (const t of rows) {
        const k = key(t), cur = agg.get(k) ?? { total: 0, count: 0 };
        cur.total -= t.amount_paise;
        if (t.amount_paise < 0) cur.count++;
        agg.set(k, cur);
      }
      let list = [...agg.entries()].map(([k, v]) => ({ [group]: k, total: r(Math.max(0, v.total)), payments: v.count }));
      if (group === "month") list.sort((a, b) => String(a.month).localeCompare(String(b.month)));
      else if (group === "weekday") list.sort((a, b) => WEEKDAYS.indexOf(String(a.weekday)) - WEEKDAYS.indexOf(String(b.weekday)));
      else list.sort((a, b) => b.total - a.total);
      const top = num(input.top);
      if (top && group !== "month" && group !== "weekday") list = list.slice(0, top);
      return { from, to, total: r(Math.max(0, -rows.reduce((s, t) => s + t.amount_paise, 0))), groups: list };
    }

    case "get_recurring": {
      const a = analyse(ctx);
      return {
        monthly_cost: r(a.recurring.filter((x) => x.category_id !== "invest").reduce((s, x) => s + x.monthly, 0)),
        items: a.recurring.map((x) => ({
          name: x.name, category: catName(x.category_id), subcategory: subName(x.category_id, x.subcategory_id) ?? undefined,
          cadence: x.cadence, amount: r(x.amount), varies: x.variable || undefined, last_charged: x.last, next_expected: x.next,
          price_change: x.priceChange ? { from: r(x.priceChange.from), to: r(x.priceChange.to), on: x.priceChange.date } : undefined,
        })),
      };
    }

    case "get_budgets": {
      const b = resolveBudgets(ctx.budgetRows, ctx.cats, month);
      const spent = spentByCategory(inMonth(ctx.tx, month), ctx.cats);
      const v = monthView(ctx);
      return {
        share_of_month_gone_percent: Math.round(v.pace * 100),
        categories: Object.keys(b)
          .map((id) => ({ category: catName(id), budget: r(b[id]), spent: r(spent[id] ?? 0) }))
          .filter((c) => c.budget > 0 || c.spent > 0)
          .sort((x, y) => y.spent - x.spent),
      };
    }

    case "get_alerts_and_patterns": {
      const a = analyse(ctx);
      return {
        alerts: a.alerts.map((x) => ({ kind: x.kind, title: x.title, detail: x.body })),
        fees_last_6_months: { total: r(a.fees.total), this_month: r(a.fees.thisMonth), by_type: a.fees.bySub.map((f) => ({ type: f.name, total: r(f.total) })) },
        average_everyday_spend_by_weekday: Object.fromEntries(a.weekday.avg.map((v, i) => [WEEKDAYS[i], r(v)])),
        weekend_vs_weekday_ratio: a.weekday.weekendRatio ? Number(a.weekday.weekendRatio.toFixed(2)) : null,
        no_spend: { current_streak_days: a.streaks.current, longest_this_month: a.streaks.longest, days_this_month: a.streaks.days },
        top_merchants_6_months: a.merchants.slice(0, 12).map((m) => ({ merchant: m.name, category: catName(m.category_id), total: r(m.total), payments: m.count, average: r(m.avg), by_month_oldest_first: m.byMonth.map(r) })),
        categories_vs_3_month_average: a.breakdown.slice(0, 12).map((b) => ({ category: b.name, this_month: r(b.total), same_point_last_month: r(b.lastMonthToDate), three_month_average: r(b.avg3), top_subcategories: b.subs.slice(0, 3).map((s) => `${s.name} ${r(s.total)}`) })),
        month_story: a.story,
      };
    }

    case "get_accounts_and_goals": {
      const nw = netWorth(ctx.accounts);
      return {
        net_worth: r(nw.total), assets: r(nw.assets), owed: r(nw.liabilities),
        accounts: ctx.accounts.map((a) => ({ name: a.name, type: a.type, balance: r(a.balance_paise), updated: a.updated_at.slice(0, 10) })),
        goals: ctx.goals.map((g) => ({ name: g.name, target: r(g.target_paise), saved: r(g.saved_paise), target_date: g.target_date })),
      };
    }

    default:
      return { error: `Unknown tool ${name}` };
  }
}
