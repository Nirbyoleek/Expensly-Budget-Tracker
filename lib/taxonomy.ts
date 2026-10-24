import type { Category } from "./types";

/**
 * Expensly's category system: top-level categories (stored in the database) and subcategories (defined here).
 * Every transaction has a category_id and, where known, a subcategory_id.
 *
 * `group` drives the needs / wants / savings split: needs keep life running, wants are choices,
 * savings move money into your future, avoidable is money lost to fees and interest.
 */
export type Group = "needs" | "wants" | "savings" | "avoidable" | "income" | "transfer" | "unsorted";

export type CategoryDef = Category & { group: Group; subs: { id: string; name: string }[] };

const C = (
  id: string, name: string, color: string, kind: Category["kind"], budget: number, sort: number, group: Group,
  subs: [string, string][],
): CategoryDef => ({ id, name, color, kind, default_budget_paise: budget * 100, sort, group, subs: subs.map(([sid, sname]) => ({ id: sid, name: sname })) });

export const TAXONOMY: CategoryDef[] = [
  C("food", "Food & dining", "#F2683C", "spend", 9000, 1, "wants", [
    ["delivery", "Food delivery"], ["restaurants", "Restaurants"], ["cafes", "Cafés & coffee"], ["street", "Snacks & street food"],
  ]),
  C("groc", "Groceries", "#2FB673", "spend", 7000, 2, "needs", [
    ["quick", "Quick commerce"], ["supermarket", "Supermarkets"], ["fresh", "Fruit, veg & dairy"], ["kirana", "Local stores"],
  ]),
  C("trans", "Transport", "#3B8BF6", "spend", 3500, 3, "needs", [
    ["cabs", "Cabs & autos"], ["fuel", "Fuel"], ["transit", "Metro, bus & local train"], ["tolls", "Tolls & parking"], ["vehicle", "Vehicle service"],
  ]),
  C("shop", "Shopping", "#C25BE0", "spend", 5000, 4, "wants", [
    ["marketplace", "Online marketplaces"], ["fashion", "Clothing & shoes"], ["electronics", "Electronics & gadgets"], ["homegoods", "Home & kitchen"],
    ["books", "Books & stationery"], ["other", "Other shopping"],
  ]),
  C("bills", "Bills & utilities", "#7C89A8", "spend", 14500, 5, "needs", [
    ["rent", "Rent"], ["electricity", "Electricity"], ["mobile", "Mobile & internet"], ["gas", "Cooking gas"], ["water", "Water"],
    ["dth", "DTH & cable"], ["insurance", "Insurance"], ["emi", "Loan EMIs"], ["maintenance", "Society maintenance"],
  ]),
  C("subs", "Subscriptions", "#E8A00B", "spend", 2800, 6, "wants", [
    ["streaming", "Video streaming"], ["music", "Music"], ["cloud", "Cloud & software"], ["ai", "AI tools"], ["news", "News & reading"], ["memberships", "Memberships"],
  ]),
  C("gym", "Health & fitness", "#12B5B0", "spend", 4500, 7, "needs", [
    ["fitness", "Gym & fitness"], ["pharmacy", "Pharmacy"], ["doctor", "Doctors & labs"], ["supplements", "Supplements"],
  ]),
  C("fun", "Entertainment", "#E8508A", "spend", 3000, 8, "wants", [
    ["movies", "Movies & events"], ["gaming", "Gaming"], ["nightlife", "Bars & nightlife"], ["hobbies", "Hobbies"],
  ]),
  C("travel", "Travel", "#0EA5E9", "spend", 0, 9, "wants", [
    ["flights", "Flights"], ["trains", "Trains & buses"], ["hotels", "Hotels & stays"], ["bookings", "Travel bookings"], ["abroad", "Spends abroad"],
  ]),
  C("home", "Home & services", "#A3A635", "spend", 0, 10, "needs", [
    ["help", "House help & services"], ["repairs", "Repairs & maintenance"], ["furniture", "Furniture & decor"], ["laundry", "Laundry"],
  ]),
  C("care", "Personal care", "#F472B6", "spend", 0, 11, "wants", [["salon", "Salon & grooming"], ["beauty", "Beauty & skincare"]]),
  C("edu", "Education", "#6366F1", "spend", 0, 12, "needs", [["courses", "Courses & learning"], ["tuition", "School & tuition fees"], ["exams", "Exams & certifications"]]),
  C("family", "Family & gifts", "#FB7185", "spend", 0, 13, "wants", [["gifts", "Gifts"], ["support", "Family support"], ["kids", "Kids"]]),
  C("people", "Sent to people", "#94A3B8", "spend", 0, 14, "wants", [["p2p", "Friends & others"]]),
  C("fees", "Fees & interest", "#EF4444", "spend", 0, 15, "avoidable", [
    ["interest", "Card & loan interest"], ["gst", "GST on charges"], ["forex", "Forex markup"], ["late", "Late & penalty fees"],
    ["annual", "Annual & joining fees"], ["platform", "Platform & convenience fees"], ["bank", "Bank charges"],
  ]),
  C("govt", "Taxes & government", "#64748B", "spend", 0, 16, "needs", [["documents", "Passports & documents"], ["tax", "Income & property tax"], ["fines", "Fines & challans"]]),
  C("cash", "Cash withdrawals", "#78716C", "spend", 0, 17, "wants", [["atm", "ATM withdrawals"]]),
  C("donate", "Donations", "#22C55E", "spend", 0, 18, "wants", [["charity", "Charity"], ["religious", "Religious offerings"]]),
  // Where unknown spends wait until someone files them, instead of quietly inflating Shopping.
  C("uncat", "Uncategorised", "#9CA3AF", "spend", 0, 19, "unsorted", []),
  C("invest", "Investments", "#7D8EFF", "transfer", 0, 80, "savings", [
    ["sip", "Mutual fund SIPs"], ["stocks", "Stocks"], ["deposits", "FDs & RDs"], ["gold", "Gold"], ["retirement", "PPF, EPF & NPS"],
  ]),
  C("income", "Income", "#3DDC97", "income", 0, 90, "income", [
    ["salary", "Salary"], ["freelance", "Freelance & business"], ["cashback", "Cashback & rewards"], ["interest", "Interest earned"],
    ["dividend", "Dividends"], ["gifts", "Gifts received"], ["other", "Other income"],
  ]),
  C("xfer", "Card payments & transfers", "#8A93A8", "transfer", 0, 91, "transfer", [["card", "Credit card bill"], ["self", "Between your accounts"]]),
];

export const TAXONOMY_BY_ID: Record<string, CategoryDef> = Object.fromEntries(TAXONOMY.map((c) => [c.id, c]));

export function subName(categoryId: string, subId: string | null | undefined): string | null {
  if (!subId) return null;
  return TAXONOMY_BY_ID[categoryId]?.subs.find((s) => s.id === subId)?.name ?? null;
}

/** "Food & dining · Food delivery", or just the category when there's no subcategory. */
export function fullCategoryName(categoryId: string, subId: string | null | undefined, fallback?: string) {
  const c = TAXONOMY_BY_ID[categoryId]?.name ?? fallback ?? categoryId;
  const s = subName(categoryId, subId);
  return s ? `${c} · ${s}` : c;
}

export const groupOf = (categoryId: string): Group => TAXONOMY_BY_ID[categoryId]?.group ?? "wants";

/** Like groupOf, but your own categories use the group you picked for them. */
export const groupFor = (id: string, cats: Category[]): Group => TAXONOMY_BY_ID[id]?.group ?? cats.find((c) => c.id === id)?.grp ?? "wants";

/** Your own categories have no built-in definition. */
export const isCustomCategory = (c: Pick<Category, "id" | "user_id">) => !!c.user_id || !TAXONOMY_BY_ID[c.id];

/** Plain categories in the shape the database and older code expect. */
export const TAXONOMY_CATEGORIES: Category[] = TAXONOMY.map(({ subs: _s, group: _g, ...c }) => c);
