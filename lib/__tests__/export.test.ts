import { describe, expect, it } from "vitest";
import { CSV_HEADER, csvCell, csvLine, safeText, transactionsCsv } from "../export";

const row = { date: "2026-10-01", merchant_name: "Swiggy", amount_paise: -34050, category_id: "food", subcategory_id: "delivery", source: "import", reviewed: true, note: null };

describe("CSV export", () => {
  it("writes a header and one line per transaction, with a BOM for Excel", () => {
    const csv = transactionsCsv([row]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split("\n")).toEqual([CSV_HEADER, "2026-10-01,Swiggy,-340.50,Food & dining,Food delivery,import,true,"]);
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('Tea, "special"')).toBe('"Tea, ""special"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
  });

  it("neutralises spreadsheet formulas in text but not in amounts", () => {
    expect(safeText("=HYPERLINK(\"http://evil\")")).toBe("'=HYPERLINK(\"http://evil\")");
    expect(safeText("+91 shop")).toBe("'+91 shop");
    expect(safeText("@SUM(A1)")).toBe("'@SUM(A1)");
    const line = csvLine({ ...row, merchant_name: "=cmd|' /C calc'!A0", note: "-2+3" });
    expect(line).toContain(",'=cmd|' /C calc'!A0,");
    expect(line).toContain(",-340.50,"); // the amount itself keeps its minus
    expect(line.endsWith(",'-2+3")).toBe(true);
  });
});
