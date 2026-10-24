import { createClient } from "@/lib/supabase/server";
import { fullCategoryName, subName } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Text that starts like a formula could run in Excel; a leading ' keeps it as text. */
const text = (v: unknown) => { const s = v == null ? "" : String(v); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };

const TABLES = ["transactions", "accounts", "goals", "goal_contributions", "budgets", "income_plans", "merchant_rules", "imports", "net_worth_snapshots", "notifications"] as const;

/** Every transaction as CSV, newest first. Amounts in rupees, negative = money out. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const day = new Date().toISOString().slice(0, 10);

  // Everything Expensly holds about you, as JSON (your right to a copy of your data).
  if (new URL(req.url).searchParams.get("format") === "json") {
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), email: user.email, account_created: user.created_at };
    const { data: profile } = await supabase.from("profiles").select("name,month_start_day,notify_budget,notify_bills,notify_weekly,created_at").eq("id", user.id).maybeSingle();
    out.profile = profile;
    for (const t of TABLES) {
      const rows: unknown[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.from(t).select("*").range(offset, offset + 999);
        if (error) break; // a table this account can't read is skipped, not fatal
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      out[t] = rows;
    }
    return new Response(JSON.stringify(out, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="expensly-export-${day}.json"`, "Cache-Control": "no-store" },
    });
  }

  const lines = ["date,merchant,amount_inr,category,subcategory,source,reviewed,note"];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("transactions")
      .select("date,merchant_name,amount_paise,category_id,subcategory_id,source,reviewed,note")
      .order("date", { ascending: false })
      .range(offset, offset + 999);
    if (error) return new Response(error.message, { status: 500 });
    for (const t of data ?? []) {
      lines.push([t.date, text(t.merchant_name), (Number(t.amount_paise) / 100).toFixed(2), fullCategoryName(t.category_id, null), subName(t.category_id, t.subcategory_id) ?? "", t.source, t.reviewed, text(t.note)].map(cell).join(","));
    }
    if (!data || data.length < 1000) break;
  }
  // The byte-order mark makes Excel open ₹ and Indian names correctly.
  return new Response("\uFEFF" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="expensly-transactions-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
