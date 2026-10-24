import { headers } from "next/headers";
import CaptureSetup from "@/components/settings/CaptureSetup";
import { getProfile, requireUser } from "@/lib/data";

export const metadata = { title: "Track automatically · Expensly" };

export default async function CapturePage() {
  const [{ supabase }, profile, h] = await Promise.all([requireUser(), getProfile(), headers()]);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const [{ data: last }, { count: week }] = await Promise.all([
    supabase.from("transactions").select("merchant_name,amount_paise,created_at").eq("source", "shortcut").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("transactions").select("id", { count: "exact", head: true }).eq("source", "shortcut").gte("created_at", weekAgo),
  ]);
  return (
    <CaptureSetup
      origin={`${proto}://${host}`}
      hasToken={profile.hasIngestToken}
      last={last ? { name: last.merchant_name as string, amount: Number(last.amount_paise), at: last.created_at as string } : null}
      thisWeek={week ?? 0}
    />
  );
}
