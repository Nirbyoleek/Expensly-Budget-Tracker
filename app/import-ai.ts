"use server";

import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/dates";
import { completeText, parseJson, recordTokens, takeAi } from "@/lib/ai/gate";
import { isGenericName, mayBePerson, merchantCacheKey } from "@/lib/ingest/core";
import { TAXONOMY, TAXONOMY_BY_ID } from "@/lib/taxonomy";

export type AiPick = { category_id: string; subcategory_id: string | null; confidence: number; from: "cache" | "ai" };

const MAX = 60;
const SKIP = new Set(["xfer", "income", "people", "invest"]);

/**
 * Categorise the merchants the rules couldn't place during an import.
 *
 * 1. Look each name up in the shared cache (filled by earlier imports from any user).
 * 2. Send only the misses to the cheapest model, as bare merchant names: no amounts, no dates,
 *    no account details, and never anything that looks like a person's name.
 * 3. Save confident answers to the cache so nobody pays for that merchant again.
 *
 * Without AI or quota, cache hits still come back. Never throws: the import works without it.
 */
export async function aiSortImport(items: { name: string; out: boolean }[]): Promise<{ ok: true; picks: Record<string, AiPick>; asked: number; cached: number } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in again." };
    const list = z.array(z.object({ name: z.string().max(120), out: z.boolean() })).max(400).parse(items);

    // one entry per merchant, people and placeholders removed
    const byKey = new Map<string, { name: string; out: boolean }>();
    for (const it of list) {
      const key = merchantCacheKey(it.name);
      if (key.length < 3 || !/[a-z]{3}/.test(key) || isGenericName(it.name) || mayBePerson(it.name) || byKey.has(key)) continue;
      byKey.set(key, it);
      if (byKey.size >= MAX) break;
    }
    if (!byKey.size) return { ok: true, picks: {}, asked: 0, cached: 0 };

    const admin = createServiceClient();
    const picks: Record<string, AiPick> = {};
    if (admin) {
      const { data } = await admin.from("merchant_ai_cache").select("key,category_id,subcategory_id,confidence").in("key", [...byKey.keys()]);
      for (const r of data ?? []) picks[r.key as string] = { category_id: r.category_id as string, subcategory_id: (r.subcategory_id as string | null) ?? null, confidence: Number(r.confidence), from: "cache" };
      if (data?.length) await admin.rpc("merchant_ai_cache_hit", { p_keys: data.map((r) => r.key) }).then(() => undefined, () => undefined);
    }
    const cached = Object.keys(picks).length;
    const misses = [...byKey.entries()].filter(([k]) => !picks[k]);
    if (!misses.length) return { ok: true, picks, asked: 0, cached };

    const today = todayISO();
    const gate = await takeAi(supabase, user, today);
    if (!gate.ok) return { ok: true, picks, asked: 0, cached }; // no AI or out of quota: cache only

    const options = TAXONOMY.filter((c) => !SKIP.has(c.id)).map((c) => `${c.id}: ${c.subs.map((s) => s.id).join(", ")}`).join("\n");
    const rows = misses.map(([, v], n) => ({ n, merchant: v.name.slice(0, 60), dir: v.out ? "paid" : "received" }));
    const { text, usage } = await completeText(
      gate.provider,
      "You categorise merchants from Indian bank and card statements. You know Indian brands, chains, local shop naming (kirana, medical, sweets, dhaba), payment gateways and abbreviations. Be honest about uncertainty.",
      `Categories and subcategories (ids only):
${options}

Merchants (names as printed on a statement):
${JSON.stringify(rows)}

For each, give the best category and subcategory and a confidence from 0 to 1.
Use 0.9+ only for a brand or an unmistakable business type; 0.6-0.8 for a reasonable guess from the name; below 0.5 if it could be anything.
Reply with JSON only: [{"n":0,"c":"food","s":"restaurants","p":0.9}]`,
      Math.min(2000, 200 + misses.length * 28),
    );
    await recordTokens(supabase, today, usage);

    const out = parseJson<{ n: number; c: string; s?: string | null; p?: number }[]>(text);
    const save: { key: string; category_id: string; subcategory_id: string | null; confidence: number; model: string }[] = [];
    for (const r of Array.isArray(out) ? out : []) {
      const miss = misses[r.n];
      const def = TAXONOMY_BY_ID[r.c];
      if (!miss || !def || SKIP.has(def.id)) continue;
      const conf = Math.max(0, Math.min(1, Number(r.p) || 0));
      if (conf < 0.5) continue;
      const sub = def.subs.some((x) => x.id === r.s) ? (r.s as string) : null;
      picks[miss[0]] = { category_id: def.id, subcategory_id: sub, confidence: conf, from: "ai" };
      if (conf >= 0.7) save.push({ key: miss[0], category_id: def.id, subcategory_id: sub, confidence: conf, model: gate.provider.model });
    }
    if (admin && save.length) await admin.from("merchant_ai_cache").upsert(save, { onConflict: "key", ignoreDuplicates: true });
    return { ok: true, picks, asked: misses.length, cached };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI sorting failed." };
  }
}
