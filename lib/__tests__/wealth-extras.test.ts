import { describe, expect, it } from "vitest";
import { SYSTEM_CATEGORIES as cats } from "../categories";
import { peopleBalances, personKey } from "../people";
import { goalProgress, goalLink } from "../goals";
import { monthReview } from "../review";
import { remindersFor } from "../reminders";
import { tx } from "../../tests/fixtures";
import type { Goal } from "../types";

describe("money with friends", () => {
  it("nets what you sent against what came back, per UPI ID", () => {
    const rows = [
      tx("2026-10-02", -1200, "people", { merchant_name: "Rahul S", merchant_raw: "UPI/DR/rahul.s@okicici/dinner" }),
      tx("2026-10-09", -800, "people", { merchant_name: "RAHUL SHARMA", merchant_raw: "UPI-rahul.s@okicici-cab" }),
      tx("2026-10-12", 1000, "people", { merchant_name: "Rahul Sharma", merchant_raw: "UPI/CR/rahul.s@okicici" }),
    ];
    const [p] = peopleBalances(rows);
    expect(p).toMatchObject({ key: "rahul.s@okicici", sent: 200000, received: 100000, net: 100000, count: 3, name: "Rahul Sharma" });
  });

  it("shows money that came in from someone as you getting more", () => {
    const rows = [tx("2026-10-02", -500, "people", { merchant_name: "Asha" }), tx("2026-10-03", 2500, "people", { merchant_name: "Asha" })];
    expect(peopleBalances(rows)[0].net).toBe(-200000);
  });

  it("leaves out a single small payment to a stranger and settled balances", () => {
    const rows = [
      tx("2026-10-02", -150, "people", { merchant_name: "Chaiwala" }),
      tx("2026-10-02", -600, "people", { merchant_name: "Neha" }),
      tx("2026-10-05", 600, "people", { merchant_name: "Neha" }),
      tx("2026-10-05", -900, "food", { merchant_name: "Swiggy" }),
    ];
    expect(peopleBalances(rows)).toEqual([]);
  });

  it("falls back to the name when there's no UPI ID", () => {
    expect(personKey({ merchant_name: "  Priya  K ", merchant_raw: "NEFT transfer" })).toBe("priya k");
  });
});

const goal = (extra: Partial<Goal> = {}): Goal => ({ id: "g1", name: "Goa", target_paise: 5000000, saved_paise: 100000, target_date: null, color: "#000000", is_sample: false, ...extra });

describe("self-filling goals", () => {
  const rows = [
    tx("2026-09-05", -5000, "invest", { merchant_name: "Zerodha Coin SIP" }),
    tx("2026-10-05", -5000, "invest", { merchant_name: "Zerodha Coin SIP" }),
    tx("2026-10-07", -3000, "invest", { merchant_name: "HDFC RD", merchant_raw: "RD INSTALMENT hdfcrd@hdfcbank" }),
    tx("2026-10-08", 2000, "invest", { merchant_name: "Zerodha redemption" }),
    tx("2026-10-09", -400, "food", { merchant_name: "Zerodha canteen" }),
  ];

  it("a plain goal is only what you added by hand", () => {
    expect(goalLink(goal())).toBeNull();
    expect(goalProgress(goal(), rows)).toMatchObject({ saved: 100000, auto: 0, count: 0 });
  });

  it("counts investments from the day the link was set, never money coming out", () => {
    const p = goalProgress(goal({ link_kind: "invest", link_from: "2026-10-01" }), rows);
    expect(p).toMatchObject({ auto: 800000, count: 2, last: "2026-10-07", saved: 900000, reached: false });
  });

  it("matches a payee by name or UPI ID, in any category", () => {
    expect(goalProgress(goal({ link_kind: "payee", link_value: "zerodha", link_from: "2026-10-01" }), rows)).toMatchObject({ auto: 540000, count: 2 });
    expect(goalProgress(goal({ link_kind: "payee", link_value: "hdfcrd@", link_from: "2026-10-01" }), rows).auto).toBe(300000);
  });

  it("is reached once hand-added plus automatic money passes the target", () => {
    expect(goalProgress(goal({ target_paise: 900000, link_kind: "invest", link_from: "2026-10-01" }), rows).reached).toBe(true);
  });

  it("a payee link with no text does nothing", () => {
    expect(goalLink(goal({ link_kind: "payee", link_value: "" }))).toBeNull();
  });
});

describe("month in review", () => {
  const rows = [
    tx("2026-08-03", -3000, "food", { merchant_name: "Swiggy" }),
    tx("2026-08-20", 50000, "income", { merchant_name: "Salary" }),
    tx("2026-09-01", 60000, "income", { merchant_name: "Salary" }),
    ...[2, 6, 10, 14, 18].map((d) => tx(`2026-09-${String(d).padStart(2, "0")}`, -1000, "food", { merchant_name: "Swiggy" })),
    tx("2026-09-12", -9000, "shop", { merchant_name: "Croma" }),
    tx("2026-09-15", 1000, "shop", { merchant_name: "Croma refund" }),
    tx("2026-09-20", -5000, "invest", { merchant_name: "SIP" }),
    tx("2026-09-25", -250, "fees", { merchant_name: "GST on fee" }),
    tx("2026-10-01", -99999, "shop", { merchant_name: "Next month" }),
  ];
  const r = monthReview(rows, cats, "2026-09-14");

  it("adds up the month, net of refunds, and compares it with the one before", () => {
    expect(r.month).toBe("2026-09-01");
    expect(r.spent).toBe((5000 + 8000 + 250) * 100);
    expect(r.prevSpent).toBe(300000);
    expect(r.income).toBe(6000000);
    expect(r.saved).toBe(6000000 - 1325000);
    expect(r.invested).toBe(500000);
    expect(r.fees).toBe(25000);
  });

  it("ranks categories and places, and finds the biggest spends", () => {
    expect(r.categories[0]).toMatchObject({ id: "shop", total: 800000, prev: 0 });
    expect(r.categories.find((c) => c.id === "food")).toMatchObject({ total: 500000, prev: 300000 });
    expect(r.topMerchants[0]).toMatchObject({ name: "Croma", total: 900000, count: 1 });
    expect(r.biggest[0].merchant_name).toBe("Croma");
    expect(r.biggest.every((t) => t.date.startsWith("2026-09"))).toBe(true);
  });

  it("writes the short version", () => {
    expect(r.lines.join(" ")).toMatch(/more than the month before/);
    expect(r.lines.join(" ")).toMatch(/Swiggy was your regular: 5 times/);
    expect(r.lines.join(" ")).toMatch(/You kept 78% of what you earned/);
    expect(r.lines.join(" ")).toMatch(/on fees and interest/);
  });

  it("an empty month is just empty", () => {
    const e = monthReview(rows, cats, "2026-05-01");
    expect(e).toMatchObject({ count: 0, spent: 0, saved: null, categories: [], lines: [] });
  });

  it("sends a review reminder on the 1st for the month just gone", () => {
    const list = remindersFor({ today: "2026-10-01", tx: rows, cats, budgetRows: [], prefs: { budget: false, bills: false, weekly: true }, signedUpDaysAgo: 90 });
    expect(list.find((x) => x.key === "review:2026-09")).toMatchObject({ title: "Your September in review", url: "/review/2026-09" });
    const off = remindersFor({ today: "2026-10-01", tx: rows, cats, budgetRows: [], prefs: { budget: false, bills: false, weekly: false }, signedUpDaysAgo: 90 });
    expect(off.some((x) => x.key.startsWith("review:"))).toBe(false);
    const other = remindersFor({ today: "2026-10-02", tx: rows, cats, budgetRows: [], prefs: { budget: false, bills: false, weekly: true }, signedUpDaysAgo: 90 });
    expect(other.some((x) => x.key.startsWith("review:"))).toBe(false);
  });
});
