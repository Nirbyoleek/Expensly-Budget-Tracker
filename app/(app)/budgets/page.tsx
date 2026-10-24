import BudgetsView from "@/components/budgets/BudgetsView";
import { getBudgetRows, getCategories, getRecentTransactions, requireUser } from "@/lib/data";
import { aiProviderFor } from "@/lib/ai/gate";
import { inMonth, monthView } from "@/lib/finance";
import { todayISO } from "@/lib/dates";

export const metadata = { title: "Budgets · Expensly" };

export default async function BudgetsPage() {
  const [tx, cats, budgetRows, { user }] = await Promise.all([getRecentTransactions(), getCategories(), getBudgetRows(), requireUser()]);
  const v = monthView({ today: todayISO(), tx, cats, budgetRows });
  return <BudgetsView month={v.month} pace={v.pace} spentByCat={v.spentByCat} budgets={v.budgets} monthTx={inMonth(tx, v.month)} sample={tx.some((t) => t.source === "sample")} aiOn={!!aiProviderFor(user)} />;
}
