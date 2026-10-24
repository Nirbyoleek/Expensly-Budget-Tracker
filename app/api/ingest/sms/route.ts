import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { parseSms } from "@/lib/ingest/parsers";
import { prepareRows } from "@/lib/ingest/core";
import { todayISO } from "@/lib/dates";
import type { MerchantRule } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Simple in-memory limiter: 60 messages a minute per token, per server instance. */
const hits = new Map<string, number[]>();
function limited(key: string) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > 60;
}

/**
 * Called by the iOS Shortcut with the text of a bank SMS.
 *   POST /api/ingest/sms
 *   Authorization: Bearer kosh_…
 *   Body: the SMS as plain text, or JSON { "text": "…" }
 * Rows land as "to review". The token can only add transactions.
 */
export async function POST(req: Request) {
  const admin = createServiceClient();
  if (!admin) return json({ error: "SMS forwarding isn't set up on this server (SUPABASE_SERVICE_ROLE_KEY is missing)." }, 503);

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token.startsWith("kosh_")) return json({ error: "Missing or malformed token." }, 401);
  const hash = createHash("sha256").update(token).digest("hex");
  if (limited(hash)) return json({ error: "Too many messages. Try again in a minute." }, 429);

  const { data: profile } = await admin.from("profiles").select("id").eq("ingest_token_hash", hash).maybeSingle();
  if (!profile) return json({ error: "Unknown token. Create a new one in Expensly → Settings." }, 401);

  const raw = await req.text();
  let text = raw;
  try {
    const body = JSON.parse(raw);
    if (body && typeof body.text === "string") text = body.text;
  } catch {
    /* plain text body */
  }
  text = text.slice(0, 4000);

  const { data: rules } = await admin.from("merchant_rules").select("pattern,category_id,subcategory_id,rename_to").eq("user_id", profile.id);
  const rows = prepareRows(parseSms(text, todayISO(), "shortcut"), (rules as MerchantRule[]) ?? []);
  if (!rows.length) return json({ added: 0, message: "No amount found in that message, so nothing was added." });

  // ?dry=1: check the token and show how the message would be read, without saving anything.
  if (new URL(req.url).searchParams.get("dry") === "1") {
    return json({ added: 0, dryRun: true, message: "Connected ✓ This would be added: " + rows.map((r) => `${r.merchant_name} ₹${Math.abs(r.amount_paise / 100).toLocaleString("en-IN")}`).join(", "), rows: rows.map((r) => ({ date: r.date, merchant: r.merchant_name, amount: r.amount_paise / 100, category: r.category_id })) });
  }

  const { data, error } = await admin
    .from("transactions")
    .upsert(
      rows.map((r) => ({
        user_id: profile.id,
        date: r.date,
        amount_paise: r.amount_paise,
        merchant_name: r.merchant_name,
        merchant_raw: r.merchant_raw,
        category_id: r.category_id,
        subcategory_id: r.subcategory_id,
        source: "shortcut",
        reviewed: false,
        dedupe_hash: r.dedupe_hash,
      })),
      { onConflict: "user_id,dedupe_hash", ignoreDuplicates: true },
    )
    .select("merchant_name,amount_paise");
  if (error) return json({ error: "Couldn't save that message." }, 500);

  const added = (data ?? []) as { merchant_name: string; amount_paise: number }[];
  return json({
    added: added.length,
    message: added.length
      ? added.map((r) => `${r.merchant_name} ₹${Math.abs(Number(r.amount_paise) / 100).toLocaleString("en-IN")}`).join(", ") + " added to Expensly"
      : "Already in Expensly",
  });
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
