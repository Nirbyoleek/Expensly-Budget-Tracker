import { parseAmount, parseDate, type RawRow } from "./core";

/**
 * Column-aware reading of PDF bank and card statements.
 *
 * Statements are tables. Reading them line by line loses wrapped descriptions and has to guess
 * whether an amount is a debit or a credit. Instead we find the header row, work out where each
 * column sits on the page, and put every piece of text into its column by position. A number under
 * "Withdrawal" is money out, under "Deposit" money in, and the running balance lets us check both.
 */

export type PdfItem = { x: number; w: number; s: string };
export type PdfRow = { y: number; items: PdfItem[] };
export type PdfPage = PdfRow[];

type Kind = "date" | "valuedate" | "narration" | "ref" | "debit" | "credit" | "amount" | "type" | "balance" | "other";
type Column = { kind: Kind; left: number; right: number; centre: number; label: string };

const LABELS: [Kind, RegExp][] = [
  ["valuedate", /value\s*d(?:ate|t)/i],
  ["date", /^(?:s\.?\s*no\.?\s*)?(?:txn|tran|transaction|post(?:ing)?|book(?:ing)?)?\s*\.?\s*date$|^date$/i],
  ["narration", /narration|particulars|description|details|remarks|merchant/i],
  ["ref", /chq|cheque|ref(?:erence)?\b|instrument|utr/i],
  ["balance", /balance/i],
  ["type", /^(?:dr\s*\/\s*cr|cr\s*\/\s*dr|type|debit\s*\/\s*credit|credit\s*\/\s*debit)$/i],
  ["debit", /withdraw|debit|\bdr\b|paid out|money out/i],
  ["credit", /deposit|credit|\bcr\b|paid in|money in/i],
  ["amount", /^amount|^amt|txn amount|transaction amount/i],
];

const AMOUNT = /^(?:₹|rs\.?|inr)?\s?-?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?\s*(?:cr|dr|c|d)?\.?$/i;
const isAmount = (s: string) => AMOUNT.test(s.trim()) && /\d/.test(s) && (/\./.test(s) || /,/.test(s));
const STOP = /closing balance|statement summary|total (?:withdrawals|deposits|debits|credits)|^\s*total\b|end of statement|this is a (?:system|computer)[- ]generated/i;
const OPENING = /opening balance|balance b\/?f|brought forward|b\/f\b/i;
const NOISE = /^page \d+|^\d+\s*of\s*\d+$|^page\s*\d+\s*of\s*\d+$/i;

const text = (r: PdfRow) => r.items.map((i) => i.s).join(" ");

function kindOf(label: string): Kind {
  const l = label.replace(/\s+/g, " ").replace(/[()]/g, " ").trim();
  for (const [k, re] of LABELS) if (re.test(l)) return k;
  return "other";
}

/** A header can wrap ("Withdrawal" / "Amount (INR)"), so merge text that sits in the same column on the next line. */
function headerColumns(rows: PdfRow[], i: number): Column[] | null {
  const cols: { left: number; right: number; label: string }[] = rows[i].items.map((it) => ({ left: it.x, right: it.x + it.w, label: it.s }));
  for (const nextIdx of [i + 1, i - 1]) {
    const n = rows[nextIdx];
    if (!n || Math.abs(n.y - rows[i].y) > 14 || n.items.some((it) => isAmount(it.s)) || parseDate(text(n), "2000-01-01")) continue;
    for (const it of n.items) {
      const hit = cols.find((c) => it.x < c.right + 2 && it.x + it.w > c.left - 2);
      if (hit) {
        hit.label = nextIdx > i ? `${hit.label} ${it.s}` : `${it.s} ${hit.label}`;
        hit.left = Math.min(hit.left, it.x);
        hit.right = Math.max(hit.right, it.x + it.w);
      }
    }
  }
  const out = cols.map((c) => ({ ...c, kind: kindOf(c.label), centre: (c.left + c.right) / 2 })).sort((a, b) => a.left - b.left);
  const has = (k: Kind) => out.some((c) => c.kind === k);
  if (!has("date")) {
    const loose = out.find((c) => c.kind === "other" && /date/i.test(c.label)) ?? out.find((c) => c.kind === "valuedate");
    if (loose) loose.kind = "date";
  }
  const money = (has("debit") && has("credit")) || has("amount");
  if (!has("date") || !money || out.length < 3) return null;
  return out;
}

function findHeader(page: PdfPage): { cols: Column[]; at: number } | null {
  for (let i = 0; i < page.length; i++) {
    const t = text(page[i]);
    if (!/date/i.test(t) && !/date/i.test(text(page[i + 1] ?? { y: 0, items: [] }))) continue;
    const cols = headerColumns(page, i);
    if (cols) {
      // skip the wrapped second header line too
      const next = page[i + 1];
      const skip = next && Math.abs(next.y - page[i].y) <= 14 && !parseDate(text(next), "2000-01-01") && !next.items.some((it) => isAmount(it.s)) ? 1 : 0;
      return { cols, at: i + skip };
    }
  }
  return null;
}

/** Which column a piece of text belongs to. Numbers are right-aligned, so match them by their right edge. */
function columnFor(cols: Column[], it: PdfItem): Column {
  if (isAmount(it.s)) {
    const numeric = cols.filter((c) => ["debit", "credit", "amount", "balance"].includes(c.kind));
    if (numeric.length) {
      const edge = it.x + it.w;
      return numeric.reduce((best, c) => (Math.abs(c.right - edge) < Math.abs(best.right - edge) ? c : best));
    }
  }
  let hit = cols[0];
  for (const c of cols) if (it.x >= c.left - 6) hit = c;
  return hit;
}

type Cells = Partial<Record<Kind, string[]>>;
type Txn = { y: number; cells: Cells; above: string[]; below: string[] };

const add = (cells: Cells, k: Kind, s: string) => ((cells[k] ??= []).push(s), cells);

export type TableResult = { rows: RawRow[]; columns: string[] };

/**
 * Read statement pages as a table. Returns null when no usable header row is found,
 * so the caller can fall back to line-by-line reading.
 */
export function parseTablePages(pages: PdfPage[], today: string): TableResult | null {
  let cols: Column[] | null = null;
  const txns: Txn[] = [];
  let opening: number | null = null;
  let found = false;

  for (const page of pages) {
    const h = findHeader(page);
    if (h) { cols = h.cols; found = true; }
    if (!cols) continue;
    const start = h ? h.at + 1 : 0;
    const pageTx: Txn[] = [];
    const loose: { y: number; s: string }[] = [];
    let stopped = false;

    for (let i = start; i < page.length && !stopped; i++) {
      const r = page[i];
      const t = text(r);
      if (NOISE.test(t.trim())) continue;
      if (OPENING.test(t)) {
        const nums = r.items.filter((it) => isAmount(it.s));
        if (nums.length) opening = parseAmount(nums[nums.length - 1].s);
        continue;
      }
      if (STOP.test(t)) { stopped = true; break; }
      const cells: Cells = {};
      for (const it of r.items) add(cells, columnFor(cols, it).kind, it.s);
      const dateText = (cells.date ?? []).join(" ");
      const d = dateText ? parseDate(dateText, today) : null;
      const hasMoney = ["debit", "credit", "amount"].some((k) => (cells[k as Kind] ?? []).some(isAmount));
      if (d && hasMoney) pageTx.push({ y: r.y, cells, above: [], below: [] });
      else {
        // a wrapped line: keep only the words that sit in the description column
        const words = [...(cells.narration ?? []), ...(cells.other ?? [])].join(" ").trim();
        if (words && !hasMoney) loose.push({ y: r.y, s: words });
      }
    }

    attachLoose(pageTx, loose);
    txns.push(...pageTx);
  }
  if (!found || !txns.length) return null;

  const rows: RawRow[] = [];
  let prev = opening;
  for (const t of txns) {
    const c = t.cells;
    const d = parseDate((c.date ?? []).join(" "), today)!;
    const num = (k: Kind) => {
      const v = (c[k] ?? []).find(isAmount);
      const loneTag = (c[k] ?? []).find((s) => /^(?:cr|dr)\.?$/i.test(s.trim()));
      return v ? { v: Math.abs(parseAmount(v)), tag: (v.match(/(cr|dr|c|d)\.?$/i)?.[1] ?? loneTag ?? "").toLowerCase(), neg: /^-/.test(v.trim()) } : null;
    };
    const dr = num("debit"), cr = num("credit"), amt = num("amount"), bal = num("balance");
    const balance = bal ? (bal.tag.startsWith("d") ? -bal.v : bal.v) : undefined;
    let amount: number;
    if (dr && dr.v > 0 && !(cr && cr.v > 0)) amount = -dr.v;
    else if (cr && cr.v > 0 && !(dr && dr.v > 0)) amount = cr.v;
    else if (amt) {
      const type = (c.type ?? []).join(" ").toLowerCase();
      const isCr = amt.tag.startsWith("c") || /\bcr|credit/.test(type);
      const isDr = amt.tag.startsWith("d") || amt.neg || /\bdr|debit/.test(type);
      amount = isCr ? amt.v : isDr ? -amt.v : balance !== undefined && prev !== null ? (balance >= prev ? amt.v : -amt.v) : -amt.v;
    } else continue;
    if (!amount) continue;
    const narration = [...t.above, ...(c.narration ?? []), ...(c.other ?? []).filter((s) => !/^\d{1,4}\.?$/.test(s.trim())), ...t.below].join(" ").replace(/\s+/g, " ").trim();
    const ref = (c.ref ?? []).filter((s) => !/^[-–—]+$/.test(s)).join(" ");
    rows.push({
      date: d.iso,
      amount_paise: amount,
      merchant_raw: (narration || ref || "Statement entry").slice(0, 400),
      source: "import",
      ...(balance !== undefined && !Number.isNaN(balance) ? { balance_paise: balance } : {}),
    });
    if (balance !== undefined) prev = balance;
  }
  return rows.length ? { rows, columns: cols!.map((c) => c.kind) } : null;
}

/**
 * Lines with words but no date belong to a neighbouring transaction. Statements that centre the
 * date vertically leave some date lines with no words of their own; then the nearest wins.
 * Otherwise the text is a continuation of the transaction above.
 */
function attachLoose(tx: Txn[], loose: { y: number; s: string }[]) {
  if (!tx.length || !loose.length) return;
  const centred = tx.some((t) => !(t.cells.narration ?? []).length);
  const gaps = tx.slice(1).map((t, k) => tx[k].y - t.y).filter((g) => g > 0).sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)] || 24;
  for (const l of loose) {
    let target: Txn | null = null;
    if (centred) {
      let best = Infinity;
      for (const t of tx) {
        const dist = Math.abs(t.y - l.y);
        if (dist < best || (dist === best && t.y > l.y)) { best = dist; target = t; }
      }
      if (best > gap) target = null;
    } else {
      for (const t of tx) if (t.y > l.y) target = t;
      if (target && target.y - l.y > gap * 1.5) target = null;
    }
    if (target) (l.y > target.y ? target.above : target.below).push(l.s);
  }
}

/* ───────────────────────── balance check ───────────────────────── */

export type StatementCheck = {
  /** Rows whose running balance agrees with the one before. */
  matched: number;
  /** Rows we could check (both they and the row before carry a balance). */
  checked: number;
  /** Rows whose debit/credit we flipped because the balance proved it. */
  fixed: number;
  /** Rows the balance didn't agree with even after trying the other sign. */
  mismatched: number;
  /** Rows with no description to categorise by. */
  blank: number;
};

const CLOSE = 1; // paise of rounding slack

/**
 * Walk the running balance. If a row only adds up with the opposite sign, the reader guessed the
 * direction wrong, so flip it. Works for oldest-first and newest-first statements.
 */
export function reconcile(rows: RawRow[]): { rows: RawRow[]; check: StatementCheck } {
  const blank = rows.filter((r) => /^statement entry$/i.test(r.merchant_raw) || !/[a-z]{3}/i.test(r.merchant_raw.replace(/\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/g, ""))).length;
  const withBal = rows.filter((r) => r.balance_paise !== undefined);
  if (withBal.length < 3) return { rows, check: { matched: 0, checked: 0, fixed: 0, mismatched: 0, blank } };

  const score = (order: RawRow[]) => {
    let ok = 0;
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1].balance_paise, b = order[i].balance_paise;
      if (a === undefined || b === undefined) continue;
      if (Math.abs(a + order[i].amount_paise - b) <= CLOSE || Math.abs(a - order[i].amount_paise - b) <= CLOSE) ok++;
    }
    return ok;
  };
  const newestFirst = score([...rows].reverse()) > score(rows);
  const order = newestFirst ? [...rows].reverse() : [...rows];

  let matched = 0, checked = 0, fixed = 0, mismatched = 0;
  const out = order.map((r, i) => {
    const prev = order[i - 1]?.balance_paise;
    if (i === 0 || prev === undefined || r.balance_paise === undefined) return r;
    checked++;
    if (Math.abs(prev + r.amount_paise - r.balance_paise) <= CLOSE) { matched++; return r; }
    if (Math.abs(prev - r.amount_paise - r.balance_paise) <= CLOSE) { matched++; fixed++; return { ...r, amount_paise: -r.amount_paise }; }
    mismatched++;
    return r;
  });
  return { rows: newestFirst ? out.reverse() : out, check: { matched, checked, fixed, mismatched, blank } };
}

/** One line for the import preview. */
export function describeCheck(c: StatementCheck): { tone: "good" | "warn" | "none"; text: string } {
  const parts: string[] = [];
  let tone: "good" | "warn" | "none" = "none";
  if (c.checked >= 3) {
    if (c.mismatched === 0) { tone = "good"; parts.push(`✓ Balances add up on all ${c.checked + 1} rows`); }
    else if (c.mismatched / c.checked <= 0.05) { tone = "good"; parts.push(`✓ Balances add up on ${c.matched} of ${c.checked} rows`); }
    else { tone = "warn"; parts.push(`⚠ ${c.mismatched} of ${c.checked} rows don't match the running balance; some rows may be missing or misread. Check the amounts before adding`); }
    if (c.fixed) parts.push(`${c.fixed} debit/credit ${c.fixed === 1 ? "sign" : "signs"} corrected from the balance`);
  }
  if (c.blank) { tone = "warn"; parts.push(`⚠ ${c.blank} row${c.blank === 1 ? " has" : "s have"} no description, so ${c.blank === 1 ? "it" : "they"} can't be categorised well. The netbanking CSV export usually has them`); }
  return { tone, text: parts.join(" · ") };
}
