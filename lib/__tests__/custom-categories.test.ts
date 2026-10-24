import { describe, expect, it } from "vitest";
import { SYSTEM_CATEGORIES } from "../categories";
import { groupFor, isCustomCategory } from "../taxonomy";
import { categoryBreakdown, needsWants } from "../analytics";
import { csvLine } from "../export";
import { monthView } from "../finance";
import { tx } from "../../tests/fixtures";
import type { Category } from "../types";

const pets: Category = { id: "u_abc123", name: "Pet care", color: "#8B6B4A", kind: "spend", default_budget_paise: 300000, sort: 100, user_id: "user-1", grp: "needs" };
const hobby: Category = { id: "u_def456", name: "Guitar", color: "#C25BE0", kind: "spend", default_budget_paise: 0, sort: 101, user_id: "user-1", grp: null };
const cats = [...SYSTEM_CATEGORIES, pets, hobby];

describe("your own categories", () => {
  it("are told apart from the built-in ones", () => {
    expect(isCustomCategory(pets)).toBe(true);
    expect(isCustomCategory(SYSTEM_CATEGORIES.find((c) => c.id === "food")!)).toBe(false);
  });

  it("count in the group you picked, and as a want when you didn't", () => {
    expect(groupFor("u_abc123", cats)).toBe("needs");
    expect(groupFor("u_def456", cats)).toBe("wants");
    expect(groupFor("food", cats)).toBe("wants");
    expect(groupFor("groc", cats)).toBe("needs");
  });

  it("show up in spending, budgets and the needs-vs-wants split", () => {
    const rows = [tx("2026-10-03", -1200, "u_abc123"), tx("2026-10-05", -800, "u_abc123"), tx("2026-10-06", -500, "u_def456")];
    const split = needsWants(rows, cats, "2026-10-01");
    expect(split.needs).toBe(200000);
    expect(split.wants).toBe(50000);
    const b = categoryBreakdown(rows, cats, "2026-10-22").find((x) => x.id === "u_abc123");
    expect(b).toMatchObject({ name: "Pet care", total: 200000, group: "needs" });
    const v = monthView({ today: "2026-10-22", tx: rows, cats, budgetRows: [] });
    expect(v.budgets["u_abc123"]).toBe(300000);
    expect(v.spentByCat["u_abc123"]).toBe(200000);
  });

  it("export with their own name", () => {
    const line = csvLine({ date: "2026-10-03", merchant_name: "Heads Up For Tails", amount_paise: -120000, category_id: "u_abc123", subcategory_id: null, source: "manual", reviewed: true, note: null }, { u_abc123: "Pet care" });
    expect(line).toContain("Pet care");
    expect(line).not.toContain("u_abc123");
  });
});
