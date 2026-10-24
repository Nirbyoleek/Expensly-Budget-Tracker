import { describe, expect, it } from "vitest";
import { parseSms } from "../parsers";
import { prepareRows } from "../core";

const TODAY = "2026-10-24";
const one = (sms: string) => prepareRows(parseSms(sms, TODAY), [], { hash: false })[0];

/** Real-world shapes of Indian bank alerts (numbers and names made up). */
describe("bank SMS formats", () => {
  it("HDFC multi-line UPI alert", () => {
    const r = one("Sent Rs.340.00\nFrom HDFC Bank A/C *4417\nTo SWIGGY\nOn 22/10/26\nRef 629184123456\nNot You? Call 18002586161");
    expect(r).toMatchObject({ date: "2026-10-22", amount_paise: -34000, merchant_name: "Swiggy", category_id: "food", subcategory_id: "delivery" });
  });

  it("card spend with the merchant after 'on'", () => {
    const r = one("INR 1,499.00 spent using ICICI Bank Card XX1234 on 21-Oct-26 on MYNTRA. Avl Limit: INR 45,000.00. If not you, call 1800 2662.");
    expect(r).toMatchObject({ date: "2026-10-21", amount_paise: -149900, merchant_name: "Myntra", category_id: "shop" });
  });

  it("SBI UPI debit to a person", () => {
    const r = one("Dear UPI user A/C X1234 debited by 250.0 on date 22Oct26 trf to RAMESH KUMAR Refno 629184123456. If not u? call 1800111109. -SBI");
    expect(r).toMatchObject({ amount_paise: -25000, merchant_name: "Ramesh Kumar", category_id: "people" });
    expect(r.date).toBe("2026-10-22");
  });

  it("salary credit by NEFT", () => {
    const r = one("Rs 95,000.00 credited to a/c XX4417 on 01-10-26 by NEFT SALARY from ACME LABS PVT LTD. Avl bal Rs 1,45,000.00");
    expect(r).toMatchObject({ date: "2026-10-01", amount_paise: 9500000, category_id: "income", subcategory_id: "salary" });
  });

  it("refund credit stays in its category", () => {
    const r = one("Refund of Rs.1499.00 from MYNTRA credited to your card XX1234 on 23-10-26.");
    expect(r.amount_paise).toBe(149900);
    expect(r.category_id).toBe("shop");
    expect(r.refund).toBe(true);
  });

  it("ATM withdrawal", () => {
    const r = one("Rs.2000.00 withdrawn at ATM S1AW012345 from A/c XX4417 on 20-10-26. Avl bal Rs.40,000");
    expect(r).toMatchObject({ amount_paise: -200000, category_id: "cash" });
  });

  it("ignores messages without an amount (OTPs, promos)", () => {
    expect(parseSms("Your OTP is 482910. Do not share it with anyone.", TODAY)).toEqual([]);
    expect(parseSms("", TODAY)).toEqual([]);
  });

  it("falls back to today when the message has no date", () => {
    expect(parseSms("Rs.60 paid to TOTO STAND", TODAY)[0].date).toBe(TODAY);
  });

  it("keeps the full message so categorising sees every clue", () => {
    const [raw] = parseSms("Rs.340.00 debited from A/c XX4417 on 22-10-26 to VPA swiggy@icici", TODAY);
    expect(raw.merchant_raw).toContain("swiggy@icici");
    expect(raw.source).toBe("sms");
  });
});
