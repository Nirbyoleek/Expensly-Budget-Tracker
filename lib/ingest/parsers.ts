import { parseAmount, parseDate, type RawRow } from "./core";

/* ───────────────────────── quick add ───────────────────────── */

/**
 * "chai 20, auto 60, swiggy 340, rent 12k, +18000 freelance"
 * Commas or new lines separate entries; `k` means thousand; a leading + means money in.
 */
export function parseQuick(text: string, today: string): RawRow[] {
  return text
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((seg): RawRow[] => {
      const m = seg.match(/(^|\s)(\+)?(?:₹|rs\.?\s?)?(\d+(?:\.\d{1,2})?)\s*(k|l)?(?=\s|$)/i);
      if (!m) return [];
      const mult = m[4]?.toLowerCase() === "k" ? 1000 : m[4]?.toLowerCase() === "l" ? 100000 : 1;
      const paise = Math.round(parseFloat(m[3]) * mult * 100);
      if (!paise) return [];
      const name = (seg.slice(0, m.index) + " " + seg.slice((m.index ?? 0) + m[0].length)).replace(/\s+/g, " ").trim() || "Expense";
      return [{ date: today, amount_paise: m[2] ? paise : -paise, merchant_raw: name, source: "manual" }];
    });
}

/* ───────────────────────── bank SMS ───────────────────────── */

const SMS_AMOUNT = /(?:rs\.?|inr|₹)\s?([\d,]+(?:\.\d{1,2})?)|(?:debited|credited) (?:by|with|for)\s+([\d,]+(?:\.\d{1,2})?)/i;
const DEBIT_WORDS = /\b(debited|spent|paid|sent|withdrawn|purchase|purchased|txn of|transaction of|used|deducted|charged)\b/i;
const CREDIT_WORDS = /\b(credited|received|refund(?:ed)?|deposited|reversed|cashback)\b/i;

const END = String.raw`(?=\s+(?:on|ref|refno|via|using|upi|txn|for|avl|avbl|from|is|has)\b|\.\s|\.$|\s-\s|\s?\(|,|;|$)`;
const NAME = String.raw`([a-z0-9][a-z0-9 &.'*_\-]{1,40}?)`;
const MERCHANT_PATTERNS: RegExp[] = [
  /\bto\s+vpa\s+([\w.\-]+@[\w]+)/i,
  /\bfrom\s+vpa\s+([\w.\-]+@[\w]+)/i,
  new RegExp(String.raw`\bat\s+` + NAME + END, "i"),
  new RegExp(String.raw`\btowards\s+` + NAME + END, "i"),
  new RegExp(String.raw`\b(?:trf\s+)?to\s+` + NAME + END, "i"),
  /;\s*([a-z0-9][a-z0-9 &.'\-]{1,40}?)\s+credited/i,
  /\binfo:?\s*([a-z0-9\/ .*\-]{3,60})/i,
  // card alerts: "spent using Card XX1234 on 21-Oct-26 on MYNTRA" (the date is skipped as not a name)
  new RegExp(String.raw`\bon\s+([a-z][a-z0-9 &.'*_\-]{1,40}?)(?=\.\s|\.$|\s+(?:avl|avbl|ref|for|via|using|is)\b|,|;|$)`, "i"),
  new RegExp(String.raw`\b(?:by|from)\s+` + NAME + END, "i"),
  /\b([\w.\-]+@[\w]+)\b/i,
];

const NOT_A_MERCHANT = /^(a\/?c\b|ac\b|acct|account|your|card|bank|xx|x\d|\*+|\d|date\b|you\b|u\b|the\b|beneficiary|mobile|call)/i;

export function parseSms(text: string, today: string, source: "sms" | "shortcut" = "sms"): RawRow[] {
  return text
    .split(/\n\s*\n/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .flatMap((sms): RawRow[] => {
      const am = sms.match(SMS_AMOUNT);
      if (!am) return [];
      const paise = parseAmount(am[1] ?? am[2]);
      if (!paise) return [];
      const debit = DEBIT_WORDS.test(sms);
      const credit = !debit && CREDIT_WORDS.test(sms);

      let merchant = "";
      search: for (const re of MERCHANT_PATTERNS) {
        for (const m of sms.matchAll(new RegExp(re.source, re.flags + "g"))) {
          if (m[1] && !NOT_A_MERCHANT.test(m[1].trim())) {
            merchant = m[1].trim();
            break search;
          }
        }
      }
      if (!merchant) merchant = credit ? "Money received" : "UPI payment";

      // Keep the whole SMS as raw text so transfer detection and categorizing see every clue.
      const date = parseDate(sms.replace(am[0], " "), today)?.iso ?? today;
      return [{ date, amount_paise: credit ? paise : -paise, merchant_raw: `${merchant} | ${sms}`.slice(0, 240), source }];
    });
}

/* ───────────────────────── statements: CSV ───────────────────────── */

export function parseCsvText(text: string): string[][] {
  const delim = (() => {
    const head = text.split(/\r?\n/).slice(0, 15).join("\n");
    const counts = { ",": (head.match(/,/g) || []).length, "\t": (head.match(/\t/g) || []).length, ";": (head.match(/;/g) || []).length };
    return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as "," | "\t" | ";";
  })();
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = []; cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export function parseCsvStatement(text: string, today: string): RawRow[] | null {
  const rows = parseCsvText(text);
  const h = rows.findIndex(
    (r) => r.length >= 3 && r.some((c) => /date/i.test(c) && c.length < 24) && r.some((c) => /amount|debit|withdraw|credit|deposit/i.test(c) && c.length < 32),
  );
  if (h < 0) return null;
  const H = rows[h].map((c) => c.toLowerCase().trim());
  const col = (re: RegExp, not?: RegExp) => H.findIndex((c) => re.test(c) && !(not && not.test(c)));

  const cDate = col(/date/, /value/) >= 0 ? col(/date/, /value/) : col(/date/);
  const cName = col(/desc|narration|particular|merchant|details|remark|transaction/, /date|amount|id|no\b|number/);
  const cAmt = col(/amount|amt/, /debit|credit|withdraw|deposit/);
  const cDr = col(/debit|withdraw/);
  const cCr = col(/credit|deposit/, /card/);
  const cType = col(/cr\/dr|dr\/cr|^type$|debit\/credit|txn type/);
  const cBal = col(/balance/);

  // A single amount column with some negatives is signed: trust the sign, positives are money in.
  const signed = cAmt >= 0 && rows.slice(h + 1).some((r) => parseAmount(r[cAmt]) < 0);

  return rows.slice(h + 1).flatMap((r): RawRow[] => {
    const d = parseDate(r[cDate] ?? "", today);
    if (!d) return [];
    const name = (cName >= 0 ? r[cName] : r.filter((_, i) => i !== cDate).join(" ")).trim() || "Statement entry";
    let amount: number;
    if ((cDr >= 0 || cCr >= 0) && cAmt < 0) {
      const dr = parseAmount(r[cDr]), cr = parseAmount(r[cCr]);
      amount = dr > 0 ? -dr : cr > 0 ? cr : NaN;
    } else {
      const raw = r[cAmt] ?? "";
      const a = parseAmount(raw);
      const tag = `${cType >= 0 ? r[cType] : ""} ${raw}`;
      const isCr = /\bcr\b|cr$|credit/i.test(tag.trim()) && !/\bdr\b|dr$|debit/i.test(tag.trim());
      const isDr = /\bdr\b|dr$|debit/i.test(tag.trim());
      amount = a < 0 ? a : isCr ? Math.abs(a) : signed && !isDr ? Math.abs(a) : -Math.abs(a);
    }
    if (!amount || Number.isNaN(amount)) return [];
    const bal = cBal >= 0 ? parseAmount(r[cBal]) : NaN;
    return [{ date: d.iso, amount_paise: amount, merchant_raw: name, source: "import", ...(Number.isNaN(bal) ? {} : { balance_paise: bal }) }];
  });
}

/* ───────────────────────── statements: text / PDF ───────────────────────── */

const SKIP_LINE = /opening balance|closing balance|total (?:dues|amount|spends?)|minimum (?:amount )?due|payment due date|statement (?:date|period)|credit limit|available (?:credit|limit)|reward points|^\s*date\b/i;
const AMOUNT_TOKEN = /(?:₹|rs\.?|inr)?\s?(-?\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|-?\d+\.\d{2})\s*(cr|dr|c|d)?\b/gi;

/**
 * One transaction per line: a date, a description, then amounts.
 * Card statements: one amount, often tagged Cr/Dr. Bank statements: amount then running balance;
 * the balance moving up or down tells credit from debit.
 */
export function parseTextStatement(text: string, today: string): RawRow[] {
  let prevBalance: number | null = null;
  const out: RawRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line || SKIP_LINE.test(line)) continue;
    const d = parseDate(line, today);
    if (!d || d.index > 12) continue; // the date should open the line
    const rest = line.slice(d.index + d.length);
    const amounts = [...rest.matchAll(AMOUNT_TOKEN)];
    if (!amounts.length) continue;

    let txn = amounts[amounts.length - 1];
    let balance: number | null = null;
    if (amounts.length >= 2) {
      txn = amounts[amounts.length - 2];
      balance = parseAmount(amounts[amounts.length - 1][1]);
    }
    const value = parseAmount(txn[1]);
    if (!value) continue;

    const tag = (txn[2] || "").toLowerCase();
    let credit: boolean;
    if (tag.startsWith("c")) credit = true;
    else if (tag.startsWith("d")) credit = false;
    else if (balance !== null && prevBalance !== null) credit = balance > prevBalance;
    else credit = /\bcr\b|credit|refund|reversal|payment received|salary/i.test(rest);
    if (balance !== null) prevBalance = balance;

    let name = rest.slice(0, txn.index).replace(/\b\d{6,}\b/g, " ").replace(/\s+/g, " ").trim();
    // drop a second (value) date that some banks print after the narration
    const vd = parseDate(name, today);
    if (vd && vd.index > name.length - vd.length - 2) name = name.slice(0, vd.index).trim();
    out.push({ date: d.iso, amount_paise: credit ? Math.abs(value) : -Math.abs(value), merchant_raw: name || "Statement entry", source: "import", ...(balance !== null && !Number.isNaN(balance) ? { balance_paise: balance } : {}) });
  }
  return out;
}

/** CSV when it has a usable header row, otherwise line-by-line text. */
export function parseStatement(text: string, today: string): RawRow[] {
  const csv = parseCsvStatement(text, today);
  return csv && csv.length ? csv : parseTextStatement(text, today);
}
