import { TAXONOMY } from "./taxonomy";
import type { Transaction } from "./types";

/**
 * Activity search. Plain words match the merchant or note; extra powers:
 *   >500  <2000  =199       amount (rupees)
 *   food  delivery          a category or subcategory name (or cat:food, sub:delivery)
 *   is:review is:refund is:income is:recurring-free
 *   oct  sep                a month
 */
export type Query = { words: string[]; min?: number; max?: number; eq?: number; cats: string[]; subs: string[]; is: string[]; month?: number };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseQuery(q: string): Query {
  const out: Query = { words: [], cats: [], subs: [], is: [] };
  for (const raw of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const num = /^([<>=])₹?([\d,.]+)k?$/.exec(raw);
    if (num) {
      const v = parseFloat(num[2].replace(/,/g, "")) * (raw.endsWith("k") ? 1000 : 1) * 100;
      if (num[1] === ">") out.min = v; else if (num[1] === "<") out.max = v; else out.eq = v;
      continue;
    }
    const [k, v] = raw.includes(":") ? raw.split(":", 2) : ["", raw];
    if (k === "is" && v) { out.is.push(v); continue; }
    if (k === "cat" || k === "in") { const c = findCat(v); if (c) out.cats.push(c); continue; }
    if (k === "sub") { const s = findSub(v); if (s) out.subs.push(s); continue; }
    if (!k && isMonthWord(v)) { out.month = MONTHS.indexOf(v.slice(0, 3)) + 1; continue; }
    out.words.push(raw);
  }
  return out;
}

const MONTH_WORDS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const isMonthWord = (v: string) => MONTH_WORDS.some((m) => m.startsWith(v) && v.length >= 3);

function findCat(v: string) {
  return TAXONOMY.find((c) => c.id === v || c.name.toLowerCase().startsWith(v))?.id;
}
function findSub(v: string) {
  for (const c of TAXONOMY) for (const s of c.subs) if (s.id === v || s.name.toLowerCase().startsWith(v)) return `${c.id}:${s.id}`;
  return undefined;
}

export function matches(t: Transaction, q: Query): boolean {
  const amt = Math.abs(t.amount_paise);
  if (q.min !== undefined && amt <= q.min) return false;
  if (q.max !== undefined && amt >= q.max) return false;
  if (q.eq !== undefined && amt !== q.eq) return false;
  if (q.month && Number(t.date.slice(5, 7)) !== q.month) return false;
  if (q.cats.length && !q.cats.includes(t.category_id)) return false;
  if (q.subs.length && !q.subs.includes(`${t.category_id}:${t.subcategory_id}`)) return false;
  for (const f of q.is) {
    if (f === "review" && t.reviewed) return false;
    if (f === "income" && !(t.amount_paise > 0 && t.category_id === "income")) return false;
    if ((f === "in" || f === "credit" || f === "credits") && !(t.amount_paise > 0)) return false;
    if ((f === "out" || f === "debit" || f === "debits") && !(t.amount_paise < 0)) return false;
    if (f === "refund" && !(t.amount_paise > 0 && t.category_id !== "income" && t.category_id !== "xfer")) return false;
    if (f === "fee" || f === "fees") { if (t.category_id !== "fees") return false; }
  }
  if (!q.words.length) return true;
  const hay = `${t.merchant_name} ${t.note ?? ""}`.toLowerCase();
  const catDef = TAXONOMY.find((c) => c.id === t.category_id);
  const subLabel = catDef?.subs.find((s) => s.id === t.subcategory_id)?.name.toLowerCase() ?? "";
  const catLabel = catDef?.name.toLowerCase() ?? "";
  return q.words.every((w) => hay.includes(w) || subLabel.includes(w) || catLabel.includes(w) || String(amt / 100).startsWith(w));
}
