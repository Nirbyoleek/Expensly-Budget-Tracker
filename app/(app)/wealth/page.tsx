import WealthView from "@/components/wealth/WealthView";
import { getAccounts, getCategories, getGoals, getRecentTransactions, getSnapshots } from "@/lib/data";
import { detectRecurring, netWorth } from "@/lib/finance";
import { dayOf, monthStart, todayISO } from "@/lib/dates";

export const metadata = { title: "Wealth · Expensly" };

export default async function WealthPage() {
  const [accounts, goals, snapshots, tx, cats] = await Promise.all([getAccounts(), getGoals(), getSnapshots(), getRecentTransactions(), getCategories()]);
  const today = todayISO();
  const month = monthStart(today);
  const trend = [
    ...snapshots.filter((s) => s.month < month).slice(-5).map((s) => ({ month: s.month, value: s.assets_paise - s.liabilities_paise })),
    ...(accounts.length ? [{ month, value: netWorth(accounts).total }] : []),
  ];
  return (
    <WealthView
      accounts={accounts}
      goals={goals}
      trend={trend}
      recurring={detectRecurring(tx, today, cats)}
      today={dayOf(today)}
      sample={tx.some((t) => t.source === "sample") || accounts.some((a) => a.is_sample)}
    />
  );
}
