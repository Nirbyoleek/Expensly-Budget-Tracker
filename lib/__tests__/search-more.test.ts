import { describe, expect, it } from "vitest";
import { matches, parseQuery } from "../search";
import { tx } from "../../tests/fixtures";

describe("search queries", () => {
  it.each([
    [">500", { min: 50000 }],
    ["<2k", { max: 200000 }],
    ["=199", { eq: 19900 }],
    [">₹1,200", { min: 120000 }],
  ])("parses amounts: %s", (q, want) => {
    expect(parseQuery(q)).toMatchObject(want);
  });

  it("parses categories, subcategories, months and flags", () => {
    expect(parseQuery("cat:food sub:delivery oct is:review swiggy")).toEqual({ words: ["swiggy"], cats: ["food"], subs: ["food:delivery"], is: ["review"], month: 10 });
    expect(parseQuery("september").month).toBe(9);
    expect(parseQuery("se").month).toBeUndefined(); // too short to be a month
  });

  const rows = [
    tx("2026-10-01", -340, "food", { merchant_name: "Swiggy", subcategory_id: "delivery" }),
    tx("2026-10-02", 340, "food", { merchant_name: "Swiggy", subcategory_id: "delivery" }),
    tx("2026-09-03", 50000, "income", { merchant_name: "Acme Payroll", subcategory_id: "salary" }),
    tx("2026-10-04", -20000, "xfer", { merchant_name: "Card bill payment" }),
    tx("2026-10-05", -1200, "fees", { merchant_name: "Interest", reviewed: false }),
  ];
  const find = (q: string) => rows.filter((t) => matches(t, parseQuery(q))).map((t) => `${t.merchant_name} ${t.amount_paise}`);

  it("filters money in and money out", () => {
    expect(find("is:in")).toEqual(["Swiggy 34000", "Acme Payroll 5000000"]);
    expect(find("is:out").length).toBe(3);
    expect(find("is:credit")).toEqual(find("is:in"));
  });

  it("filters refunds, income, review and fees", () => {
    expect(find("is:refund")).toEqual(["Swiggy 34000"]);
    expect(find("is:income")).toEqual(["Acme Payroll 5000000"]);
    expect(find("is:review")).toEqual(["Interest -120000"]);
    expect(find("is:fees")).toEqual(["Interest -120000"]);
  });

  it("combines words, amounts and months", () => {
    expect(find("swiggy >300 oct")).toEqual(["Swiggy -34000", "Swiggy 34000"]);
    expect(find("swiggy <300")).toEqual([]);
    expect(find("salary")).toEqual(["Acme Payroll 5000000"]); // subcategory name matches
    expect(find("sep")).toEqual(["Acme Payroll 5000000"]);
  });
});
