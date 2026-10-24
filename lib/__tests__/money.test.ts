import { describe, expect, it } from "vitest";
import { inr, inrCompact, inrSigned, toPaise, toRupees } from "../money";

describe("money", () => {
  it("converts rupees to integer paise without float drift", () => {
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise(199.99)).toBe(19999);
    expect(toPaise(-340)).toBe(-34000);
    expect(toRupees(12345)).toBe(123.45);
  });

  it.each([
    [0, "₹0"],
    [4900, "₹49"],
    [123456700, "₹12,34,567"],
    [-34000, "₹340"],
    [9950, "₹100"],
  ])("inr(%s) is %s (Indian grouping, always positive)", (p, s) => {
    expect(inr(p)).toBe(s);
  });

  it.each([
    [99900, "₹999"],
    [120000, "₹1.2k"],
    [-4550000, "₹45.5k"],
    [12500000, "₹1.25L"],
    [1234500000, "₹1.23Cr"],
  ])("inrCompact(%s) is %s", (p, s) => {
    expect(inrCompact(p)).toBe(s);
  });

  it("signs with a real minus and a plus", () => {
    expect(inrSigned(-34000)).toBe("−₹340");
    expect(inrSigned(1800000)).toBe("+₹18,000");
  });
});
