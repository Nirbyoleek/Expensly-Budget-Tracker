import WealthView from "@/components/wealth/WealthView";
import { getAccounts, getCategories, getGoals, getRecentTransactions, getSnapshots } from "@/lib/data";
import { netWorth } from "@/lib/finance";
import { recurringPayments } from "@/lib/analytics";
import { goalProgress } from "@/lib/goals";
import { peopleBalances } from "@/lib/people";
import { monthStart, todayISO } from "@/lib/dates";

export const metadata = { title: "Wealth · Expensly" };

export default async function WealthPage() {
  const [accounts, goals, snapshots, tx, cats] = await Promise.all([getAccounts(), getGoals(), getSnapshots(), getRecentTransactions(), getCategories()]);
  const today = todayISO();
  const month = monthStart(today);
  const trend = [
    ...snapshots.filter((s) => s.month < month).slice(-5).map((s) => ({ month: s.month, value: s.assets_paise - s.liabilities_paise })),
    ...(accounts.length ? [{ month, value: netWorth(accounts).total }] : []),
  ];
  const progress = Object.fromEntries(goals.map((g) => {
    const p = goalProgress(g, tx);
    return [g.id, { saved: p.saved, auto: p.auto, count: p.count, last: p.last }];
  }));
  return (
    <WealthView
      accounts={accounts}
      goals={goals}
      progress={progress}
      trend={trend}
      subscriptions={recurringPayments(tx, cats, today)}
      people={peopleBalances(tx)}
      todayIso={today}
      sample={tx.some((t) => t.source === "sample") || accounts.some((a) => a.is_sample)}
    />
  );
}
