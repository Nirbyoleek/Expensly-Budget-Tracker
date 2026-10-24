import type { Goal, Transaction } from "./types";

/** What fills a goal on its own: money you put into investments, or payments to one payee (an RD, a savings account). */
export type GoalLink = { kind: "invest" | "payee"; value: string | null; from: string };

export const goalLink = (g: Goal): GoalLink | null =>
  g.link_kind === "invest" ? { kind: "invest", value: null, from: g.link_from ?? g.created_at?.slice(0, 10) ?? "1970-01-01" }
  : g.link_kind === "payee" && g.link_value ? { kind: "payee", value: g.link_value.toLowerCase(), from: g.link_from ?? g.created_at?.slice(0, 10) ?? "1970-01-01" }
  : null;

export function linkMatches(link: GoalLink, t: Transaction) {
  if (t.amount_paise >= 0 || t.date < link.from) return false;
  if (link.kind === "invest") return t.category_id === "invest";
  const v = link.value ?? "";
  return t.merchant_name.toLowerCase().includes(v) || (t.merchant_raw ?? "").toLowerCase().includes(v);
}

/** Saved so far: what you added by hand plus everything the link picked up since it was set. */
export function goalProgress(g: Goal, tx: Transaction[]) {
  const link = goalLink(g);
  const rows = link ? tx.filter((t) => linkMatches(link, t)) : [];
  const auto = rows.reduce((s, t) => s - t.amount_paise, 0);
  const saved = g.saved_paise + auto;
  const last = rows.reduce<string | null>((m, t) => (!m || t.date > m ? t.date : m), null);
  return { saved, auto, count: rows.length, last, link, reached: saved >= g.target_paise };
}
