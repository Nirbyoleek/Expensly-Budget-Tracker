import HomeView from "@/components/home/HomeView";
import GetStarted from "@/components/home/GetStarted";
import Header from "@/components/Header";
import { getBudgetRows, getCategories, getIncomePlans, getProfile, getRecentTransactions, requireUser } from "@/lib/data";
import { aiProviderFor } from "@/lib/ai/gate";
import type { Brief } from "@/app/ai-actions";
import { cashflow, dayDetail, dayTotals, inMonth, insights, monthView } from "@/lib/finance";
import { addMonths, monthLong, monthStart, todayISO } from "@/lib/dates";
import { analyse, headlineInsights } from "@/lib/analytics";

export const metadata = { title: "Expensly" };

export default async function HomePage() {
  const today = todayISO();
  const [tx, cats, budgetRows, incomePlans, { supabase, user }] = await Promise.all([getRecentTransactions(), getCategories(), getBudgetRows(), getIncomePlans(), requireUser()]);
  if (!tx.length) {
    return (
      <>
        <Header title="Overview" subtitle={monthLong(today)} />
        <GetStarted />
      </>
    );
  }
  const [{ data: cached }, { count: devices }, profile] = await Promise.all([
    supabase.from("ai_briefs").select("content").eq("day", today).maybeSingle(),
    supabase.from("push_subscriptions").select("id", { count: "exact", head: true }),
    getProfile(),
  ]);
  const setup = profile.onboardingDismissed ? null : {
    hasData: tx.some((t) => t.source !== "sample"),
    hasIncome: incomePlans.length > 0,
    hasBudgets: budgetRows.length > 0,
    hasReminders: (devices ?? 0) > 0,
  };
  const mv = monthView({ today, tx, cats, budgetRows });
  const analysis = analyse({ tx, cats, budgetRows, today, incomePlans });
  // One forecast everywhere: the weekday-aware one Insights uses.
  const v = { ...mv, projected: Math.round(analysis.forecast.total) };
  const deep = headlineInsights(analysis);
  // Calendar data for every month we have, oldest first, so you can step back through them.
  const earliest = tx.reduce((m, t) => (t.date < m ? t.date : m), today);
  const daily = [];
  for (let m = monthStart(earliest); m <= mv.month; m = addMonths(m, 1)) {
    const mtx = inMonth(tx, m);
    daily.push({ month: m, totals: dayTotals(mtx, cats), detail: dayDetail(mtx, cats) });
  }
  const base = insights(v, tx, cats);
  // review first, then the deeper findings, then the rest
  const merged = [...base.filter((i) => i.id === "review"), ...deep, ...base.filter((i) => i.id !== "review")].slice(0, 8);
  return (
    <HomeView
      v={v}
      daily={daily}
      setup={setup}
      cashflow={cashflow(tx, cats, today)}
      insights={merged}
      sample={tx.some((t) => t.source === "sample")}
      brief={(cached?.content as Brief | undefined) ?? null}
      aiOn={!!aiProviderFor(user)}
    />
  );
}
