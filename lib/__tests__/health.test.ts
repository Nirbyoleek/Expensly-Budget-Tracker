import { describe, expect, it } from "vitest";
import { SYSTEM_CATEGORIES as cats } from "../categories";
import { analyse, healthScore } from "../analytics";
import { tx } from "../../tests/fixtures";

const plan = { month: "2026-01-01", salary_paise: 8800000, other_paise: 0, payday: 1, savings_goal_pct: 40, total: 8800000 };

describe("money health", () => {
  it("judges budget pace only on categories that have a budget", () => {
    const rows = [tx("2026-10-05", -1000, "food"), tx("2026-10-06", -50000, "govt")];
    const budgetRows = [{ category_id: "food", month: "2026-10-01", limit_paise: 300000 }, ...cats.filter((c) => c.kind === "spend" && c.id !== "food").map((c) => ({ category_id: c.id, month: "2026-10-01", limit_paise: 0 }))];
    const h = healthScore({ tx: rows, cats, budgetRows, today: "2026-10-15", forecast: 5100000 * 1, plan: null });
    const b = h.parts.find((p) => p.id === "budget")!;
    expect(b.note).toMatch(/against ₹3,000 budgeted/);
    expect(b.note).toMatch(/₹50,000 more went to categories with no budget/);
    expect(b.score).toBe(20);
  });

  it("says plainly when you're spending more than you earn, with what to cut", () => {
    const h = healthScore({ tx: [tx("2026-10-05", -60000, "shop")], cats, budgetRows: [], today: "2026-10-20", forecast: 13800000, plan });
    const s = h.parts.find((p) => p.id === "save")!;
    expect(s.note).toBe("On course to spend ₹50,000 more than your ₹88,000 income this month.");
    expect(s.value).toBe("−57%");
    expect(s.fix).toBe("Spend ₹85,200 less this month to reach your goal.");
    expect(s.status).toBe("work");
  });

  it("points at the change worth the most points", () => {
    const h = healthScore({ tx: [tx("2026-10-05", -60000, "shop")], cats, budgetRows: [], today: "2026-10-20", forecast: 13800000, plan });
    expect(h.top).toMatchObject({ id: "save", gain: 30, href: "/insights#categories" });
    expect(h.parts.every((p) => p.value && p.target && p.score >= 0 && p.score <= p.max)).toBe(true);
  });

  it("marks missing data as unknown rather than bad", () => {
    const h = healthScore({ tx: [], cats, budgetRows: [], today: "2026-10-20", forecast: 0, plan: null });
    expect(h.parts.find((p) => p.id === "save")!.status).toBe("unknown");
  });

  it("compares with last month when there is one", () => {
    const rows = [tx("2026-09-03", 50000, "income"), tx("2026-09-10", -10000, "food"), tx("2026-10-03", -2000, "food")];
    const a = analyse({ tx: rows, cats, budgetRows: [], today: "2026-10-20" });
    expect(typeof a.healthPrev).toBe("number");
    expect(analyse({ tx: [tx("2026-10-03", -2000, "food")], cats, budgetRows: [], today: "2026-10-20" }).healthPrev).toBeNull();
  });
});
