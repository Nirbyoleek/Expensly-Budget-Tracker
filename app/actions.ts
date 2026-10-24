"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { addMonths, monthStart, todayISO } from "@/lib/dates";
import { buildMemory, isGenericName, prepareRow, ruleKey, vpaOf } from "@/lib/ingest/core";
import type { MerchantRule, Transaction } from "@/lib/types";
import { SAMPLE_ACCOUNTS, SAMPLE_GOALS, sampleSnapshots, sampleTransactions } from "@/lib/sample";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function session() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session ended. Sign in again.");
  return { supabase, user };
}

const fail = (error: unknown): { ok: false; error: string } => ({
  ok: false,
  error: error instanceof z.ZodError ? error.issues[0]?.message ?? "Check the details and try again." : error instanceof Error ? error.message : "Something went wrong. Try again.",
});

const done = () => revalidatePath("/", "layout");

/* ───────────────────────── auth ───────────────────────── */

const Email = z.string().trim().toLowerCase().email("Enter a valid email address.");

const Password = z.string().min(8, "Use at least 8 characters.").max(72, "That password is too long.");

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Email + password. No emails are ever sent, so it works the same in any browser and in the iPhone home-screen app. */
export async function signInWithPassword(email: string, password: string): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: Email.parse(email), password: z.string().min(1, "Enter your password.").parse(password) });
    if (error) throw new Error(error.status === 429 ? "Too many tries. Wait a minute and try again." : "That email and password don't match.");
  } catch (e) {
    return fail(e);
  }
  redirect("/home");
}

/**
 * New account with a password, created already confirmed and signed straight in.
 * Uses the server's Supabase service key so Supabase never sends a confirmation email.
 */
export async function signUpWithPassword(email: string, password: string): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const e = Email.parse(email), pw = Password.parse(password);
    const admin = createServiceClient();
    if (!admin) throw new Error("New accounts can't be created right now. (The app owner needs to set SUPABASE_SERVICE_ROLE_KEY on the server.)");
    const { error } = await admin.auth.admin.createUser({ email: e, password: pw, email_confirm: true });
    if (error) throw new Error(/already|registered|exists/i.test(error.message) ? "There's already an account with this email. Sign in instead." : error.message);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: e, password: pw });
    if (signInError) throw new Error(signInError.message);
  } catch (e) {
    return fail(e);
  }
  redirect("/home");
}

/** Set or change the password of the signed-in account. */
export async function setPassword(password: string): Promise<ActionResult> {
  try {
    const { supabase } = await session();
    const { error } = await supabase.auth.updateUser({ password: Password.parse(password) });
    if (error) throw new Error(/different/i.test(error.message) ? "That's your current password. Pick a new one." : error.message);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Google sign-in. Returns Google's page to go to; it comes back to /auth/callback signed in. */
export async function startGoogleSignIn(): Promise<ActionResult<{ url: string }>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${await origin()}/auth/callback`, queryParams: { prompt: "select_account" } },
    });
    if (error || !data.url) throw new Error(/not enabled|unsupported provider/i.test(error?.message ?? "") ? "Google sign-in isn't switched on yet. Use your email and password for now." : error?.message ?? "Couldn't start Google sign-in.");
    return { ok: true, url: data.url };
  } catch (e) {
    return fail(e);
  }
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/* ───────────────────────── transactions ───────────────────────── */

const Paise = z.number().int().refine((n) => n !== 0, "Enter an amount above zero.").refine((n) => Math.abs(n) < 1e12, "That amount is too large.");
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date.");
const CategoryId = z.string().min(1).max(32);
const SubId = z.string().max(32).nullable().optional();

const NewTx = z.object({
  date: IsoDate,
  amount_paise: Paise,
  merchant_name: z.string().trim().min(1, "Give it a name.").max(80),
  merchant_raw: z.string().max(400).nullable().optional(),
  category_id: CategoryId,
  subcategory_id: SubId,
  source: z.enum(["manual", "sms", "shortcut", "import"]),
  dedupe_hash: z.string().max(64).nullable().optional(),
  reviewed: z.boolean().default(false),
});

const AccountLink = z.object({
  id: z.string().uuid().optional(),
  create: z.object({ name: z.string().trim().min(1).max(60), type: z.enum(["bank", "card"]), last4: z.string().regex(/^\d{4}$/).nullable().optional() }).optional(),
  balance_paise: z.number().int().optional(),
});

export async function addTransactions(input: {
  rows: z.input<typeof NewTx>[];
  file?: { name: string; kind: "csv" | "pdf" | "text" | "sms" };
  /** Which account this statement belongs to; its balance is set from the statement's closing balance. */
  account?: z.input<typeof AccountLink>;
}): Promise<ActionResult<{ added: number; skipped: number; importId: string | null; accountName?: string }>> {
  try {
    const { supabase } = await session();
    const rows = z.array(NewTx).min(1, "Nothing to add.").max(2000, "Import at most 2,000 rows at a time.").parse(input.rows);

    let accountId: string | null = null, accountName: string | undefined;
    if (input.account) {
      const a = AccountLink.parse(input.account);
      if (a.id) {
        const patch = a.balance_paise !== undefined ? { balance_paise: a.balance_paise, updated_at: new Date().toISOString() } : {};
        const { data, error } = await supabase.from("accounts").update(patch).eq("id", a.id).select("id,name").single();
        if (error) throw new Error(error.message);
        accountId = data.id as string; accountName = data.name as string;
      } else if (a.create) {
        const { data, error } = await supabase.from("accounts").insert({ name: a.create.name, type: a.create.type, last4: a.create.last4 ?? null, balance_paise: a.balance_paise ?? 0 }).select("id,name").single();
        if (error) throw new Error(error.message);
        accountId = data.id as string; accountName = data.name as string;
      }
    }

    let importId: string | null = null;
    if (input.file) {
      const { data, error } = await supabase
        .from("imports")
        .insert({ file_name: input.file.name.slice(0, 120), file_kind: input.file.kind, row_count: rows.length })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      importId = data.id as string;
    }

    const { data, error } = await supabase
      .from("transactions")
      .upsert(rows.map((r) => ({ ...r, import_id: importId, ...(accountId ? { account_id: accountId } : {}) })), { onConflict: "user_id,dedupe_hash", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    const added = data?.length ?? 0;
    if (importId) await supabase.from("imports").update({ added_count: added, skipped_count: rows.length - added }).eq("id", importId);
    done();
    return { ok: true, added, skipped: rows.length - added, importId, accountName };
  } catch (e) {
    return fail(e);
  }
}

/** Accounts for the import screen's "which account is this?" picker. */
export async function listAccounts(): Promise<{ id: string; name: string; type: string; last4: string | null; balance_paise: number }[]> {
  const { supabase } = await session();
  const { data } = await supabase.from("accounts").select("id,name,type,last4,balance_paise").eq("is_sample", false).order("created_at");
  return (data as { id: string; name: string; type: string; last4: string | null; balance_paise: number }[]) ?? [];
}

/** Which of these hashes are already saved, so the preview can mark them before import. */
export async function findExisting(hashes: string[]): Promise<string[]> {
  const { supabase } = await session();
  const list = z.array(z.string().max(64)).max(2000).parse(hashes);
  const found: string[] = [];
  for (let i = 0; i < list.length; i += 200) {
    const { data } = await supabase.from("transactions").select("dedupe_hash").in("dedupe_hash", list.slice(i, i + 200));
    found.push(...((data ?? []) as { dedupe_hash: string }[]).map((d) => d.dedupe_hash));
  }
  return found;
}

export async function updateTransaction(
  id: string,
  patch: { merchant_name: string; amount_paise: number; date: string; category_id: string; subcategory_id?: string | null; note?: string | null },
  alwaysForMerchant = false,
): Promise<ActionResult<{ alsoChanged: number }>> {
  try {
    const { supabase } = await session();
    const txId = z.string().uuid().parse(id);
    const p = z
      .object({ merchant_name: z.string().trim().min(1, "Give it a name.").max(80), amount_paise: Paise, date: IsoDate, category_id: CategoryId, subcategory_id: SubId, note: z.string().max(500).nullable().optional() })
      .parse(patch);
    const { data: before } = await supabase.from("transactions").select("merchant_name,merchant_raw,category_id").eq("id", txId).maybeSingle();
    const { error } = await supabase.from("transactions").update({ ...p, reviewed: true, updated_at: new Date().toISOString() }).eq("id", txId);
    if (error) throw new Error(error.message);

    let alsoChanged = 0;
    if (alwaysForMerchant && before) {
      const r = await applyToPayee(supabase, {
        name: before.merchant_name as string,
        raw: before.merchant_raw as string | null,
        fromCategory: before.category_id as string,
        category_id: p.category_id,
        subcategory_id: p.subcategory_id ?? null,
        renameTo: p.merchant_name !== before.merchant_name ? p.merchant_name : null,
        except: txId,
      });
      alsoChanged = r;
    }
    done();
    return { ok: true, alsoChanged };
  } catch (e) {
    return fail(e);
  }
}

/**
 * One correction fixes the rest: save a rule keyed on the payee's UPI ID (or name), and re-file
 * every other transaction from the same payee that Expensly had filed the same wrong way.
 * Rows you deliberately put somewhere else are left alone.
 */
async function applyToPayee(
  supabase: Awaited<ReturnType<typeof session>>["supabase"],
  a: { name: string; raw: string | null; fromCategory: string; category_id: string; subcategory_id: string | null; renameTo: string | null; except?: string },
): Promise<number> {
  const vpa = vpaOf(a.raw);
  if (!vpa && isGenericName(a.name)) return 0; // "Money sent" isn't one payee
  const rule = { category_id: a.category_id, subcategory_id: a.subcategory_id, rename_to: a.renameTo };
  await supabase.from("merchant_rules").upsert({ pattern: vpa ?? ruleKey(a.name), ...rule }, { onConflict: "user_id,pattern" });
  if (vpa && !isGenericName(a.name)) await supabase.from("merchant_rules").upsert({ pattern: ruleKey(a.renameTo ?? a.name), ...rule, rename_to: null }, { onConflict: "user_id,pattern" });

  const update: Record<string, unknown> = { category_id: a.category_id, subcategory_id: a.subcategory_id, reviewed: true, updated_at: new Date().toISOString() };
  if (a.renameTo) update.merchant_name = a.renameTo;
  let q = supabase.from("transactions").update(update).eq("category_id", a.fromCategory);
  q = vpa ? q.ilike("merchant_raw", `%${vpa.replace(/[%_\\]/g, "\\$&")}%`) : q.ilike("merchant_name", a.name.replace(/[%_\\]/g, "\\$&"));
  if (a.except) q = q.neq("id", a.except);
  const { data, error } = await q.select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/**
 * Change every transaction from one merchant at once: rename it and/or move it to a category.
 * Saves a rule so future imports follow, and marks the rows reviewed.
 */
export async function updateMerchant(
  merchantName: string,
  patch: { rename_to?: string; category_id?: string; subcategory_id?: string | null },
): Promise<ActionResult<{ changed: number }>> {
  try {
    const { supabase } = await session();
    const from = z.string().trim().min(1).max(80).parse(merchantName);
    const p = z.object({ rename_to: z.string().trim().min(1, "Give it a name.").max(80).optional(), category_id: CategoryId.optional(), subcategory_id: SubId }).parse(patch);
    const update: Record<string, unknown> = { reviewed: true, updated_at: new Date().toISOString() };
    if (p.rename_to) update.merchant_name = p.rename_to;
    if (p.category_id) { update.category_id = p.category_id; update.subcategory_id = p.subcategory_id ?? null; }
    const { data, error } = await supabase.from("transactions").update(update).eq("merchant_name", from).select("id");
    if (error) throw new Error(error.message);
    if (p.category_id || p.rename_to) {
      const { data: existing } = await supabase.from("merchant_rules").select("category_id,subcategory_id").eq("pattern", ruleKey(from)).maybeSingle();
      const category = p.category_id ?? (existing?.category_id as string | undefined);
      if (category) {
        const rule = { category_id: category, subcategory_id: p.category_id ? p.subcategory_id ?? null : (existing?.subcategory_id as string | null) ?? null, rename_to: p.rename_to ?? null };
        await supabase.from("merchant_rules").upsert({ pattern: ruleKey(from), ...rule }, { onConflict: "user_id,pattern" });
        if (p.rename_to) await supabase.from("merchant_rules").upsert({ pattern: ruleKey(p.rename_to), ...rule, rename_to: null }, { onConflict: "user_id,pattern" });
      }
    }
    done();
    return { ok: true, changed: data?.length ?? 0 };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Run the current categoriser over everything imported. Rows you reviewed keep their category
 * (they only gain a subcategory when Expensly agrees on the category); the rest are re-filed.
 * With `dryRun`, reports what would change without saving.
 */
export async function reclassifyAll(dryRun = false): Promise<ActionResult<{ changed: number; renamed: number; detailed: number; examples: { from: string; to: string; name: string }[] }>> {
  try {
    const { supabase } = await session();
    const [{ data: ruleRows }, all] = await Promise.all([
      supabase.from("merchant_rules").select("pattern,category_id,subcategory_id,rename_to"),
      (async () => {
        const rows: Transaction[] = [];
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await supabase
            .from("transactions")
            .select("id,date,amount_paise,merchant_name,merchant_raw,category_id,subcategory_id,source,reviewed,note,account_id,import_id")
            .range(offset, offset + 999);
          if (error) throw new Error(error.message);
          rows.push(...((data as Transaction[]) ?? []));
          if (!data || data.length < 1000) break;
        }
        return rows;
      })(),
    ]);
    const rules = (ruleRows as MerchantRule[] | null) ?? [];
    // Memory only from rows you touched yourself, not from Expensly's earlier guesses.
    const memory = buildMemory(all.filter((t) => t.reviewed && t.source === "manual"));
    const updates: Partial<Transaction>[] = [];
    const examples: { from: string; to: string; name: string }[] = [];
    let changed = 0, renamed = 0, detailed = 0;

    for (const t of all) {
      if (t.source === "sample" || t.source === "manual" || !t.merchant_raw) continue;
      const c = prepareRow({ date: t.date, amount_paise: t.amount_paise, merchant_raw: t.merchant_raw, source: t.source === "shortcut" ? "shortcut" : t.source }, rules, memory);
      const next = { ...t };
      // Rows without a subcategory were filed by Expensly's older categoriser, not by you, so a confident new answer replaces them.
      // So were "Shopping · Other" rows: that used to be where unknown merchants landed.
      const oldFallback = t.category_id === "shop" && t.subcategory_id === "other" && c.category_id !== "shop";
      const oldGuess = t.reviewed && ((!t.subcategory_id && c.confidence >= 0.7) || oldFallback);
      if (t.reviewed && !oldGuess) {
        if (!t.subcategory_id && c.category_id === t.category_id && c.subcategory_id) { next.subcategory_id = c.subcategory_id; detailed++; }
      } else {
        if (c.category_id !== t.category_id) {
          changed++;
          if (examples.length < 8) examples.push({ from: t.category_id, to: c.category_id, name: c.merchant_name });
        } else if (c.subcategory_id && c.subcategory_id !== t.subcategory_id) detailed++;
        if (c.merchant_name !== t.merchant_name) renamed++;
        next.category_id = c.category_id;
        next.subcategory_id = c.subcategory_id;
        next.merchant_name = c.merchant_name;
      }
      if (next.category_id !== t.category_id || next.subcategory_id !== t.subcategory_id || next.merchant_name !== t.merchant_name) updates.push(next);
    }

    if (!dryRun) {
      for (let i = 0; i < updates.length; i += 500) {
        const { error } = await supabase.from("transactions").upsert(updates.slice(i, i + 500), { onConflict: "id" });
        if (error) throw new Error(error.message);
      }
      done();
    }
    return { ok: true, changed, renamed, detailed, examples };
  } catch (e) {
    return fail(e);
  }
}

export async function setReviewed(ids: string[], reviewed = true): Promise<ActionResult> {
  try {
    const { supabase } = await session();
    const { error } = await supabase.from("transactions").update({ reviewed }).in("id", z.array(z.string().uuid()).max(2000).parse(ids));
    if (error) throw new Error(error.message);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTransaction(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await session();
    const { error } = await supabase.from("transactions").delete().eq("id", z.string().uuid().parse(id));
    if (error) throw new Error(error.message);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function undoImport(importId: string): Promise<ActionResult> {
  try {
    const { supabase } = await session();
    const { error } = await supabase.from("imports").delete().eq("id", z.string().uuid().parse(importId));
    if (error) throw new Error(error.message);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────── budgets ───────────────────────── */

export async function setBudget(categoryId: string, limitPaise: number): Promise<ActionResult> {
  try {
    const { supabase } = await session();
    const limit = z.number().int().min(0).max(1e11).parse(limitPaise);
    const { error } = await supabase
      .from("budgets")
      .upsert({ category_id: CategoryId.parse(categoryId), month: monthStart(todayISO()), limit_paise: limit }, { onConflict: "user_id,category_id,month" });
    if (error) throw new Error(error.message);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────── your own categories ───────────────────────── */

const CategoryInput = z.object({
  name: z.string().trim().min(1, "Name the category.").max(40, "Keep the name under 40 characters."),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a colour."),
  grp: z.enum(["needs", "wants", "avoidable"]),
  budget_paise: z.number().int().min(0).max(1e11).optional(),
});

/** A spending category of your own, with an optional monthly budget from this month on. */
export async function createCategory(input: z.input<typeof CategoryInput>): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, user } = await session();
    const c = CategoryInput.parse(input);
    const { data: existing } = await supabase.from("categories").select("id,name,sort");
    const clash = (existing ?? []).find((x) => String(x.name).trim().toLowerCase() === c.name.toLowerCase());
    if (clash) throw new Error(`You already have a category called ${clash.name}.`);
    const id = `u_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const sort = 100 + (existing ?? []).filter((x) => Number(x.sort) >= 100).length;
    const { error } = await supabase.from("categories").insert({ id, user_id: user.id, name: c.name, color: c.color, kind: "spend", grp: c.grp, default_budget_paise: c.budget_paise ?? 0, sort });
    if (error) throw new Error(error.message.includes("30 of your own") ? "You can have up to 30 of your own categories." : error.message);
    if (c.budget_paise) {
      await supabase.from("budgets").upsert({ category_id: id, month: monthStart(todayISO()), limit_paise: c.budget_paise }, { onConflict: "user_id,category_id,month" });
    }
    done();
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function updateCategory(id: string, input: Omit<z.input<typeof CategoryInput>, "budget_paise">): Promise<ActionResult> {
  try {
    const { supabase, user } = await session();
    const cid = CategoryId.parse(id);
    const c = CategoryInput.omit({ budget_paise: true }).parse(input);
    const { data: existing } = await supabase.from("categories").select("id,name");
    const clash = (existing ?? []).find((x) => x.id !== cid && String(x.name).trim().toLowerCase() === c.name.toLowerCase());
    if (clash) throw new Error(`You already have a category called ${clash.name}.`);
    const { data, error } = await supabase.from("categories").update({ name: c.name, color: c.color, grp: c.grp }).eq("id", cid).eq("user_id", user.id).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Only categories you made can be changed.");
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Removes one of your categories. Its transactions and merchant rules move to another category
 * first (Uncategorised by default), so nothing is lost; its budgets go with it.
 */
export async function deleteCategory(id: string, moveTo = "uncat"): Promise<ActionResult<{ moved: number }>> {
  try {
    const { supabase, user } = await session();
    const cid = CategoryId.parse(id), to = CategoryId.parse(moveTo);
    if (cid === to) throw new Error("Pick a different category to move things to.");
    const { data: own } = await supabase.from("categories").select("id").eq("id", cid).eq("user_id", user.id).maybeSingle();
    if (!own) throw new Error("Only categories you made can be deleted.");
    const { data: target } = await supabase.from("categories").select("id,kind").eq("id", to).maybeSingle();
    if (!target) throw new Error("That category doesn't exist.");
    const { data: moved, error: mvErr } = await supabase.from("transactions").update({ category_id: to, subcategory_id: null, updated_at: new Date().toISOString() }).eq("category_id", cid).select("id");
    if (mvErr) throw new Error(mvErr.message);
    await supabase.from("merchant_rules").update({ category_id: to, subcategory_id: null }).eq("category_id", cid);
    await supabase.from("budgets").delete().eq("category_id", cid);
    const { error } = await supabase.from("categories").delete().eq("id", cid).eq("user_id", user.id);
    if (error) throw new Error(error.message);
    done();
    return { ok: true, moved: moved?.length ?? 0 };
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────── AI connection ───────────────────────── */

const ProviderId = z.enum(["gemini", "openai", "groq", "anthropic", "openrouter"]);

/** Connect your own Gemini / OpenAI / Groq / Claude / OpenRouter key. It's checked, then stored encrypted. */
export async function connectAi(provider: string, key: string): Promise<ActionResult<{ model: string }>> {
  try {
    const { supabase } = await session();
    const id = ProviderId.parse(provider);
    const k = z.string().trim().min(10, "Paste the whole key.").max(400).regex(/^\S+$/, "Keys don't contain spaces.").parse(key);
    const [{ verifyKey }, { encryptKey }] = await Promise.all([import("@/lib/ai/provider"), import("@/lib/ai/secret")]);
    const check = await verifyKey(id, k);
    if (!check.ok) throw new Error(check.error);
    const { error } = await supabase
      .from("ai_connections")
      .upsert({ provider: id, key_ciphertext: encryptKey(k), key_hint: k.slice(-4), model: check.model }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    done();
    return { ok: true, model: check.model };
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectAi(): Promise<ActionResult> {
  try {
    const { supabase, user } = await session();
    const { error } = await supabase.from("ai_connections").delete().eq("user_id", user.id);
    if (error) throw new Error(error.message);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────── income ───────────────────────── */

/** Save your expected monthly income. Applies from this month on (or next month, for a raise that starts later). */
export async function saveIncomePlan(input: { salary_paise: number; other_paise: number; payday: number | null; savings_goal_pct: number; from: "this" | "next" }): Promise<ActionResult> {
  try {
    const { supabase } = await session();
    const p = z
      .object({
        salary_paise: z.number().int().min(0).max(1e12, "That amount is too large."),
        other_paise: z.number().int().min(0).max(1e12, "That amount is too large."),
        payday: z.number().int().min(1).max(31).nullable(),
        savings_goal_pct: z.number().int().min(0).max(90),
        from: z.enum(["this", "next"]),
      })
      .parse(input);
    const month = p.from === "next" ? addMonths(monthStart(todayISO()), 1) : monthStart(todayISO());
    const { error } = await supabase
      .from("income_plans")
      .upsert({ month, salary_paise: p.salary_paise, other_paise: p.other_paise, payday: p.payday, savings_goal_pct: p.savings_goal_pct }, { onConflict: "user_id,month" });
    if (error) throw new Error(error.message);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────── accounts & net worth ───────────────────────── */

async function snapshotNetWorth(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from("accounts").select("balance_paise");
  const bal = ((data ?? []) as { balance_paise: number }[]).map((a) => Number(a.balance_paise));
  await supabase.from("net_worth_snapshots").upsert(
    {
      month: monthStart(todayISO()),
      assets_paise: bal.filter((b) => b > 0).reduce((s, b) => s + b, 0),
      liabilities_paise: -bal.filter((b) => b < 0).reduce((s, b) => s + b, 0),
    },
    { onConflict: "user_id,month" },
  );
}

const AccountInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name the account.").max(60),
  type: z.enum(["bank", "card", "investment", "cash", "loan"]),
  balance_paise: z.number().int().refine((n) => Math.abs(n) < 1e13, "That balance is too large."),
  last4: z.string().regex(/^\d{4}$/, "Last 4 digits only.").nullable().optional(),
});

export async function saveAccount(input: z.input<typeof AccountInput>): Promise<ActionResult> {
  try {
    const { supabase } = await session();
    const a = AccountInput.parse(input);
    // Cards and loans are money owed: store them negative whatever sign was typed.
    const balance = a.type === "card" || a.type === "loan" ? -Math.abs(a.balance_paise) : a.balance_paise;
    const row = { name: a.name, type: a.type, balance_paise: balance, last4: a.last4 ?? null, updated_at: new Date().toISOString() };
    const { error } = a.id ? await supabase.from("accounts").update(row).eq("id", a.id) : await supabase.from("accounts").insert(row);
    if (error) throw new Error(error.message);
    await snapshotNetWorth(supabase);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAccount(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await session();
    const { error } = await supabase.from("accounts").delete().eq("id", z.string().uuid().parse(id));
    if (error) throw new Error(error.message);
    await snapshotNetWorth(supabase);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────── goals ───────────────────────── */

const GoalLinkInput = z
  .object({ kind: z.enum(["invest", "payee"]), value: z.string().trim().min(2, "Type at least 2 letters of the payee.").max(60).nullable().optional() })
  .refine((l) => l.kind !== "payee" || !!l.value, "Type the payee's name or UPI ID.")
  .nullable()
  .optional();

const linkColumns = (link: z.infer<typeof GoalLinkInput>) =>
  link ? { link_kind: link.kind, link_value: link.kind === "payee" ? link.value!.toLowerCase() : null, link_from: todayISO() } : { link_kind: null, link_value: null, link_from: null };

export async function createGoal(input: { name: string; target_paise: number; target_date: string | null; color: string; link?: { kind: "invest" | "payee"; value?: string | null } | null }): Promise<ActionResult> {
  try {
    const { supabase } = await session();
    const { link, ...g } = z
      .object({
        name: z.string().trim().min(1, "Name the goal.").max(60),
        target_paise: z.number().int().positive("Set a target above zero."),
        target_date: IsoDate.nullable(),
        color: z.string().regex(/^#[0-9a-f]{6}$/i),
        link: GoalLinkInput,
      })
      .parse(input);
    const { error } = await supabase.from("goals").insert({ ...g, ...linkColumns(link) });
    if (error) throw new Error(error.message);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function contributeToGoal(goalId: string, amountPaise: number): Promise<ActionResult<{ reached: boolean }>> {
  try {
    const { supabase } = await session();
    const id = z.string().uuid().parse(goalId);
    const amount = z.number().int().positive("Enter an amount above zero.").parse(amountPaise);
    const { data: goal, error: readErr } = await supabase.from("goals").select("saved_paise,target_paise").eq("id", id).single();
    if (readErr || !goal) throw new Error("Couldn't find that goal.");
    const saved = Math.min(Number(goal.target_paise), Number(goal.saved_paise) + amount);
    const { error } = await supabase.from("goals").update({ saved_paise: saved }).eq("id", id);
    if (error) throw new Error(error.message);
    await supabase.from("goal_contributions").insert({ goal_id: id, amount_paise: amount });
    done();
    return { ok: true, reached: saved >= Number(goal.target_paise) };
  } catch (e) {
    return fail(e);
  }
}

/** Start (or stop) filling a goal automatically. Counting starts today so past money isn't double-counted. */
export async function setGoalLink(goalId: string, link: { kind: "invest" | "payee"; value?: string | null } | null): Promise<ActionResult> {
  try {
    const { supabase } = await session();
    const id = z.string().uuid().parse(goalId);
    const { error } = await supabase.from("goals").update(linkColumns(GoalLinkInput.parse(link))).eq("id", id);
    if (error) throw new Error(error.message);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await session();
    const { error } = await supabase.from("goals").delete().eq("id", z.string().uuid().parse(id));
    if (error) throw new Error(error.message);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────── sample data ───────────────────────── */

export async function loadSampleData(): Promise<ActionResult> {
  try {
    const { supabase } = await session();
    const today = todayISO();
    await removeSample(supabase);
    const tx = sampleTransactions(today).map((t) => ({ ...t, source: "sample" }));
    for (let i = 0; i < tx.length; i += 500) {
      const { error } = await supabase.from("transactions").insert(tx.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }
    await supabase.from("accounts").insert(SAMPLE_ACCOUNTS.map((a) => ({ ...a, is_sample: true })));
    await supabase.from("goals").insert(
      SAMPLE_GOALS.map(({ months, ...g }) => ({ ...g, target_date: addMonths(monthStart(today), months), is_sample: true })),
    );
    await supabase.from("net_worth_snapshots").upsert(sampleSnapshots(today), { onConflict: "user_id,month", ignoreDuplicates: true });
    await snapshotNetWorth(supabase);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

async function removeSample(supabase: Awaited<ReturnType<typeof createClient>>) {
  await supabase.from("transactions").delete().eq("source", "sample");
  await supabase.from("accounts").delete().eq("is_sample", true);
  await supabase.from("goals").delete().eq("is_sample", true);
}

export async function removeSampleData(): Promise<ActionResult> {
  try {
    const { supabase } = await session();
    await removeSample(supabase);
    await supabase.from("net_worth_snapshots").delete().lt("month", monthStart(todayISO()));
    await snapshotNetWorth(supabase);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────── settings ───────────────────────── */

/** Creates a new iOS Shortcut token. Only its hash is stored; the token is shown once. */
export async function rotateIngestToken(): Promise<ActionResult<{ token: string }>> {
  try {
    const { supabase, user } = await session();
    const token = "kosh_" + randomBytes(24).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    const { error } = await supabase.from("profiles").update({ ingest_token_hash: hash }).eq("id", user.id);
    if (error) throw new Error(error.message);
    done();
    return { ok: true, token };
  } catch (e) {
    return fail(e);
  }
}

/** Deletes every row this user owns. With the service key set, deletes the login too. */
export async function deleteEverything(confirmText: string): Promise<ActionResult> {
  try {
    if (confirmText.trim().toUpperCase() !== "DELETE") throw new Error("Type DELETE to confirm.");
    const { supabase, user } = await session();
    const admin = createServiceClient();
    if (!admin) throw new Error("Account deletion isn't available right now. Try again later.");
    // Deleting the login removes every row that belongs to it (all tables cascade), sign-in included.
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`Couldn't delete your account: ${error.message}`);
    await supabase.auth.signOut().catch(() => undefined);
  } catch (e) {
    return fail(e);
  }
  redirect("/login");
}

/* ───────────────────────── ask ───────────────────────── */

export async function askKosh(question: string): Promise<ActionResult<{ answer: string }>> {
  try {
    const q = z.string().trim().min(2, "Ask a question first.").max(300).parse(question);
    const [{ answerQuestion }, data] = await Promise.all([import("@/lib/ask"), import("@/lib/data")]);
    const [tx, cats, budgetRows, accounts, incomePlans] = await Promise.all([data.getRecentTransactions(), data.getCategories(), data.getBudgetRows(), data.getAccounts(), data.getIncomePlans()]);
    return { ok: true, answer: answerQuestion(q, { today: todayISO(), tx, cats, budgetRows, accounts, incomePlans }) };
  } catch (e) {
    return fail(e);
  }
}
