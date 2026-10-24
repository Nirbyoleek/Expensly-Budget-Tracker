import ActivityView from "@/components/activity/ActivityView";
import { getRecentTransactions, requireUser } from "@/lib/data";
import { aiProviderFor } from "@/lib/ai/gate";

export const metadata = { title: "Activity · Expensly" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [tx, sp, { user }] = await Promise.all([getRecentTransactions(), searchParams, requireUser()]);
  const filter = sp.filter ?? (sp.cat ? sp.cat : undefined);
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : undefined;
  // key resets the view's local state when arriving from a different link
  const q = sp.q?.slice(0, 80);
  const sub = sp.sub?.slice(0, 32);
  return <ActivityView key={`${filter}-${sub}-${day}-${q}`} tx={tx} initial={{ filter, day, q, sub }} aiOn={!!aiProviderFor(user)} />;
}
