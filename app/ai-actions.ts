"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAccounts, getBudgetRows, getCategories, getGoals, getIncomePlans, getProfile, getRecentTransactions } from "@/lib/data";
import { addMonths, longDate, monthStart, todayISO } from "@/lib/dates";
import { inMonth, resolveBudgets, spentByCategory } from "@/lib/finance";
import { resolvePlan } from "@/lib/income";
import { runTool, type AiContext } from "@/lib/ai/tools";
import { completeText, parseJson, recordTokens, takeAi } from "@/lib/ai/gate";
import { TAXONOMY, TAXONOMY_BY_ID, fullCategoryName } from "@/lib/taxonomy";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string; noAi?: boolean };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong. Try again." });

async function context() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session ended. Sign in again.");
  const today = todayISO();
  const [tx, cats, budgetRows, accounts, goals, incomePlans, profile] = await Promise.all([
    getRecentTransactions(), getCategories(), getBudgetRows(), getAccounts(), getGoals(), getIncomePlans(), getProfile(),
  ]);
  const ctx: AiContext = { today, tx, cats, budgetRows, accounts, goals, incomePlans };
  return { supabase, user, today, ctx, name: profile.name };
}

const VOICE = "You write for a personal finance app in India. Amounts in rupees, Indian format (₹1,23,456; ₹1.2L; ₹45k). Plain, warm, specific, never preachy. Only use numbers given to you.";

/* ───────────────────────── daily brief ───────────────────────── */

export type Brief = { headline: string; points: string[]; tip: string; mood: "good" | "watch" | "alert"; day: string };

/** Today's AI money brief, made once a day and cached. `refresh` makes a new one (counts as an AI request). */
export async function getDailyBrief(refresh = false): Promise<Result<{ brief: Brief; cached: boolean }>> {
  try {
    const { supabase, user, today, ctx, name } = await context();
    if (!refresh) {
      const { data } = await supabase.from("ai_briefs").select("content").eq("day", today).maybeSingle();
      if (data?.content) return { ok: true, brief: data.content as Brief, cached: true };
    }
    if (!ctx.tx.length) throw new Error("Add some transactions first and Expensly will brief you every morning.");
    const gate = await takeAi(supabase, user, today, "brief");
    if (!gate.ok) return { ok: false, error: gate.error, noAi: gate.noAi };

    const overview = runTool("get_overview", {}, ctx) as Record<string, unknown>;
    const patterns = runTool("get_alerts_and_patterns", {}, ctx) as Record<string, unknown>;
    const yesterday = runTool("query_transactions", { from: addDays(today, -1), to: addDays(today, -1), direction: "out", limit: 10 }, ctx);
    const data = JSON.stringify({ overview, alerts: patterns.alerts, fees: patterns.fees_last_6_months, categories: patterns.categories_vs_3_month_average, story: patterns.month_story, yesterday });

    const { text, usage } = await completeText(
      gate.provider,
      VOICE,
      `Write ${name ? `${name}'s` : "the user's"} money brief for ${longDate(today)} from this data:
${data}

Reply with JSON only:
{"headline": "one punchy sentence, max 14 words, with the single most important number",
 "points": ["3 short bullets (max 22 words each): how the month is pacing, the biggest change or risk, something about yesterday or an upcoming bill"],
 "tip": "one concrete action for today, max 20 words, with a number",
 "mood": "good" | "watch" | "alert"}`,
      700,
    );
    await recordTokens(supabase, today, usage);
    const raw = parseJson<Partial<Brief>>(text);
    const brief: Brief = {
      headline: String(raw.headline ?? "").slice(0, 160) || "Here's your money today",
      points: (Array.isArray(raw.points) ? raw.points : []).map((p) => String(p).slice(0, 220)).filter(Boolean).slice(0, 3),
      tip: String(raw.tip ?? "").slice(0, 200),
      mood: raw.mood === "alert" || raw.mood === "watch" ? raw.mood : "good",
      day: today,
    };
    await supabase.from("ai_briefs").upsert({ day: today, content: brief }, { onConflict: "user_id,day" });
    return { ok: true, brief, cached: false };
  } catch (e) {
    return fail(e);
  }
}

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ───────────────────────── AI categorising ───────────────────────── */

export type CatSuggestion = { id: string; merchant: string; amount: number; date: string; from: string; category_id: string; subcategory_id: string | null; to: string; why: string };

/** Transactions the rules weren't sure about, re-filed by AI. Nothing changes until you accept. */
export async function suggestCategories(): Promise<Result<{ suggestions: CatSuggestion[]; looked: number }>> {
  try {
    const { supabase, user, today, ctx } = await context();
    const unsure = ctx.tx
      .filter((t) => !t.reviewed && t.category_id !== "xfer" && t.source !== "sample" && (!t.subcategory_id || t.category_id === "uncat" || (t.category_id === "shop" && t.subcategory_id === "other") || t.category_id === "people"))
      .slice(0, 40);
    if (!unsure.length) return { ok: true, suggestions: [], looked: 0 };
    const gate = await takeAi(supabase, user, today, "categories");
    if (!gate.ok) return { ok: false, error: gate.error, noAi: gate.noAi };

    const options = TAXONOMY.filter((c) => c.id !== "xfer").map((c) => `${c.id}: ${c.subs.map((s) => s.id).join(", ")}`).join("\n");
    const rows = unsure.map((t, n) => ({ n, merchant: t.merchant_name, bank_text: (t.merchant_raw ?? "").split(" | ")[0].slice(0, 90), amount: t.amount_paise / 100, now: `${t.category_id}/${t.subcategory_id ?? "-"}` }));
    const { text, usage } = await completeText(
      gate.provider,
      `${VOICE} You categorise Indian bank and card transactions. Use your knowledge of Indian merchants, payment gateways (Razorpay, PayU, Paytm, BillDesk, CCAvenue), UPI and statement wording.`,
      `Categories and subcategories (use these ids only):
${options}

Transactions (negative amount = money out):
${JSON.stringify(rows)}

For each transaction, pick the best category and subcategory. If you genuinely can't tell (e.g. a payment to a person's name), keep its current one and say so.
Reply with JSON only: [{"n": 0, "category": "food", "sub": "delivery", "why": "max 10 words"}]`,
      2000,
    );
    await recordTokens(supabase, today, usage);
    const picks = parseJson<{ n: number; category: string; sub?: string | null; why?: string }[]>(text);
    const suggestions: CatSuggestion[] = [];
    for (const p of Array.isArray(picks) ? picks : []) {
      const t = unsure[p.n];
      const def = TAXONOMY_BY_ID[p.category];
      if (!t || !def || def.id === "xfer") continue;
      const sub = def.subs.some((s) => s.id === p.sub) ? (p.sub as string) : null;
      if (def.id === t.category_id && sub === t.subcategory_id) continue; // no change
      suggestions.push({
        id: t.id, merchant: t.merchant_name, amount: t.amount_paise, date: t.date,
        from: fullCategoryName(t.category_id, t.subcategory_id), category_id: def.id, subcategory_id: sub,
        to: fullCategoryName(def.id, sub), why: String(p.why ?? "").slice(0, 80),
      });
    }
    return { ok: true, suggestions, looked: unsure.length };
  } catch (e) {
    return fail(e);
  }
}

export async function applyCategorySuggestions(items: { id: string; category_id: string; subcategory_id: string | null }[]): Promise<Result<{ changed: number }>> {
  try {
    const supabase = await createClient();
    const list = z.array(z.object({ id: z.string().uuid(), category_id: z.string().min(1).max(32), subcategory_id: z.string().max(32).nullable() })).max(60).parse(items);
    let changed = 0;
    for (const it of list) {
      if (!TAXONOMY_BY_ID[it.category_id]) continue;
      const { error } = await supabase.from("transactions").update({ category_id: it.category_id, subcategory_id: it.subcategory_id, reviewed: true, updated_at: new Date().toISOString() }).eq("id", it.id);
      if (!error) changed++;
    }
    revalidatePath("/", "layout");
    return { ok: true, changed };
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────── AI budget plan ───────────────────────── */

export type BudgetSuggestion = { category_id: string; name: string; current: number; avg: number; suggested: number; why: string };

/** Budgets proposed from your last 3 months and income. Nothing changes until you apply them. */
export async function suggestBudgets(): Promise<Result<{ summary: string; items: BudgetSuggestion[] }>> {
  try {
    const { supabase, user, today, ctx } = await context();
    const month = monthStart(today);
    const months = [1, 2, 3].map((k) => addMonths(month, -k));
    const spends = months.map((m) => spentByCategory(inMonth(ctx.tx, m), ctx.cats));
    const current = resolveBudgets(ctx.budgetRows, ctx.cats, month);
    const thisMonth = spentByCategory(inMonth(ctx.tx, month), ctx.cats);
    const plan = resolvePlan(ctx.incomePlans, month);
    const spendCats = ctx.cats.filter((c) => c.kind === "spend" && c.id !== "uncat");
    const rows = spendCats
      .map((c) => ({ id: c.id, name: c.name, avg: Math.round(spends.reduce((s, x) => s + (x[c.id] ?? 0), 0) / 3 / 100), last3: spends.map((x) => Math.round((x[c.id] ?? 0) / 100)), this_month: Math.round((thisMonth[c.id] ?? 0) / 100), budget: Math.round((current[c.id] ?? 0) / 100) }))
      .filter((r) => r.avg > 0 || r.budget > 0 || r.this_month > 0);
    if (!rows.length) throw new Error("There isn't enough spending yet to suggest budgets.");
    const gate = await takeAi(supabase, user, today, "budgets");
    if (!gate.ok) return { ok: false, error: gate.error, noAi: gate.noAi };

    const { text, usage } = await completeText(
      gate.provider,
      `${VOICE} You set realistic monthly budgets: fixed bills at their real level, everyday categories a little below the recent average where there's room, and you protect the savings goal.`,
      `Monthly income: ${plan ? `₹${Math.round(plan.total / 100)} (savings goal ${plan.savings_goal_pct}%)` : "unknown"}
Categories (rupees; last3 = the 3 previous months, oldest last):
${JSON.stringify(rows)}

Suggest a monthly budget for each category listed, rounded to the nearest ₹500 (₹100 under ₹2,000). Keep the total within income minus the savings goal when income is known.
Reply with JSON only: {"summary": "2 sentences on the plan and what it frees up", "budgets": [{"id": "food", "amount": 6500, "why": "max 12 words"}]}`,
      1600,
    );
    await recordTokens(supabase, today, usage);
    const out = parseJson<{ summary?: string; budgets?: { id: string; amount: number; why?: string }[] }>(text);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items: BudgetSuggestion[] = (out.budgets ?? [])
      .filter((b) => byId.has(b.id) && Number.isFinite(Number(b.amount)) && Number(b.amount) >= 0)
      .map((b) => {
        const r = byId.get(b.id)!;
        return { category_id: b.id, name: r.name, current: r.budget * 100, avg: r.avg * 100, suggested: Math.round(Number(b.amount)) * 100, why: String(b.why ?? "").slice(0, 90) };
      });
    return { ok: true, summary: String(out.summary ?? "").slice(0, 400), items };
  } catch (e) {
    return fail(e);
  }
}

export async function applyBudgets(items: { category_id: string; limit_paise: number }[]): Promise<Result<{ changed: number }>> {
  try {
    const supabase = await createClient();
    const list = z.array(z.object({ category_id: z.string().min(1).max(32), limit_paise: z.number().int().min(0).max(1e11) })).max(40).parse(items);
    const month = monthStart(todayISO());
    const { error } = await supabase.from("budgets").upsert(list.map((b) => ({ ...b, month })), { onConflict: "user_id,category_id,month" });
    if (error) throw new Error(error.message);
    revalidatePath("/", "layout");
    return { ok: true, changed: list.length };
  } catch (e) {
    return fail(e);
  }
}
