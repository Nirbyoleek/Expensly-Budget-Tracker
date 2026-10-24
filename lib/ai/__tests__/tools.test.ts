import { describe, expect, it } from "vitest";
import { TOOLS, TOOL_LABEL, runTool, type AiContext } from "../tools";
import { SYSTEM_CATEGORIES as cats } from "../../categories";
import { tx } from "../../../tests/fixtures";

const ctx: AiContext = {
  today: "2026-10-24",
  tx: [
    tx("2026-10-02", -340, "food", { merchant_name: "Swiggy", subcategory_id: "delivery" }),
    tx("2026-10-05", -2499, "shop", { merchant_name: "Amazon" }),
    tx("2026-10-06", 500, "shop", { merchant_name: "Amazon" }),
    tx("2026-10-01", 50000, "income", { merchant_name: "Acme", subcategory_id: "salary" }),
    tx("2026-09-12", -199, "subs", { merchant_name: "Netflix" }),
  ],
  cats,
  budgetRows: [{ category_id: "food", month: "2026-10-01", limit_paise: 500000 }],
  accounts: [],
  goals: [],
  incomePlans: [],
};

describe("AI data tools", () => {
  it("every tool has a label, a description and an object schema", () => {
    for (const t of TOOLS) {
      expect(TOOL_LABEL[t.name]).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.input_schema.type).toBe("object");
    }
  });

  it("every tool runs on real-looking data and returns JSON-safe output", () => {
    for (const t of TOOLS) {
      const out = runTool(t.name, {}, ctx);
      expect(out).toBeTruthy();
      expect(() => JSON.stringify(out)).not.toThrow();
      expect(out).not.toHaveProperty("error");
    }
  });

  it("gives the overview in rupees, net of refunds", () => {
    const o = runTool("get_overview", {}, ctx) as Record<string, any>;
    expect(o.spent_this_month).toBe(2339); // 340 + 2499 - 500
    expect(o.spent_before_refunds_and_paybacks).toBe(2839);
    expect(o.money_in_this_month).toMatchObject({ income: 50000, refunds: 500 });
  });

  it("filters, sorts and totals transactions", () => {
    const q = runTool("query_transactions", { direction: "out", sort: "largest", from: "2026-10-01" }, ctx) as Record<string, any>;
    expect(q.matches).toBe(2);
    expect(q.total_out).toBe(2839);
    expect(q.rows.map((r: { merchant: string }) => r.merchant)).toEqual(["Amazon", "Swiggy"]);
    const m = runTool("query_transactions", { merchant: "netflix" }, ctx) as Record<string, any>;
    expect(m.rows[0]).toMatchObject({ merchant: "Netflix", amount: -199, category: "Subscriptions" });
  });

  it("caps how many rows it returns", () => {
    const many = { ...ctx, tx: Array.from({ length: 100 }, (_, i) => tx("2026-10-10", -(i + 1), "food")) };
    const q = runTool("query_transactions", { limit: 500 }, many) as Record<string, any>;
    expect(q.rows).toHaveLength(60);
    expect(q.truncated).toBe(true);
  });

  it("refuses unknown tools politely", () => {
    expect(runTool("delete_everything", {}, ctx)).toEqual({ error: "Unknown tool delete_everything" });
  });
});
