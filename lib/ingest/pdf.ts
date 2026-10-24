/**
 * Pulls text out of a PDF statement in the browser, one visual line per row.
 * The file and its password never leave the device.
 */
import type { PdfPage, PdfRow } from "./table";

export class PdfPasswordError extends Error {
  constructor(public wrong: boolean) {
    super(wrong ? "Incorrect password" : "Password required");
  }
}

/** Every page as rows of positioned text, top to bottom. Items within ~2.5pt vertically share a row. */
export async function pdfToPages(file: File, password?: string): Promise<PdfPage[]> {
  const pdfjs = await import("pdfjs-dist");
  // Copied into /public by scripts/copy-pdf-worker.mjs on npm install.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await pdfjs.getDocument({ data, password, isEvalSupported: false }).promise;
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err?.name === "PasswordException") throw new PdfPasswordError(err.code === 2);
    throw e;
  }

  const pages: PdfPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: { y: number; x: number; w: number; s: string }[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      items.push({ y: item.transform[5], x: item.transform[4], w: item.width ?? 0, s: item.str.trim() });
    }
    pages.push(groupRows(items));
  }
  await doc.destroy();
  return pages;
}

export function groupRows(items: { y: number; x: number; w: number; s: string }[]): PdfPage {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfRow[] = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) <= 2.5) last.items.push({ x: it.x, w: it.w, s: it.s });
    else rows.push({ y: it.y, items: [{ x: it.x, w: it.w, s: it.s }] });
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

/** Plain text, one visual line per row, with wrapped descriptions glued back on. For the line-by-line fallback. */
export function pagesToText(pages: PdfPage[]): string {
  return pages.flatMap((rows) => mergeWrappedRows(rows)).join("\n");
}

export async function pdfToText(file: File, password?: string): Promise<string> {
  return pagesToText(await pdfToPages(file, password));
}

type Item = { x: number; s: string };
type Row = { y: number; items: Item[] };

const LEAD_DATE = /^\s*(?:\d{1,2}[\/.\-](?:\d{1,2}|[a-z]{3})[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[a-z]{3}\s+\d{2,4}|\d{1,2}\s+[a-z]{3}\b)/i;
const AMOUNT_ITEM = /^(?:₹|rs\.?|inr)?\s?-?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})\s*(?:cr|dr|c|d)?$/i;
const HAS_AMOUNT = /\d\.\d{2}\b/;
const HEADER = /\b(?:narration|particulars|description|withdrawal|deposit|balance|value date|txn date|chq|cheque no|page \d|statement of|account (?:no|number))\b/i;

/**
 * Bank statements often wrap a long narration onto extra lines, and many centre the date and
 * amounts vertically in the row, so the words sit above and below the line with the date.
 * Glue those loose lines back onto their transaction so "UPI/DR/…/ZOMATO" isn't lost.
 */
export function mergeWrappedRows(rows: Row[]): string[] {
  const text = (r: Row) => r.items.map((i) => i.s).join("  ");
  const isAnchor = (r: Row) => LEAD_DATE.test(text(r)) && r.items.some((i) => AMOUNT_ITEM.test(i.s));
  const anchors = rows.map((r, i) => (isAnchor(r) ? i : -1)).filter((i) => i >= 0);
  if (anchors.length < 2) return rows.map(text);

  const firstAmountX = (r: Row) => r.items.find((i, k) => k > 0 && AMOUNT_ITEM.test(i.s))?.x ?? Infinity;
  const narrationOf = (r: Row) => r.items.slice(1).filter((i) => i.x < firstAmountX(r) && !LEAD_DATE.test(i.s) && !/^[-–—\s]*$/.test(i.s));
  // Centred rows leave some date lines with no words of their own; top-aligned rows never do.
  const centred = anchors.some((i) => narrationOf(rows[i]).length === 0);
  const gaps = anchors.slice(1).map((a, k) => rows[anchors[k]].y - rows[a].y).sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)] || 12;

  const extra = new Map<number, { above: Item[]; below: Item[] }>();
  const top = rows[anchors[0]].y + gap * 0.6, bottom = rows[anchors[anchors.length - 1]].y - gap * (centred ? 0.6 : 1);
  const used = new Set<number>();
  rows.forEach((r, i) => {
    if (anchors.includes(i) || r.y > top || r.y < bottom) return;
    const t = text(r);
    if (HAS_AMOUNT.test(t) || HEADER.test(t) || LEAD_DATE.test(t)) return;
    let target = -1;
    if (centred) {
      let best = Infinity;
      for (const a of anchors) { const d = Math.abs(rows[a].y - r.y); if (d < best || (d === best && rows[a].y > r.y)) { best = d; target = a; } }
      if (best > gap) target = -1;
    } else {
      for (const a of anchors) if (rows[a].y > r.y) target = a; // the closest transaction above
      if (target >= 0 && rows[target].y - r.y > gap) target = -1;
    }
    if (target < 0) return;
    const ax = firstAmountX(rows[target]);
    const parts = r.items.filter((it) => it.x < ax);
    if (!parts.length) return;
    const e = extra.get(target) ?? { above: [], below: [] };
    (r.y > rows[target].y ? e.above : e.below).push(...parts);
    extra.set(target, e);
    used.add(i);
  });

  return rows.flatMap((r, i) => {
    if (used.has(i)) return [];
    const e = extra.get(i);
    if (!e) return [text(r)];
    const ax = firstAmountX(r);
    const own = r.items.slice(1).filter((it) => it.x < ax);
    const rest = r.items.slice(1).filter((it) => it.x >= ax);
    return [[r.items[0], ...e.above, ...own, ...e.below, ...rest].map((it) => it.s).join("  ")];
  });
}
