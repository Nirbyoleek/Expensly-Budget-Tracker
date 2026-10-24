import { describe, expect, it } from "vitest";
import { prepareRows } from "../core";
import { parseQuick } from "../parsers";

const cat = (text: string) => prepareRows(parseQuick(text, "2026-10-24"), [], { hash: false }).map((r) => `${r.category_id}/${r.subcategory_id}`);

describe("quick add recognises everyday items", () => {
  it("files snacks, groceries, rides and more", () => {
    expect(cat("coke 70, chips 30")).toEqual(["food/street", "food/street"]);
    expect(cat("milk 60, onion 40, atta 320")).toEqual(["groc/fresh", "groc/fresh", "groc/kirana"]);
    expect(cat("auto 60, haircut 150, lunch 220, tshirt 499")).toEqual(["trans/cabs", "care/salon", "food/restaurants", "shop/fashion"]);
    expect(cat("swiggy 340, rent 12k")).toEqual(["food/delivery", "bills/rent"]);
  });

  it("doesn't use item words on bank text", () => {
    const [r] = prepareRows([{ date: "2026-10-24", amount_paise: -50000, merchant_raw: "PRESS CLUB KOLKATA", source: "import" }], [], { hash: false });
    expect(r.category_id).not.toBe("home");
  });
});
