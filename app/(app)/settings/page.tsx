import { headers } from "next/headers";
import SettingsView from "@/components/settings/SettingsView";
import { getAccounts, getIncomePlans, getProfile, getRecentTransactions } from "@/lib/data";
import { resolvePlan } from "@/lib/income";
import { monthStart, todayISO } from "@/lib/dates";
import { createServiceClient } from "@/lib/supabase/server";
import { ownerEmail } from "@/lib/errors";

export const metadata = { title: "Settings · Expensly" };

export default async function SettingsPage() {
  const [profile, tx, accounts, h, incomePlans] = await Promise.all([getProfile(), getRecentTransactions(), getAccounts(), headers(), getIncomePlans()]);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  // App health is only for the owner (OWNER_EMAIL); everyone else never sees it.
  let health = null;
  if (ownerEmail() && profile.email.toLowerCase() === ownerEmail()) {
    const db = createServiceClient();
    const { data } = db ? await db.from("app_errors").select("at,source,path,message").order("at", { ascending: false }).limit(200) : { data: [] };
    health = (data ?? []) as { at: string; source: string; path: string | null; message: string }[];
  }
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return (
    <SettingsView
      email={profile.email}
      hasToken={profile.hasIngestToken}
      hasSample={tx.some((t) => t.source === "sample") || accounts.some((a) => a.is_sample)}
      origin={`${proto}://${host}`}
      plan={resolvePlan(incomePlans, monthStart(todayISO()))}
      notify={profile.notify}
      health={health}
      seenSalary={tx.find((t) => t.category_id === "income" && t.subcategory_id === "salary")?.amount_paise ?? null}
    />
  );
}
