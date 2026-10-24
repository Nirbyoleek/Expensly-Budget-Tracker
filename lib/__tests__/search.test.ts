import { describe, expect, it } from "vitest";
import { matches, parseQuery } from "../search";
import type { Transaction } from "../types";

const t = (merchant_name: string, rupees: number, category_id: string, subcategory_id: string | null, date = "2026-10-12", reviewed = true): Transaction => ({
  id: merchant_name, date, amount_paise: rupees * 100, merchant_name, merchant_raw: null, category_id, subcategory_id, source: "import", reviewed, note: null, account_id: null, import_id: null,
});
const rows = [t("Swiggy", -450, "food", "delivery"), t("Swiggy", -180, "food", "delivery", "2026-09-03"), t("Blue Tokai", -320, "food", "cafes"), t("Myntra", 1499, "shop", "fashion"), t("Card interest", -5179, "fees", "interest", "2026-10-02", false)];
const find = (q: string) => rows.filter((r) => matches(r, parseQuery(q))).map((r) => `${r.merchant_name}${r.amount_paise / 100}`);

describe("search", () => {
  it("amount filters", () => expect(find("swiggy >300")).toEqual(["Swiggy-450"]));
  it("subcategory by name", () => expect(find("delivery")).toEqual(["Swiggy-450", "Swiggy-180"]));
  it("months", () => expect(find("swiggy sep")).toEqual(["Swiggy-180"]));
  it("is: flags", () => {
    expect(find("is:refund")).toEqual(["Myntra1499"]);
    expect(find("is:review")).toEqual(["Card interest-5179"]);
  });
  it("cat: prefix", () => expect(find("cat:fees")).toEqual(["Card interest-5179"]));
  it("plain words still work", () => expect(find("tokai")).toEqual(["Blue Tokai-320"]));
});
