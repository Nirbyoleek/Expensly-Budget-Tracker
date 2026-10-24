import ActivityView from "@/components/activity/ActivityView";
import { getActiveMonths, getRecentTransactions, getTransactionsBetween, requireUser } from "@/lib/data";
import { aiProviderFor } from "@/lib/ai/gate";
import { daysInMonth } from "@/lib/dates";

export const metadata = { title: "Activity · Expensly" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [recent, sp, { user }, active] = await Promise.all([getRecentTransactions(), searchParams, requireUser(), getActiveMonths()]);
  const filter = sp.filter ?? (sp.cat ? sp.cat : undefined);
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : undefined;
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : day?.slice(0, 7);
  // The first load covers six months; an older month is fetched on its own when asked for.
  let tx = recent;
  if (month && !recent.some((t) => t.date.startsWith(month))) {
    const older = await getTransactionsBetween(`${month}-01`, `${month}-${String(daysInMonth(`${month}-01`)).padStart(2, "0")}`);
    const seen = new Set(recent.map((t) => t.id));
    tx = [...recent, ...older.filter((t) => !seen.has(t.id))];
  }
  // key resets the view's local state when arriving from a different link
  const q = sp.q?.slice(0, 80);
  const sub = sp.sub?.slice(0, 32);
  return <ActivityView key={`${filter}-${sub}-${day}-${q}-${month}`} tx={tx} initial={{ filter, day, q, sub, month }} allMonths={active.map((m) => m.slice(0, 7))} aiOn={!!aiProviderFor(user)} />;
}
