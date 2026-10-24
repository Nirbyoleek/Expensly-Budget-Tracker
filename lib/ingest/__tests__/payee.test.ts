import { describe, expect, it } from "vitest";
import { buildMemory, classify, isGenericName, payeeKey, vpaOf } from "../classify";

describe("payee identity", () => {
  it("prefers the UPI ID and skips gateway IDs", () => {
    expect(vpaOf("UPI/DR/123456/NATURAL ICE/YESB/naturals.blr@ybl/Pay")).toBe("naturals.blr@ybl");
    expect(vpaOf("UPI/DR/123456/SWIGGY/razorpay@icici")).toBeNull();
    expect(vpaOf("cred.club@axisb CRED")).toBeNull();
    expect(payeeKey("Natural", "UPI/DR/1/NATURAL/naturals.blr@ybl")).toBe("naturals.blr@ybl");
    expect(payeeKey("Natural Ice Cream", null)).toBe("natural ice cream");
  });

  it("matches a rule by UPI ID even when the name is cut differently", () => {
    const rules = [{ pattern: "naturals.blr@ybl", category_id: "food", subcategory_id: "cafes", rename_to: "Natural Ice Cream" }];
    const c = classify("Natura", "UPI/DR/999/NATURA/naturals.blr@ybl", -12000, { rules });
    expect(c).toMatchObject({ category_id: "food", subcategory_id: "cafes", confidence: 1 });
  });

  it("remembers by UPI ID and never learns from generic names", () => {
    const mem = buildMemory([
      { merchant_name: "Pinky", merchant_raw: "UPI/DR/1/PINKY/pinky.tailor@okaxis", category_id: "home", subcategory_id: "repairs", reviewed: true },
      { merchant_name: "Money sent", merchant_raw: "01/10/2026 -", category_id: "bills", subcategory_id: "rent", reviewed: true },
    ]);
    expect(mem.get("pinky.tailor@okaxis")?.category_id).toBe("home");
    expect(mem.has("money sent")).toBe(false);
    expect(isGenericName("Money received")).toBe(true);

    const c = classify("P Kumari", "UPI/DR/2/P KUMARI/pinky.tailor@okaxis", -30000, { memory: mem });
    expect(c.category_id).toBe("home");
    expect(classify("Money sent", "02/10/2026 -", -5000, { memory: mem }).category_id).not.toBe("bills");
  });
});
