import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Called by the service worker when a push arrives: the newest messages not yet shown on a device. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ items: [] }, { status: 401 });
  const since = new Date(Date.now() - 2 * 86400000).toISOString();
  const { data } = await supabase
    .from("notifications")
    .select("id,key,title,body,url")
    .is("shown_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(3);
  const items = data ?? [];
  if (items.length) await supabase.from("notifications").update({ shown_at: new Date().toISOString() }).in("id", items.map((n) => n.id));
  return NextResponse.json({ items }, { headers: { "cache-control": "no-store" } });
}
