import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * First-party usage analytics. Each event is a name plus a few non-personal details (counts,
 * kinds, a page path). Never amounts, merchant names or anything typed. Written after the
 * response is sent, so it never slows anything down, and failures are ignored.
 */
export const EVENTS = [
  "signup", "sign_in", "page_view",
  "tx_added", "statement_imported", "tx_edited", "reviewed", "merchant_rule",
  "category_created", "category_deleted", "budget_set", "ai_budget_plan",
  "goal_created", "goal_autofill", "income_set", "account_saved", "recategorised",
  "ai_question", "ai_sort", "capture_key", "sms_captured", "push_enabled",
  "export", "sample_loaded", "account_deleted", "offline_synced",
] as const;
export type EventName = (typeof EVENTS)[number];
export type EventProps = Record<string, string | number | boolean | null>;

const clean = (props: EventProps = {}) =>
  Object.fromEntries(Object.entries(props).slice(0, 8).map(([k, v]) => [k.slice(0, 24), typeof v === "string" ? v.slice(0, 60) : v]));

/** Record an event as the signed-in person (row-level security fills in who). */
export function track(supabase: SupabaseClient, name: EventName, props?: EventProps) {
  const run = async () => { try { await supabase.from("events").insert({ name, props: clean(props) }); } catch { /* analytics never breaks the app */ } };
  try { after(run); } catch { void run(); }
}

/** Record an event with the service role, for someone who isn't signed in on this request (or no one). */
export function trackAs(admin: SupabaseClient, userId: string | null, name: EventName, props?: EventProps) {
  const run = async () => { try { await admin.from("events").insert({ user_id: userId, name, props: clean(props) }); } catch { /* ignore */ } };
  try { after(run); } catch { void run(); }
}

/** /review/2026-09 → /review/[month], so pages group together. Unknown paths are dropped. */
export function normalisePath(path: string): string | null {
  const p = path.split("?")[0].replace(/\/+$/, "") || "/";
  if (p.length > 60 || !/^\/[a-z0-9/_-]*$/i.test(p)) return null;
  const known = ["/home", "/activity", "/budgets", "/insights", "/wealth", "/ask", "/settings", "/settings/capture", "/review", "/privacy", "/admin"];
  const n = p.replace(/^\/review\/\d{4}-\d{2}$/, "/review/[month]");
  return known.includes(n) || n === "/review/[month]" ? n : null;
}
