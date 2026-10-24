import { describe, expect, it } from "vitest";
import { cleanRaw, findBrand, isGenericName, mayBePerson, merchantCacheKey, payeeKey, vpaOf } from "../classify";
import { assignHashes, fnv1a, manualName, normalizeMerchant } from "../core";

describe("cleaning bank text into a name", () => {
  it.each([
    ["UPI/DR/628193/ZOMATO/YESB/zomato@yes", "Zomato"],
    ["POS 4417XXXXXXXX1234 AMAZON PAY INDIA", "Amazon"],
    ["FLIPKART INTERNET PRIVATE LI BANGALORE IN 525", "Flipkart"],
    ["PYU*SWIGGY BANGALORE", "Swiggy"],
    ["M/S SHREE BALAJI SWEETS", "Shree Balaji Sweets"],
  ])("normalizeMerchant(%s) → %s", (raw, name) => {
    expect(normalizeMerchant(raw)).toBe(name);
  });

  it("pulls out a foreign currency and the bank's category label", () => {
    expect(cleanRaw("OPENAI *CHATGPT SUBSCR (USD 20.00)").foreign).toBe("USD 20.00");
    expect(cleanRaw("GOLDEN VALLEY RESTA,JALPAIGURI RESTAURANTS").label).toMatch(/RESTAURANTS/);
  });

  it("strips dates, times and long numbers", () => {
    expect(cleanRaw("15:11 22/10/2026 PASSPORT SEVA 123456789").name).not.toMatch(/\d{2}/);
  });

  it("keeps typed names, tidied", () => {
    expect(manualName("  momos   with friends ")).toBe("Momos with friends");
    expect(manualName("swiggy")).toBe("Swiggy");
    expect(manualName("")).toBe("Expense");
  });

  it("finds brands by key", () => {
    expect(findBrand("UPI-BLINKIT-blinkit@ybl")?.name).toBe("Blinkit");
    expect(findBrand("random corner shop")).toBeUndefined();
  });
});

describe("payee identity", () => {
  it("normalises cache keys", () => {
    expect(merchantCacheKey("  Shree Balaji Sweets!! ")).toBe("shree balaji sweets");
    expect(merchantCacheKey("A&B Stores")).toBe("a&b stores");
  });

  it("knows placeholders and people", () => {
    expect(isGenericName("Money sent")).toBe(true);
    expect(isGenericName("Swiggy")).toBe(false);
    expect(mayBePerson("Lara Sharma")).toBe(true);
    expect(mayBePerson("Golden Valley Restaurant")).toBe(false);
  });

  it("uses the first non-gateway UPI ID", () => {
    expect(vpaOf("UPI/razorpay@icici/SHOP/shopname.blr@okhdfcbank")).toBe("shopname.blr@okhdfcbank");
    expect(vpaOf(null)).toBeNull();
    expect(payeeKey("Swiggy", "UPI/swiggy@icici")).toBe("swiggy@icici");
  });
});

describe("duplicate detection hashes", () => {
  it("is stable and differs for different input", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
  });

  it("numbers genuine repeats on the same day so both survive", () => {
    const rows = assignHashes([
      { date: "2026-10-01", amount_paise: -6000, merchant_name: "Auto" },
      { date: "2026-10-01", amount_paise: -6000, merchant_name: "Auto" },
      { date: "2026-10-01", amount_paise: -6000, merchant_name: "auto " },
    ]);
    expect(new Set(rows.map((r) => r.dedupe_hash)).size).toBe(3);
    // re-importing the same file produces the same hashes, so nothing doubles
    expect(assignHashes(rows.map(({ dedupe_hash: _h, ...r }) => r)).map((r) => r.dedupe_hash)).toEqual(rows.map((r) => r.dedupe_hash));
  });
});
