import { describe, expect, it } from "vitest";
import { accountLast4, closingBalance, describeCheck, parseTablePages, reconcile, type PdfPage } from "../table";
import { prepareRows } from "../core";

const TODAY = "2026-10-23";
const it_ = (x: number, s: string, w = s.length * 4.5) => ({ x, w, s });
const row = (y: number, ...items: ReturnType<typeof it_>[]) => ({ y, items });

/** A bank statement that centres dates and amounts vertically and wraps the narration. */
const bankPage: PdfPage = [
  row(800, it_(40, "ACME BANK LTD")),
  row(760, it_(40, "Statement of account for 01/10/2026 to 21/10/2026")),
  row(720, it_(40, "Txn Date"), it_(110, "Narration"), it_(330, "Chq/Ref No"), it_(400, "Withdrawal"), it_(470, "Deposit"), it_(540, "Balance")),
  row(709, it_(400, "Amount (INR)"), it_(470, "Amount (INR)"), it_(540, "(INR)")),
  row(690, it_(40, "Opening Balance"), it_(540, "10,361.00", 36)),
  row(672, it_(110, "UPI/DR/527412345678/ZOMATO")),
  row(660, it_(40, "01/10/2026"), it_(330, "-"), it_(410, "361.00", 26), it_(540, "10,000.00", 36)),
  row(648, it_(110, "/YESB/zomato@yes/Payment")),
  row(630, it_(110, "UPI/CR/527412349999/LARA")),
  row(618, it_(40, "02/10/2026"), it_(330, "-"), it_(480, "87.00", 22), it_(540, "10,087.00", 36)),
  row(606, it_(110, "SHARMA/SBIN/lara@okaxis")),
  row(588, it_(110, "NEFT/ACME TECHNOLOGIES PVT")),
  row(576, it_(40, "03/10/2026"), it_(330, "N12345"), it_(474, "50,000.00", 36), it_(540, "60,087.00", 36)),
  row(564, it_(110, "LTD/SALARY OCT")),
  row(540, it_(40, "Closing Balance"), it_(540, "60,087.00", 36)),
];

describe("parseTablePages", () => {
  it("reads a centred bank statement by column", () => {
    const t = parseTablePages([bankPage], TODAY)!;
    expect(t).not.toBeNull();
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0]).toMatchObject({ date: "2026-10-01", amount_paise: -36100, balance_paise: 1000000 });
    expect(t.rows[0].merchant_raw).toContain("ZOMATO");
    expect(t.rows[0].merchant_raw).toContain("zomato@yes");
    expect(t.rows[1]).toMatchObject({ amount_paise: 8700 });
    expect(t.rows[1].merchant_raw).toContain("LARA");
    expect(t.rows[2]).toMatchObject({ amount_paise: 5000000 });
    expect(t.rows[2].merchant_raw).toContain("SALARY");

    const prepared = prepareRows(reconcile(t.rows).rows, [], { hash: false });
    expect(prepared.map((r) => r.category_id)).toEqual(["food", "people", "income"]);
    expect(prepared[2].subcategory_id).toBe("salary");
  });

  it("reads a card statement with one amount column and Cr tags", () => {
    const page: PdfPage = [
      row(700, it_(40, "Date"), it_(120, "Transaction Details"), it_(460, "Amount (in Rs.)")),
      row(680, it_(40, "14/10/2026"), it_(120, "SWIGGY BANGALORE"), it_(470, "418.00", 26)),
      row(668, it_(40, "15/10/2026"), it_(120, "PAYMENT RECEIVED THANK YOU"), it_(460, "5,000.00", 36), it_(500, "Cr")),
      row(656, it_(40, "16/10/2026"), it_(120, "AMAZON PAY INDIA REFUND"), it_(470, "250.00 Cr", 40)),
    ];
    const t = parseTablePages([page], TODAY)!;
    expect(t.rows.map((r) => r.amount_paise)).toEqual([-41800, 500000, 25000]);
    expect(t.rows[0].merchant_raw).toBe("SWIGGY BANGALORE");
  });

  it("returns null without a header so the line reader can take over", () => {
    expect(parseTablePages([[row(600, it_(40, "01/10/2026"), it_(120, "UBER"), it_(400, "120.00"))]], TODAY)).toBeNull();
  });
});

describe("reconcile", () => {
  const r = (amount_paise: number, balance_paise: number) => ({ date: "2026-10-01", amount_paise, merchant_raw: "X SHOP", source: "import" as const, balance_paise });

  it("flips a sign the running balance disproves", () => {
    const { rows, check } = reconcile([r(-100, 900), r(-50, 950), r(-200, 750), r(-10, 740)]);
    expect(rows[1].amount_paise).toBe(50);
    expect(check).toMatchObject({ checked: 3, matched: 3, fixed: 1, mismatched: 0 });
    expect(describeCheck(check).tone).toBe("good");
  });

  it("handles newest-first statements", () => {
    const { check } = reconcile([r(-10, 740), r(-200, 750), r(50, 950), r(-100, 900)]);
    expect(check.mismatched).toBe(0);
  });

  it("warns when rows are missing", () => {
    const { check } = reconcile([r(-100, 900), r(-50, 700), r(-200, 300), r(-10, 100)]);
    expect(describeCheck(check).tone).toBe("warn");
  });
});

describe("statement account details", () => {
  const r = (date: string, bal: number) => ({ date, amount_paise: -100, merchant_raw: "x", source: "import" as const, balance_paise: bal * 100 });

  it("closing balance is the latest row's, oldest-first or newest-first", () => {
    expect(closingBalance([r("2026-09-01", 900), r("2026-09-15", 700), r("2026-09-30", 650)])).toEqual({ balance_paise: 65000, date: "2026-09-30" });
    expect(closingBalance([r("2026-09-30", 650), r("2026-09-15", 700), r("2026-09-01", 900)])).toEqual({ balance_paise: 65000, date: "2026-09-30" });
    // two rows on the last day: the one printed last in date order wins
    expect(closingBalance([r("2026-09-29", 800), r("2026-09-30", 760), r("2026-09-30", 740)])?.balance_paise).toBe(74000);
    expect(closingBalance([{ date: "2026-09-01", amount_paise: -1, merchant_raw: "x", source: "import" }])).toBeNull();
  });

  it.each([
    ["Account No: XXXXXXXX4417", "4417"],
    ["A/c No. 50100123456789", "6789"],
    ["Card Number 5372 XXXX XXXX 0012", "0012"],
    ["Statement of account for period Sep 2026", null],
  ])("reads the last four digits from %s", (text, want) => {
    expect(accountLast4(text)).toBe(want);
  });
});
