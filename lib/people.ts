import { vpaOf } from "./ingest/classify";
import type { Transaction } from "./types";

/**
 * Money between you and the people you pay over UPI (the "Sent to people" category), netted per
 * person. Grouped by UPI ID when the bank text has one, so "Rahul S" and "RAHUL SHARMA" with the same
 * VPA are one person.
 */
export type PersonBalance = {
  key: string;
  name: string;
  sent: number; // paise, positive
  received: number; // paise, positive
  /** sent − received: above zero means you've given more than you got back. */
  net: number;
  count: number;
  last: string;
};

export const personKey = (t: Pick<Transaction, "merchant_name" | "merchant_raw">) => {
  // banks glue "UPI-" or "UPI/" onto the ID; it isn't part of it
  const v = vpaOf(t.merchant_raw)?.replace(/^(?:upi|imps|neft|mob)[-/._]+/i, "");
  return v ? v : t.merchant_name.trim().toLowerCase().replace(/\s+/g, " ");
};

export function peopleBalances(tx: Transaction[], minNet = 10000): PersonBalance[] {
  const map = new Map<string, PersonBalance>();
  for (const t of tx) {
    if (t.category_id !== "people" || !t.amount_paise) continue;
    const key = personKey(t);
    const p = map.get(key) ?? { key, name: t.merchant_name, sent: 0, received: 0, net: 0, count: 0, last: t.date };
    if (t.amount_paise < 0) p.sent -= t.amount_paise;
    else p.received += t.amount_paise;
    p.count++;
    if (t.date >= p.last) { p.last = t.date; p.name = t.merchant_name; }
    map.set(key, p);
  }
  return [...map.values()]
    .map((p) => ({ ...p, net: p.sent - p.received }))
    // a one-off payment to a shopkeeper's personal UPI isn't a debt; show people money went both ways with, or big one-way amounts
    .filter((p) => Math.abs(p.net) >= minNet && (p.received > 0 || p.sent >= minNet * 10 || p.count >= 3))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}
