"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { pushConfigured, sendPush } from "@/lib/push";
import { track } from "@/lib/track";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong. Try again." });

async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session ended. Sign in again.");
  return { supabase, user };
}

export type Note = { id: string; title: string; body: string; url: string; created_at: string; read_at: string | null };

export async function listNotifications(): Promise<R<{ items: Note[]; unread: number }>> {
  try {
    const { supabase } = await me();
    const { data, error } = await supabase.from("notifications").select("id,title,body,url,created_at,read_at").order("created_at", { ascending: false }).limit(30);
    if (error) throw new Error(error.message);
    const items = (data as Note[]) ?? [];
    return { ok: true, items, unread: items.filter((n) => !n.read_at).length };
  } catch (e) {
    return fail(e);
  }
}

export async function markAllRead(): Promise<R> {
  try {
    const { supabase } = await me();
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function savePushSubscription(sub: { endpoint: string; p256dh: string; auth: string; ua?: string }): Promise<R> {
  try {
    const { supabase, user } = await me();
    const s = z.object({ endpoint: z.string().url().max(1000), p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100), ua: z.string().max(300).optional() }).parse(sub);
    // A device that was signed in as someone else hands its endpoint over to you.
    const admin = createServiceClient();
    if (admin) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint).neq("user_id", user.id);
    const { error } = await supabase.from("push_subscriptions").upsert({ user_id: user.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, user_agent: s.ua ?? null }, { onConflict: "endpoint" });
    if (error) throw new Error(error.message);
    track(supabase, "push_enabled", {});
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removePushSubscription(endpoint: string): Promise<R> {
  try {
    const { supabase } = await me();
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setNotifyPrefs(p: { budget: boolean; bills: boolean; weekly: boolean }): Promise<R> {
  try {
    const { supabase, user } = await me();
    const v = z.object({ budget: z.boolean(), bills: z.boolean(), weekly: z.boolean() }).parse(p);
    const { error } = await supabase.from("profiles").update({ notify_budget: v.budget, notify_bills: v.bills, notify_weekly: v.weekly }).eq("id", user.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Puts a test message in the bell and pings this person's devices, so they can see it works. */
export async function sendTestNotification(): Promise<R<{ devices: number }>> {
  try {
    const { user } = await me();
    const admin = createServiceClient();
    if (!admin) throw new Error("Notifications aren't set up on the server yet.");
    await admin.from("notifications").insert({ user_id: user.id, key: `test:${Date.now()}`, title: "Reminders are on ✓", body: "You'll hear about budgets running low, bills due tomorrow and a Monday summary.", url: "/home" });
    let devices = 0;
    if (pushConfigured()) {
      const { data: subs } = await admin.from("push_subscriptions").select("id,endpoint").eq("user_id", user.id);
      for (const s of subs ?? []) {
        const r = await sendPush(s.endpoint as string);
        if (r === "ok") devices++;
        if (r === "gone") await admin.from("push_subscriptions").delete().eq("id", s.id);
      }
    }
    return { ok: true, devices };
  } catch (e) {
    return fail(e);
  }
}

export async function dismissOnboarding(): Promise<R> {
  try {
    const { supabase, user } = await me();
    await supabase.from("profiles").update({ onboarding_dismissed: true }).eq("id", user.id);
    revalidatePath("/home");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
