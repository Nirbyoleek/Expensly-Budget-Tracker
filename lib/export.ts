import { fullCategoryName, subName } from "./taxonomy";

export type ExportRow = { date: string; merchant_name: string; amount_paise: number; category_id: string; subcategory_id: string | null; source: string; reviewed: boolean; note: string | null };

/** Quote a CSV cell when it holds a comma, quote or newline. */
export const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Text that starts like a formula could run when opened in Excel; a leading ' keeps it as text. */
export const safeText = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

export const CSV_HEADER = "date,merchant,amount_inr,category,subcategory,source,reviewed,note";

/** One CSV line per transaction. Amounts in rupees with 2 decimals, negative = money out. */
export function csvLine(t: ExportRow, names: Record<string, string> = {}): string {
  return [t.date, safeText(t.merchant_name), (Number(t.amount_paise) / 100).toFixed(2), fullCategoryName(t.category_id, null, names[t.category_id]), subName(t.category_id, t.subcategory_id) ?? "", t.source, t.reviewed, safeText(t.note)].map(csvCell).join(",");
}

/** The whole file, with a byte-order mark so Excel opens ₹ and Indian names correctly. */
export const transactionsCsv = (rows: ExportRow[]) => "﻿" + [CSV_HEADER, ...rows.map((r) => csvLine(r))].join("\n");
