import { TRANSFER_RE } from "./merchants";
import type { MerchantRule } from "@/lib/types";
import { classify, cleanRaw, findBrand, type Classification, type Memory } from "./classify";


/* ───────────────────────── shared types ───────────────────────── */

export type IngestSource = "manual" | "sms" | "shortcut" | "import";

/** A row straight out of a parser, before categorizing. */
export type RawRow = {
  date: string; // YYYY-MM-DD
  amount_paise: number; // negative = money out
  merchant_raw: string;
  source: IngestSource;
  /** The running balance printed next to this row, when the statement has one. */
  balance_paise?: number;
};

/** A row ready to preview and insert. */
export type PreparedRow = RawRow & {
  merchant_name: string;
  category_id: string;
  subcategory_id: string | null;
  confidence: number; // 0–1; below REVIEW_THRESHOLD lands as "to review"
  reasons: string[];
  refund: boolean;
  is_transfer: boolean;
  dedupe_hash: string | null;
};

export const REVIEW_THRESHOLD = 0.7;

/* ───────────────────────── dates ───────────────────────── */

const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const p2 = (n: number) => String(n).padStart(2, "0");

/**
 * Day-first Indian formats: 22/10/2026, 22-10-26, 22.10.26, 22 Oct 2026, 22-Oct-26, 22Oct26, 22 Oct,
 * plus ISO 2026-10-22. A missing year is inferred so the date is never in the future.
 */
export const DATE_RE =
  /\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})[\/\-. ]?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\/\-., ]*(\d{4}|\d{2})?\b|\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})\b/i;

export function parseDate(text: string, today: string): { iso: string; index: number; length: number } | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  let y: number | undefined, mo: number, d: number;
  if (m[1]) {
    y = +m[1]; mo = +m[2]; d = +m[3];
  } else if (m[4]) {
    d = +m[4]; mo = MON[m[5].slice(0, 3).toLowerCase()]; y = m[6] ? +m[6] : undefined;
  } else {
    d = +m[7]; mo = +m[8]; y = +m[9];
  }
  if (y !== undefined && y < 100) y += 2000;
  if (!mo || mo > 12 || !d || d > 31) return null;
  const [ty, tm, td] = today.split("-").map(Number);
  if (y === undefined) {
    y = ty;
    if (mo > tm || (mo === tm && d > td + 1)) y -= 1;
  }
  return { iso: `${y}-${p2(mo)}-${p2(d)}`, index: m.index, length: m[0].length };
}

/* ───────────────────────── amounts ───────────────────────── */

/** "1,23,456.50" | "2499" | "340.0" → paise. NaN when it isn't a number. */
export function parseAmount(s: string | undefined | null): number {
  if (s == null) return NaN;
  const t = String(s).replace(/[₹,\s]|inr|rs\.?/gi, "").replace(/(cr|dr)\.?$/i, "");
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Math.round(parseFloat(t) * 100);
}

/* ───────────────────────── merchants & categories ───────────────────────── */

export { buildMemory, classify, cleanRaw, findBrand, isGenericName, mayBePerson, merchantCacheKey, payeeKey, ruleKey, vpaOf, type Classification, type Memory } from "./classify";

/** Turn bank noise ("UPI/DR/628193/ZOMATO/YESB/zomato@yes") into a clean name ("Zomato"). */
export function normalizeMerchant(raw: string): string {
  const name = cleanRaw(raw).name;
  const brand = findBrand(raw.split(" | ")[0]) ?? (name ? findBrand(name) : undefined);
  if (brand && brand.name !== "CRED Pay") return brand.name;
  return name || "Card payment";
}

/** Quick-add names are typed by the user: keep their words, just tidy them or swap in a brand name. */
export function manualName(raw: string): string {
  const brand = findBrand(raw);
  if (brand) return brand.name;
  const t = raw.trim().replace(/\s+/g, " ").slice(0, 40);
  return t ? t[0].toUpperCase() + t.slice(1) : "Expense";
}

export const isTransfer = (raw: string) => TRANSFER_RE.test(raw);

/** Back-compat wrapper: category + confidence only. */
export function categorize(merchantName: string, raw: string, amountPaise: number, rules: MerchantRule[] = []) {
  const c = classify(merchantName, raw, amountPaise, { rules, ...cleanExtras(raw) });
  return { category_id: c.category_id, subcategory_id: c.subcategory_id, confidence: c.confidence, rename: c.name };
}

function cleanExtras(raw: string) {
  const c = cleanRaw(raw);
  return { label: c.label, foreign: c.foreign };
}

/* ───────────────────────── dedupe ───────────────────────── */

/** FNV-1a, 32-bit, hex. Same output in browser and server. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function merchantKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6);
}

/**
 * Same day + same amount + same merchant start = same transaction, wherever it came from.
 * Two identical spends in one batch (two chai at the same stall) get #1, #2 so both survive.
 */
export function assignHashes<T extends { date: string; amount_paise: number; merchant_name: string; dedupe_hash?: string | null }>(rows: T[]): (T & { dedupe_hash: string })[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${r.date}|${Math.abs(r.amount_paise)}|${merchantKey(r.merchant_name)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...r, dedupe_hash: fnv1a(n === 1 ? base : `${base}#${n}`) };
  });
}

/* ───────────────────────── prepare ───────────────────────── */

function transferLabel(raw: string, amount: number): string {
  if (/\bcred\b|cred club|credclub/i.test(raw)) return amount < 0 ? "Card bill via CRED" : "Card payment via CRED";
  if (/payment received|thank you for/i.test(raw)) return "Card payment received";
  if (/self transfer|own a\/?c|own account/i.test(raw)) return "Self transfer";
  return amount < 0 ? "Card bill payment" : "Card payment received";
}

export function prepareRow(r: RawRow, rules: MerchantRule[] = [], memory?: Memory): PreparedRow {
  const cleaned = cleanRaw(r.merchant_raw);
  let merchant_name = r.source === "manual" ? manualName(r.merchant_raw) : normalizeMerchant(r.merchant_raw);
  // Some statements print only a date and dashes: say what it was rather than "01 10".
  if (r.source !== "manual" && ((!cleaned.name && merchant_name === "Card payment") || (merchant_name.match(/[a-z]/gi) ?? []).length < 3 || /^\d/.test(merchant_name)))
    merchant_name = r.amount_paise > 0 ? "Money received" : "Money sent";
  const c: Classification = classify(merchant_name, r.merchant_raw, r.amount_paise, { rules, memory, label: cleaned.label, foreign: cleaned.foreign, typed: r.source === "manual" });
  const transferName = c.category_id === "xfer" ? transferLabel(r.merchant_raw, r.amount_paise) : null;
  // A structural name ("Card interest") only replaces names that carry no information.
  const useStructural = !!c.name && (c.structural || c.reasons[0]?.startsWith("Your rule"));
  return {
    ...r,
    merchant_name: (useStructural ? c.name : null) ?? transferName ?? merchant_name,
    category_id: c.category_id,
    subcategory_id: c.subcategory_id,
    confidence: c.confidence,
    reasons: c.reasons,
    refund: !!c.refund,
    is_transfer: c.category_id === "xfer",
    dedupe_hash: null,
  };
}

export function prepareRows(rows: RawRow[], rules: MerchantRule[] = [], opts: { hash?: boolean; memory?: Memory } = {}): PreparedRow[] {
  const prepared = rows.map((r) => prepareRow(r, rules, opts.memory));
  return opts.hash === false ? prepared : assignHashes(prepared);
}
