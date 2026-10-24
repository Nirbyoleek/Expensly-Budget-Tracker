import { describe, expect, it } from "vitest";
import { parseQuick, parseSms, parseStatement } from "../parsers";
import { assignHashes, parseDate, prepareRows } from "../core";

const TODAY = "2026-10-22";
const pick = (rows: ReturnType<typeof prepareRows>) =>
  rows.map((r) => [r.date, r.amount_paise / 100, r.merchant_name, r.category_id]);

describe("dates", () => {
  it.each([
    ["22/10/2026", "2026-10-22"],
    ["22-10-26", "2026-10-22"],
    ["22 Oct 2026", "2026-10-22"],
    ["22-Oct-26", "2026-10-22"],
    ["22Oct26", "2026-10-22"],
    ["2026-10-15:10:23:11", "2026-10-15"],
  ])("%s", (input, iso) => expect(parseDate(input, TODAY)?.iso).toBe(iso));

  it("puts a yearless future date in last year", () => {
    expect(parseDate("28 Dec", TODAY)?.iso).toBe("2025-12-28");
    expect(parseDate("15 Oct", TODAY)?.iso).toBe("2026-10-15");
  });
});

describe("quick add", () => {
  it("splits entries, expands k, and treats + as income", () => {
    expect(pick(prepareRows(parseQuick("chai 20, auto 60, swiggy 340, rent 12k, +18000 freelance, 1.5k petrol", TODAY), [], { hash: false }))).toEqual([
      [TODAY, -20, "Chai", "food"],
      [TODAY, -60, "Auto", "trans"],
      [TODAY, -340, "Swiggy", "food"],
      [TODAY, -12000, "Rent", "bills"],
      [TODAY, 18000, "Freelance", "income"],
      [TODAY, -1500, "Petrol", "trans"],
    ]);
  });

  it("skips entries with no amount", () => {
    expect(parseQuick("just words, chai 20", TODAY)).toHaveLength(1);
  });
});

describe("bank SMS", () => {
  const cases: [string, [string, number, string, string]][] = [
    ["Rs.340.00 debited from A/c XX4417 on 22-10-26 to VPA swiggy@icici. UPI Ref 629184712345", ["2026-10-22", -340, "Swiggy", "food"]],
    ["Sent Rs.120.00 From HDFC Bank A/C *4417 To RAMESH KUMAR On 21/10/26 Ref 629123456789 Not You? Call 18002586161", ["2026-10-21", -120, "Ramesh Kumar", "people"]],
    ["Rs.2,499.00 spent on HDFC Bank Card x1234 at AMAZON PAY INDIA on 2026-10-15:10:23:11.Avl bal Rs 45,000", ["2026-10-15", -2499, "Amazon", "shop"]],
    ["Dear UPI user A/C X1234 debited by 340.0 on date 22Oct26 trf to ZOMATO Refno 629184712345. If not u? call -1800111109. -SBI", ["2026-10-22", -340, "Zomato", "food"]],
    ["INR 1,599.00 spent on ICICI Bank Card XX9876 on 04-Oct-26 at CULTFIT. Avl Lmt: INR 81,540.00", ["2026-10-04", -1599, "Cult.fit", "gym"]],
    ["Rs 18,460 debited from A/c XX4417 to CRED Club towards card payment on 16-10-26", ["2026-10-16", -18460, "Card bill via CRED", "xfer"]],
  ];
  it.each(cases)("%s", (sms, expected) => {
    expect(pick(prepareRows(parseSms(sms, TODAY)))[0]).toEqual(expected);
  });

  it("reads credits as money in", () => {
    const [row] = prepareRows(parseSms("Your a/c no. XXXXXXXX1234 is credited by Rs.95,000.00 on 01-10-26 by a/c linked to VPA acmelabs@okaxis (UPI Ref no 123456789012)", TODAY));
    expect(row.amount_paise).toBe(9500000);
    expect(row.category_id).toBe("income");
  });

  it("parses several messages separated by blank lines", () => {
    expect(parseSms("Rs.50 paid to TEA STALL on 22-10-26\n\nRs.60 paid to TOTO STAND on 22-10-26", TODAY)).toHaveLength(2);
  });
});

describe("statements", () => {
  it("reads a card CSV, flags the CRED payment and keeps refunds in their category", () => {
    const csv = `Date,Transaction Details,Amount (INR),Type
14/10/2026,UPI/ZOMATO ONLINE/bangalore,418.00,Dr
15/10/2026,POS AMAZON PAY INDIA,"2,499.00",Dr
16/10/2026,PAYMENT RECEIVED - CRED CLUB THANK YOU,18460.00,Cr
17/10/2026,ECOM NETFLIX.COM,199.00,Dr
21/10/2026,REFUND MYNTRA DESIGNS,1499.00,Cr`;
    expect(pick(prepareRows(parseStatement(csv, TODAY)))).toEqual([
      ["2026-10-14", -418, "Zomato", "food"],
      ["2026-10-15", -2499, "Amazon", "shop"],
      ["2026-10-16", 18460, "Card payment via CRED", "xfer"],
      ["2026-10-17", -199, "Netflix", "subs"],
      ["2026-10-21", 1499, "Myntra", "shop"],
    ]);
  });

  it("reads separate debit and credit columns", () => {
    const csv = `Txn Date,Value Date,Description,Debit,Credit,Balance
01/10/2026,01/10/2026,SALARY ACME LABS,,95000.00,145000.00
02/10/2026,02/10/2026,UPI-BLINKIT-blinkit@ybl,612.00,,144388.00`;
    expect(pick(prepareRows(parseStatement(csv, TODAY)))).toEqual([
      ["2026-10-01", 95000, "Salary Acme Labs", "income"],
      ["2026-10-02", -612, "Blinkit", "groc"],
    ]);
  });

  it("reads bank statement text, using the running balance for direction", () => {
    const text = `Date Narration Chq./Ref.No. Value Dt Withdrawal Amt. Deposit Amt. Closing Balance
01/10/26 NEFT CR-ACME LABS PVT LTD-SALARY OCT 0000123456 01/10/26 95,000.00 1,45,000.00
02/10/26 UPI-BIGBASKET-bigbasket@hdfcbank-HDFC0000001-628812345678 02/10/26 1,840.00 1,43,160.00
05/10/26 ACH D- WBSEDCL ELECTRICITY 05/10/26 1,260.00 1,41,826.00`;
    const rows = prepareRows(parseStatement(text, TODAY));
    expect(rows.map((r) => r.amount_paise / 100)).toEqual([95000, -1840, -1260]);
    expect(rows.map((r) => r.category_id)).toEqual(["income", "groc", "bills"]);
  });

  it("reads card statement text with Cr/Dr tags and skips summary lines", () => {
    const text = `14 Oct 2026  ZOMATO LTD GURGAON  418.00
15 Oct  AMAZON PAY 2,499.00 Dr
16 Oct 2026 PAYMENT RECEIVED (BBPS) 18,460.00 Cr
TOTAL AMOUNT DUE 21,000.00`;
    expect(pick(prepareRows(parseStatement(text, TODAY)))).toEqual([
      ["2026-10-14", -418, "Zomato", "food"],
      ["2026-10-15", -2499, "Amazon", "shop"],
      ["2026-10-16", 18460, "Card payment received", "xfer"],
    ]);
  });
});

describe("dedupe", () => {
  it("gives the same spend the same hash whatever the source", () => {
    const fromSms = prepareRows(parseSms("Rs.340.00 debited from A/c XX4417 on 22-10-26 to VPA swiggy@icici", TODAY))[0];
    const fromCsv = prepareRows(parseStatement("Date,Details,Amount,Type\n22/10/2026,UPI/SWIGGY/bangalore,340.00,Dr", TODAY))[0];
    expect(fromSms.dedupe_hash).toBe(fromCsv.dedupe_hash);
  });

  it("keeps two identical spends in one batch apart", () => {
    const rows = assignHashes([
      { date: TODAY, amount_paise: -2000, merchant_name: "Chai" },
      { date: TODAY, amount_paise: -2000, merchant_name: "Chai" },
    ]);
    expect(rows[0].dedupe_hash).not.toBe(rows[1].dedupe_hash);
  });
});
