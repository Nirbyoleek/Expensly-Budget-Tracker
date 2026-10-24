import { describe, expect, it } from "vitest";
import { TAXONOMY, TAXONOMY_BY_ID, TAXONOMY_CATEGORIES, fullCategoryName, groupOf, subName } from "../taxonomy";
import { BANK_LABELS, BRANDS, ITEM_RULES, KEYWORD_RULES } from "../ingest/merchants";
import { SYSTEM_CATEGORIES } from "../categories";

/** The data the categoriser runs on. A typo here silently files money in a category that doesn't exist. */
describe("category data integrity", () => {
  const validPair = (cat: string, sub: string) => !!TAXONOMY_BY_ID[cat] && (sub === "" || TAXONOMY_BY_ID[cat].subs.some((s) => s.id === sub));

  it("has unique category ids and unique subcategory ids within each category", () => {
    const ids = TAXONOMY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of TAXONOMY) {
      const subs = c.subs.map((s) => s.id);
      expect(new Set(subs).size, c.id).toBe(subs.length);
    }
  });

  it("has every kind of money covered", () => {
    expect(TAXONOMY.filter((c) => c.kind === "spend").length).toBeGreaterThanOrEqual(15);
    expect(TAXONOMY_BY_ID.income.kind).toBe("income");
    expect(TAXONOMY_BY_ID.xfer.kind).toBe("transfer");
    expect(TAXONOMY_BY_ID.invest.kind).toBe("transfer");
    expect(TAXONOMY.reduce((n, c) => n + c.subs.length, 0)).toBeGreaterThanOrEqual(80);
  });

  it("maps every brand to a real category and subcategory", () => {
    const bad = BRANDS.filter((b) => !validPair(b.cat, b.sub)).map((b) => `${b.name} → ${b.cat}/${b.sub}`);
    expect(bad).toEqual([]);
    expect(BRANDS.length).toBeGreaterThan(200);
  });

  it("gives every brand at least one lowercase search key", () => {
    const bad = BRANDS.filter((b) => !b.keys.length || b.keys.some((k) => k !== k.toLowerCase() || !k.trim())).map((b) => b.name);
    expect(bad).toEqual([]);
  });

  it("maps every keyword, item word and bank label to a real category and subcategory", () => {
    const bad = [...KEYWORD_RULES, ...ITEM_RULES].filter((k) => !validPair(k.cat, k.sub)).map((k) => `${k.words[0]} → ${k.cat}/${k.sub}`);
    expect(bad).toEqual([]);
    const badLabels = BANK_LABELS.filter(([, c, s]) => !validPair(c, s)).map(([re]) => String(re));
    expect(badLabels).toEqual([]);
  });

  it("keeps keyword weights between 0 and 1 and words lowercase", () => {
    for (const k of [...KEYWORD_RULES, ...ITEM_RULES]) {
      expect(k.w).toBeGreaterThan(0);
      expect(k.w).toBeLessThanOrEqual(1);
      for (const w of k.words) expect(w, w).toBe(w.toLowerCase());
    }
  });

  it("matches the categories seeded in the database", () => {
    expect(SYSTEM_CATEGORIES.map((c) => c.id)).toEqual(TAXONOMY_CATEGORIES.map((c) => c.id));
    expect(Object.keys(TAXONOMY_CATEGORIES[0]).sort()).toEqual(["color", "default_budget_paise", "id", "kind", "name", "sort"]);
  });

  it("names categories for display", () => {
    expect(fullCategoryName("food", "delivery")).toBe("Food & dining · Food delivery");
    expect(fullCategoryName("food", null)).toBe("Food & dining");
    expect(fullCategoryName("custom1", null, "My category")).toBe("My category");
    expect(subName("bills", "rent")).toBe("Rent");
    expect(subName("bills", "nope")).toBeNull();
  });

  it("puts categories in the right needs/wants/savings group", () => {
    expect(groupOf("groc")).toBe("needs");
    expect(groupOf("food")).toBe("wants");
    expect(groupOf("invest")).toBe("savings");
    expect(groupOf("fees")).toBe("avoidable");
    expect(groupOf("unknown")).toBe("wants");
  });
});
