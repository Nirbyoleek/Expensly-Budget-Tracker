import { describe, expect, it } from "vitest";
import { buildMemory, cleanRaw, prepareRows, type RawRow } from "../core";

const row = (merchant_raw: string, amount: number): RawRow => ({ date: "2026-10-10", amount_paise: amount * 100, merchant_raw, source: "import" });
const one = (raw: string, amount = -500) => prepareRows([row(raw, amount)], [], { hash: false })[0];
const triple = (raw: string, amount = -500) => {
  const r = one(raw, amount);
  return [r.merchant_name, r.category_id, r.subcategory_id];
};

describe("cleaning card-statement names", () => {
  it.each([
    ["| 21:17 ZOMATOGURGAON C", "Zomato"],
    ["| 23:36 RAZ*Blue Tokai CoffeeDelhi C", "Blue Tokai"],
    ["| 14:58 ASSPLBangalore C", "Amazon"],
    ["| 02:01 AKASA AIR WEBMUMBAI C", "Akasa Air"],
    ["FLIPKART BANGALORE IN 525", "Flipkart"],
    ["SPOTIFY SI MUMBAI IN 1", "Spotify"],
    ["M S GOLDEN VALLEY RESTA,JALPAIGURI RESTAURANTS", "Golden Valley Restaurant"],
    ["| 03:54 PNB*Some Shop NameSurat C", "Some Shop Name"],
  ])("%s → %s", (raw, name) => expect(one(raw).merchant_name).toBe(name));

  it("reads the bank's label and foreign currency notes", () => {
    expect(cleanRaw("DAVAINDIA HEALTH MART L,GHAZIABAD MEDICAL").label).toContain("MEDICAL");
    expect(cleanRaw("ANTHROPIC* CLAUDE SUB,ANTHROPIC.COM ( USD 23.60 ) RETAIL STORES").foreign).toBe("USD 23.60");
  });
});

describe("detailed categories from real statement lines", () => {
  it.each([
    ["| 21:17 ZOMATOGURGAON C", -450, ["Zomato", "food", "delivery"]],
    ["| 00:02 PYU*JUBILANT FOODWORKSwww.dominos. C", -600, ["Domino's", "food", "delivery"]],
    ["| 21:16 PTM*ZOMATO LIMITEDNEW DELHI C", -320, ["Zomato", "food", "delivery"]],
    ["| 13:37 RAZ*AIRTELhttp://airte C", -399, ["Airtel", "bills", "mobile"]],
    ["| 01:33 PAY*ZEPTOGURGAON C", -280, ["Zepto", "groc", "quick"]],
    ["| 23:10 Flipkart MinutesBanglore C", -210, ["Flipkart Minutes", "groc", "quick"]],
    ["| 21:36 Amazon Seller ServicesBANGALORE C", -1299, ["Amazon", "shop", "marketplace"]],
    ["| 23:52 PLAYSTATIONLONDON C", -2999, ["PlayStation Store", "fun", "gaming"]],
    ["| 02:01 AKASA AIR WEBMUMBAI C", -5400, ["Akasa Air", "travel", "flights"]],
    ["| 23:36 RAZ*Blue Tokai CoffeeDelhi C", -350, ["Blue Tokai", "food", "cafes"]],
    ["| 15:11 PASSPORTSEVAMOPSACCMumbai C", -1500, ["Passport Seva", "govt", "documents"]],
    ["| 00:00 IBIBO GROUP PRIVATE LIMGURGAON + C", -8200, ["Goibibo", "travel", "bookings"]],
    ["M S GOLDEN VALLEY RESTA,JALPAIGURI RESTAURANTS", -900, ["Golden Valley Restaurant", "food", "restaurants"]],
    ["DAVAINDIA HEALTH MART L,GHAZIABAD MEDICAL", -240, ["Davaindia", "gym", "pharmacy"]],
    ["ANTHROPIC* CLAUDE SUB,ANTHROPIC.COM ( USD 23.60 ) RETAIL STORES", -2000, ["Claude", "subs", "ai"]],
    ["SPOTIFY SI MUMBAI IN 1", -119, ["Spotify", "subs", "music"]],
    ["DEBIT INTEREST", -5179, ["Card interest", "fees", "interest"]],
    ["Interest Charges 0", -1286, ["Card interest", "fees", "interest"]],
    ["IGST-CI@18% 0", -932, ["GST on charges", "fees", "gst"]],
    ["CGST-/SGST-VPS0001-RATE 9.0", -116, ["GST on charges", "fees", "gst"]],
    ["FOREIGN CURRENCY TRANSACTION FEE", -70, ["Forex markup", "fees", "forex"]],
  ] as [string, number, string[]][])("%s", (raw, amount, expected) => expect(triple(raw, amount)).toEqual(expected));

  it("reads cashback as income even when it names other merchants", () => {
    expect(triple("CASHBACK CREDIT SEP26-FLIPKART:8~POS:980~UBER_P", 988)).toEqual(["Cashback", "income", "cashback"]);
  });

  it("treats a credit from a travel site as a refund, not income", () => {
    const r = one("IBIBO GROUP PRIVATE LI,GURGAON TRAVEL", 8200);
    expect([r.category_id, r.refund]).toEqual(["travel", true]);
  });

  it("asks about CRED card payments instead of guessing", () => {
    const r = one("| 16:09 DREAMPLUG TECHNOLOGIBANGALORE C", -25000);
    expect(r.category_id).toBe("bills");
    expect(r.confidence).toBeLessThan(0.7);
  });

  it("files UPI payments to a person under people", () => {
    expect(one("UPI/DR/612345678901/ANIL SHARMA/SBIN/anilsharma@oksbi").category_id).toBe("people");
  });

  it("spots ATM, salary, SIP and EMI", () => {
    expect(triple("ATM WDL 123456 JALPAIGURI", -5000).slice(1)).toEqual(["cash", "atm"]);
    expect(one("NEFT CR-ACME LABS-SALARY OCT", 95000).subcategory_id).toBe("salary");
    expect(one("ACH D- BSE STAR MF SIP 1234567", -5000).category_id).toBe("invest");
    expect(one("NACH DR HOME LOAN EMI 7788", -21000).subcategory_id).toBe("emi");
  });

  it("explains itself", () => {
    expect(one("| 21:17 ZOMATOGURGAON C").reasons[0]).toBe("Recognised Zomato");
    expect(one("ANTHROPIC* CLAUDE SUB,ANTHROPIC.COM ( USD 23.60 ) RETAIL STORES").reasons).toContain("Charged in USD");
  });

  it("learns from what you reviewed", () => {
    const memory = buildMemory([
      { merchant_name: "Golden Valley Restaurant", category_id: "family", subcategory_id: "gifts", reviewed: true },
      { merchant_name: "Golden Valley Restaurant", category_id: "family", subcategory_id: "gifts", reviewed: true },
      { merchant_name: "Zomato", category_id: "fun", subcategory_id: null, reviewed: false },
    ]);
    const [a, b] = prepareRows([row("M S GOLDEN VALLEY RESTA,JALPAIGURI RESTAURANTS", -900), row("ZOMATO", -300)], [], { hash: false, memory });
    expect([a.category_id, a.subcategory_id]).toEqual(["family", "gifts"]);
    expect(b.category_id).toBe("food"); // unreviewed guesses don't teach
  });
});

describe("unknown merchants", () => {
  it("go to Uncategorised instead of being guessed as Shopping", () => {
    const r = one("ZXQV TRADERS PVT 88123", -740);
    expect(r.category_id).toBe("uncat");
    expect(r.subcategory_id).toBeNull();
  });
});
