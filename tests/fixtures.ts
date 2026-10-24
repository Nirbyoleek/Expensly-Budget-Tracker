import type { Transaction } from "@/lib/types";

let n = 0;
/** A transaction with sensible defaults. Amounts are in rupees here (negative = money out) to keep tests readable. */
export function tx(date: string, rupees: number, category_id: string, extra: Partial<Transaction> = {}): Transaction {
  n++;
  return {
    id: `t${n}`,
    date,
    amount_paise: Math.round(rupees * 100),
    merchant_name: extra.merchant_name ?? "Shop",
    merchant_raw: null,
    category_id,
    subcategory_id: null,
    source: "import",
    reviewed: true,
    note: null,
    account_id: null,
    import_id: null,
    ...extra,
  };
}

/** Every date from `from` to `to` inclusive (YYYY-MM-DD). */
export function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
