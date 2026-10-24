"use server";

import { createClient } from "@/lib/supabase/server";
import { normalisePath, track, type EventName } from "@/lib/track";

/** Page views and a few client-only moments. Only known names and app paths are accepted. */
export async function trackClient(name: "page_view" | "offline_synced" | "push_enabled", detail?: { path?: string; count?: number }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  if (name === "page_view") {
    const path = normalisePath(detail?.path ?? "");
    if (path) track(supabase, "page_view", { path });
    return;
  }
  const n = Number(detail?.count);
  track(supabase, name as EventName, Number.isFinite(n) ? { count: Math.max(0, Math.min(1000, Math.round(n))) } : undefined);
}
