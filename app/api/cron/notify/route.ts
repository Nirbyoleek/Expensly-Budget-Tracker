import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { addMonths, monthStart, todayISO } from "@/lib/dates";
import { remindersFor } from "@/lib/reminders";
import { pushConfigured, sendPush } from "@/lib/push";
import { logError, ownerEmail } from "@/lib/errors";
import type { BudgetRow, Category, Transaction } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TX_COLUMNS = "id,date,amount_paise,merchant_name,merchant_raw,category_id,subcategory_id,source,reviewed,note,account_id,import_id";

/**
 * Runs once a day (vercel.json → 9:00 IST). For every user: work out today's reminders, save the
 * new ones (each key only once, ever), then wake their devices. Vercel calls it with CRON_SECRET.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 500 });

  const today = todayISO();
  const from = addMonths(monthStart(today), -3);
  const [{ data: profiles }, { data: catRows }, { data: users }] = await Promise.all([
    db.from("profiles").select("id,notify_budget,notify_bills,notify_weekly,created_at"),
    db.from("categories").select("id,name,color,kind,default_budget_paise,sort,user_id"),
    db.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const known = new Set((users?.users ?? []).map((u) => u.id));
  let created = 0, pushed = 0, gone = 0;

  for (const p of profiles ?? []) {
    if (!known.has(p.id as string)) continue;
    try {
      const uid = p.id as string;
      const [{ data: tx }, { data: budgetRows }] = await Promise.all([
        db.from("transactions").select(TX_COLUMNS).eq("user_id", uid).gte("date", from).order("date", { ascending: false }).limit(5000),
        db.from("budgets").select("category_id,month,limit_paise").eq("user_id", uid),
      ]);
      const cats = ((catRows ?? []) as (Category & { user_id: string | null })[]).filter((c) => !c.user_id || c.user_id === uid);
      const days = Math.floor((Date.now() - new Date(p.created_at as string).getTime()) / 86400000);
      const list = remindersFor({
        today,
        tx: (tx as Transaction[]) ?? [],
        cats,
        budgetRows: (budgetRows as BudgetRow[]) ?? [],
        prefs: { budget: p.notify_budget !== false, bills: p.notify_bills !== false, weekly: p.notify_weekly !== false },
        signedUpDaysAgo: days,
      });
      if (!list.length) continue;
      // ignoreDuplicates: a key already sent is skipped, and only the new rows come back
      const { data: fresh } = await db
        .from("notifications")
        .upsert(list.map((r) => ({ user_id: uid, ...r })), { onConflict: "user_id,key", ignoreDuplicates: true })
        .select("id");
      if (!fresh?.length) continue;
      created += fresh.length;
      if (!pushConfigured()) continue;
      const { data: subs } = await db.from("push_subscriptions").select("id,endpoint").eq("user_id", uid);
      for (const s of subs ?? []) {
        const r = await sendPush(s.endpoint as string);
        if (r === "ok") pushed++;
        if (r === "gone") { gone++; await db.from("push_subscriptions").delete().eq("id", s.id); }
      }
    } catch (e) {
      console.error("reminders failed for a user", e);
      await logError("cron", `Reminders failed: ${e instanceof Error ? e.message : String(e)}`, { userId: p.id as string });
    }
  }

  // The owner's health report: what broke in the last day, grouped.
  let report = 0;
  const owner = (users?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === ownerEmail());
  if (owner) {
    const { data: errs } = await db.from("app_errors").select("source,message,path").gte("at", new Date(Date.now() - 86400000).toISOString()).limit(1000);
    if (errs?.length) {
      const groups = new Map<string, number>();
      for (const e of errs) { const k = `${e.source}: ${String(e.message).slice(0, 90)}`; groups.set(k, (groups.get(k) ?? 0) + 1); }
      const top = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n}× ${k}`);
      const { data: fresh } = await db.from("notifications").upsert(
        [{ user_id: owner.id, key: `errors:${today}`, title: `${errs.length} problem${errs.length === 1 ? "" : "s"} in Expensly yesterday`, body: top.join(" · ").slice(0, 300), url: "/settings#health" }],
        { onConflict: "user_id,key", ignoreDuplicates: true },
      ).select("id");
      report = errs.length;
      if (fresh?.length && pushConfigured()) {
        const { data: subs } = await db.from("push_subscriptions").select("endpoint").eq("user_id", owner.id);
        for (const s of subs ?? []) await sendPush(s.endpoint as string);
      }
    }
    // keep the table small: 30 days is plenty
    await db.from("app_errors").delete().lt("at", new Date(Date.now() - 30 * 86400000).toISOString());
  }
  return NextResponse.json({ ok: true, today, created, pushed, gone, errors: report });
}
