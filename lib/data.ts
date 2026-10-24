import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SYSTEM_CATEGORIES } from "@/lib/categories";
import { addMonths, monthStart, todayISO } from "@/lib/dates";
import type { Account, BudgetRow, Category, Goal, IncomePlanRow, MerchantRule, Snapshot, Transaction } from "@/lib/types";

const TX_COLUMNS = "id,date,amount_paise,merchant_name,merchant_raw,category_id,subcategory_id,source,reviewed,note,account_id,import_id";

/** The signed-in user, or a redirect to /login. Cached per request. */
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
});

export const getCategories = cache(async (): Promise<Category[]> => {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("categories").select("id,name,color,kind,default_budget_paise,sort").order("sort");
  return (data as Category[] | null)?.length ? (data as Category[]) : SYSTEM_CATEGORIES;
});

export const getRules = cache(async (): Promise<MerchantRule[]> => {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("merchant_rules").select("pattern,category_id,subcategory_id,rename_to");
  return (data as MerchantRule[] | null) ?? [];
});

/** This month and the five before it: enough for cash flow, insights and recurring detection. */
export const getRecentTransactions = cache(async (): Promise<Transaction[]> => {
  const { supabase } = await requireUser();
  const from = addMonths(monthStart(todayISO()), -5);
  const rows: Transaction[] = [];
  // PostgREST caps a response at 1000 rows by default, so page through.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("transactions")
      .select(TX_COLUMNS)
      .gte("date", from)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + 999);
    if (error) throw new Error(`Couldn't load transactions: ${error.message}`);
    rows.push(...((data as Transaction[]) ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
});

export const getBudgetRows = cache(async (): Promise<BudgetRow[]> => {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("budgets").select("category_id,month,limit_paise");
  return (data as BudgetRow[] | null) ?? [];
});

export const getAccounts = cache(async (): Promise<Account[]> => {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("accounts").select("id,name,type,balance_paise,last4,is_sample,updated_at").order("created_at");
  return (data as Account[] | null) ?? [];
});

export const getGoals = cache(async (): Promise<Goal[]> => {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("goals").select("id,name,target_paise,saved_paise,target_date,color,is_sample,link_kind,link_value,link_from,created_at").order("created_at");
  return (data as Goal[] | null) ?? [];
});

export const getSnapshots = cache(async (): Promise<Snapshot[]> => {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("net_worth_snapshots").select("month,assets_paise,liabilities_paise").order("month").limit(24);
  return (data as Snapshot[] | null) ?? [];
});

export const getIncomePlans = cache(async (): Promise<IncomePlanRow[]> => {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("income_plans").select("month,salary_paise,other_paise,payday,savings_goal_pct").order("month");
  return ((data as IncomePlanRow[] | null) ?? []).map((r) => ({ ...r, salary_paise: Number(r.salary_paise), other_paise: Number(r.other_paise) }));
});

/** Which AI the person connected (never the key itself). */
export const getAiConnection = cache(async (): Promise<{ provider: string; key_hint: string; model: string } | null> => {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("ai_connections").select("provider,key_hint,model").maybeSingle();
  return (data as { provider: string; key_hint: string; model: string } | null) ?? null;
});

export const getProfile = cache(async () => {
  const { supabase, user } = await requireUser();
  const { data } = await supabase.from("profiles").select("name,ingest_token_hash,notify_budget,notify_bills,notify_weekly,onboarding_dismissed").eq("id", user.id).maybeSingle();
  return {
    email: user.email ?? "",
    name: (data?.name as string | undefined) ?? "",
    hasIngestToken: Boolean(data?.ingest_token_hash),
    notify: { budget: data?.notify_budget !== false, bills: data?.notify_bills !== false, weekly: data?.notify_weekly !== false },
    onboardingDismissed: data?.onboarding_dismissed === true,
  };
});

/** Every transaction between two dates (inclusive), for looking back past the six-month window. */
export async function getTransactionsBetween(from: string, to: string): Promise<Transaction[]> {
  const { supabase } = await requireUser();
  const rows: Transaction[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("transactions")
      .select(TX_COLUMNS)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + 999);
    if (error) throw new Error(`Couldn't load transactions: ${error.message}`);
    rows.push(...((data as Transaction[]) ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/** The months that have any transactions, newest first ("YYYY-MM-01"). */
export const getActiveMonths = cache(async (): Promise<string[]> => {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("tx_months");
  if (error || !data) return [];
  return (data as { month: string }[]).map((r) => r.month.slice(0, 10));
});

