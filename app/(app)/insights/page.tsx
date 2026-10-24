import InsightsView from "@/components/insights/InsightsView";
import GetStarted from "@/components/home/GetStarted";
import Header from "@/components/Header";
import { getBudgetRows, getCategories, getIncomePlans, getRecentTransactions } from "@/lib/data";
import { analyse } from "@/lib/analytics";
import { resolveBudgets } from "@/lib/finance";
import { resolvePlan } from "@/lib/income";
import { monthLong, monthStart, todayISO } from "@/lib/dates";

export const metadata = { title: "Insights · Expensly" };

export default async function InsightsPage() {
  const [tx, cats, budgetRows, incomePlans] = await Promise.all([getRecentTransactions(), getCategories(), getBudgetRows(), getIncomePlans()]);
  const today = todayISO();
  if (!tx.length) {
    return (
      <>
        <Header title="Insights" subtitle={monthLong(today)} />
        <GetStarted />
      </>
    );
  }
  const a = analyse({ tx, cats, budgetRows, today, incomePlans });
  const budgetTotal = Object.values(resolveBudgets(budgetRows, cats, monthStart(today))).reduce((s, n) => s + n, 0);
  return <InsightsView a={a} plan={resolvePlan(incomePlans, monthStart(today))} tx={tx} budgetTotal={budgetTotal} today={today} sample={tx.some((t) => t.source === "sample")} />;
}
