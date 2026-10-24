import { describe, expect, it } from "vitest";
import { parseCsvStatement, parseCsvText, parseStatement } from "../parsers";
import { parseAmount, parseDate } from "../core";
import { reconcile } from "../table";

const TODAY = "2026-10-24";

describe("CSV text", () => {
  it("handles quotes, embedded commas, escaped quotes and CRLF", () => {
    expect(parseCsvText('a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
  });

  it("detects tab and semicolon delimiters", () => {
    expect(parseCsvText("Date\tAmount\n01/10/2026\t10.00")[1]).toEqual(["01/10/2026", "10.00"]);
    expect(parseCsvText("Date;Amount;Type\n01/10/2026;10,00;Dr\n02/10/2026;5,00;Dr")[0]).toEqual(["Date", "Amount", "Type"]);
  });
});

describe("CSV statements", () => {
  it("skips the bank's preamble rows before the header", () => {
    const csv = `ACME BANK LTD
Account No: XXXX4417
Statement from 01/10/2026 to 21/10/2026

Date,Narration,Withdrawal Amt,Deposit Amt,Closing Balance
01/10/2026,UPI-ZOMATO,418.00,,9582.00
02/10/2026,NEFT-ACME SALARY,,50000.00,59582.00`;
    const rows = parseCsvStatement(csv, TODAY)!;
    expect(rows.map((r) => [r.date, r.amount_paise, r.balance_paise])).toEqual([
      ["2026-10-01", -41800, 958200],
      ["2026-10-02", 5000000, 5958200],
    ]);
  });

  it("reads one signed amount column", () => {
    const rows = parseCsvStatement("Date,Description,Amount\n2026-10-03,SWIGGY,-340.50\n2026-10-04,REFUND,120", TODAY)!;
    expect(rows.map((r) => r.amount_paise)).toEqual([-34050, 12000]);
  });

  it("reads Cr/Dr written inside the amount", () => {
    const rows = parseCsvStatement("Date,Details,Amount\n03/10/2026,ZOMATO,418.00 Dr\n04/10/2026,PAYMENT,5000.00 Cr", TODAY)!;
    expect(rows.map((r) => r.amount_paise)).toEqual([-41800, 500000]);
  });

  it("drops rows without a date or amount (totals, blanks)", () => {
    const rows = parseCsvStatement("Date,Details,Debit,Credit\n03/10/2026,ZOMATO,418.00,\nTotal,,418.00,0.00\n,,,", TODAY)!;
    expect(rows).toHaveLength(1);
  });

  it("returns null when there's no recognisable header, so text parsing takes over", () => {
    expect(parseCsvStatement("hello,world\n1,2", TODAY)).toBeNull();
    expect(parseStatement("14 Oct 2026  ZOMATO  418.00", TODAY)).toHaveLength(1);
  });

  it("feeds the balance check, which catches a misread sign", () => {
    const csv = "Date,Description,Amount,Balance\n01/10/2026,ZOMATO,418.00,9582.00\n02/10/2026,SALARY,50000.00,59582.00\n03/10/2026,BLINKIT,600.00,58982.00";
    const { rows, check } = reconcile(parseCsvStatement(csv, TODAY)!);
    // no Cr/Dr column, so all three were read as money out; the balance proves the salary was money in
    expect(rows.map((r) => r.amount_paise)).toEqual([-41800, 5000000, -60000]);
    expect(check).toMatchObject({ checked: 2, matched: 2, fixed: 1, mismatched: 0 });
  });
});

describe("amounts and dates", () => {
  it.each([
    ["1,23,456.50", 12345650],
    ["₹2,499", 249900],
    ["340.0", 34000],
    ["418.00Cr", 41800],
    ["Rs. 99", 9900],
    ["-12.5", -1250],
  ])("parseAmount(%s)", (s, p) => expect(parseAmount(s)).toBe(p));

  it("rejects things that aren't amounts", () => {
    expect(parseAmount("")).toBeNaN();
    expect(parseAmount("abc")).toBeNaN();
    expect(parseAmount(null)).toBeNaN();
  });

  it.each([
    ["22/10/2026", "2026-10-22"],
    ["22-10-26", "2026-10-22"],
    ["22.10.26", "2026-10-22"],
    ["22 Oct 2026", "2026-10-22"],
    ["22-Oct-26", "2026-10-22"],
    ["22Oct26", "2026-10-22"],
    ["2026-10-22", "2026-10-22"],
    ["5 Sept 2026", "2026-09-05"],
  ])("parseDate(%s)", (s, iso) => expect(parseDate(s, TODAY)?.iso).toBe(iso));

  it("puts a date without a year in the past, never the future", () => {
    expect(parseDate("20 Oct", TODAY)?.iso).toBe("2026-10-20");
    expect(parseDate("30 Dec", TODAY)?.iso).toBe("2025-12-30");
  });

  it("rejects impossible dates", () => {
    expect(parseDate("32/10/2026", TODAY)).toBeNull();
    expect(parseDate("10/13/2026", TODAY)).toBeNull();
  });
});
