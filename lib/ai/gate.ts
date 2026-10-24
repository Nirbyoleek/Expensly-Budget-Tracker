import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { LIMITS } from "./limits";
import { runProvider, serverProvider, type Provider } from "./provider";
import { track } from "@/lib/track";
import { isTestAccount } from "@/lib/test-accounts";

/**
 * Every AI feature goes through here: is AI on for this person, and do they have quota left?
 * Each call to `takeAi` counts as one question against their limits.
 */
export function aiProviderFor(user: User): Provider | null {
  if (isTestAccount(user.email)) return null; // automated test accounts never spend AI
  const allowed = (process.env.AI_ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !allowed.length || allowed.includes((user.email ?? "").toLowerCase()) ? serverProvider() : null;
}

export type Gate = { ok: true; provider: Provider; leftToday: number | null } | { ok: false; error: string; noAi?: boolean };

export async function takeAi(supabase: SupabaseClient, user: User, day: string, feature = "ask"): Promise<Gate> {
  const provider = aiProviderFor(user);
  if (!provider) return { ok: false, error: "AI isn't set up yet.", noAi: true };
  const caps = LIMITS.server;
  const { data, error } = await supabase.rpc("ai_take_quota", { p_day: day, p_daily: caps.daily, p_per_minute: caps.perMinute, p_monthly_tokens: caps.monthlyTokens });
  const q = (data ?? {}) as { ok?: boolean; reason?: string; limit?: number; retry_in?: number; left_today?: number | null };
  if (error || !q.ok) {
    return {
      ok: false,
      error:
        error ? "Couldn't check your AI limit. Try again in a moment." :
        q.reason === "daily" ? `You've used all ${q.limit} AI requests for today. They reset at midnight.` :
        q.reason === "minute" ? `That's ${q.limit} AI requests in a minute. Wait ${q.retry_in ?? 60}s and try again.` :
        q.reason === "monthly" ? "You've reached this month's AI allowance. It resets on the 1st." :
        q.reason === "disabled" ? "AI is switched off for your account." : "AI isn't available right now.",
    };
  }
  track(supabase, feature === "import" || feature === "quick" ? "ai_sort" : feature === "budgets" ? "ai_budget_plan" : "ai_question", { feature });
  return { ok: true, provider, leftToday: q.left_today ?? null };
}

export async function recordTokens(supabase: SupabaseClient, day: string, usage: { input: number; output: number }) {
  await supabase.rpc("ai_record_tokens", { p_day: day, p_input: usage.input, p_output: usage.output }).then(() => undefined, () => undefined);
}

/** One-shot request (no tools), returning the full text. */
export async function completeText(provider: Provider, system: string, prompt: string, maxTokens = 1500): Promise<{ text: string; usage: { input: number; output: number } }> {
  let text = "";
  let usage = { input: 0, output: 0 };
  for await (const ev of runProvider(provider, { system, tools: [], messages: [{ role: "user", content: prompt }], runTool: () => ({}), maxTokens })) {
    if (ev.t === "text") text += ev.v;
    else if (ev.t === "done") usage = ev.usage;
    else if (ev.t === "error") throw new Error(ev.v);
  }
  return { text, usage };
}

/** Pulls the first JSON object or array out of a model reply (models sometimes wrap it in ``` fences). */
export function parseJson<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;
  const start = fenced.search(/[[{]/);
  if (start < 0) throw new Error("The AI didn't return a usable answer. Try again.");
  const open = fenced[start], close = open === "{" ? "}" : "]";
  const end = fenced.lastIndexOf(close);
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as T;
  } catch {
    throw new Error("The AI's answer was garbled. Try again.");
  }
}
