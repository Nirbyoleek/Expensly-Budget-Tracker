import { addMonths, daysInMonth, monthStart, pad2 } from "./dates";

/**
 * Four months of believable sample spending, ending today. Deterministic so screenshots and
 * tests are stable. Every row is tagged source "sample" so it can be removed in one tap.
 */

type SampleTx = { date: string; amount_paise: number; merchant_name: string; category_id: string; subcategory_id: string | null; reviewed: boolean };

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const MONTHLY: [number, string, number, string, string][] = [
  [1, "Salary · Acme Labs", 9500000, "income", "salary"],
  [1, "House rent", -1200000, "bills", "rent"],
  [3, "Netflix", -19900, "subs", "streaming"],
  [4, "Cult.fit", -159900, "gym", "fitness"],
  [5, "Groww · SIP", -500000, "invest", "sip"],
  [6, "Jio recharge", -34900, "bills", "mobile"],
  [7, "Maid", -300000, "home", "help"],
  [11, "Spotify", -13900, "subs", "music"],
  [11, "WBSEDCL", -126000, "bills", "electricity"],
  [18, "YouTube Premium", -14900, "subs", "streaming"],
  [22, "Claude", -170000, "subs", "ai"],
  [24, "Airtel broadband", -79900, "bills", "mobile"],
  [26, "iCloud+", -21900, "subs", "cloud"],
];

const EVERYDAY: [string, string, string, number, number][] = [
  // name, category, subcategory, min ₹, max ₹
  ["Swiggy", "food", "delivery", 220, 560],
  ["Zomato", "food", "delivery", 250, 520],
  ["Chai & samosa", "food", "street", 30, 60],
  ["Momo Point", "food", "street", 120, 200],
  ["Blue Tokai", "food", "cafes", 220, 420],
  ["Golden Valley Restaurant", "food", "restaurants", 600, 1400],
  ["Blinkit", "groc", "quick", 300, 900],
  ["Zepto", "groc", "quick", 250, 950],
  ["BigBasket", "groc", "quick", 1200, 2100],
  ["Fruit stall", "groc", "fresh", 80, 220],
  ["Rapido", "trans", "cabs", 50, 140],
  ["Toto ride", "trans", "cabs", 20, 40],
  ["Uber", "trans", "cabs", 160, 320],
  ["Indian Oil", "trans", "fuel", 400, 600],
  ["Amazon", "shop", "marketplace", 500, 2400],
  ["Myntra", "shop", "fashion", 800, 1800],
  ["Apollo Pharmacy", "gym", "pharmacy", 180, 650],
  ["PVR INOX", "fun", "movies", 400, 700],
  ["Steam", "fun", "gaming", 300, 900],
];

export function sampleTransactions(today: string): SampleTx[] {
  const r = rng(42);
  const cur = monthStart(today);
  const out: SampleTx[] = [];
  for (let back = 3; back >= 0; back--) {
    const m = addMonths(cur, -back);
    const last = back === 0 ? Number(today.slice(8, 10)) : daysInMonth(m);
    const iso = (d: number) => `${m.slice(0, 8)}${pad2(d)}`;
    for (const [d, n, a, c, sub] of MONTHLY) if (d <= last) out.push({ date: iso(d), amount_paise: a, merchant_name: n, category_id: c, subcategory_id: sub, reviewed: true });
    if (back === 1 || back === 3) out.push({ date: iso(15), amount_paise: 1800000, merchant_name: "Freelance · landing page", category_id: "income", subcategory_id: "freelance", reviewed: true });
    if (back === 2 && last >= 9) out.push({ date: iso(9), amount_paise: -640000, merchant_name: "IndiGo", category_id: "travel", subcategory_id: "flights", reviewed: true });
    for (let d = 1; d <= last; d++) {
      const count = r() < 0.18 ? 0 : r() < 0.6 ? 1 : 2; // some no-spend days
      for (let k = 0; k < count; k++) {
        const [n, c, sub, lo, hi] = EVERYDAY[Math.floor(r() * EVERYDAY.length)];
        if ((c === "shop" || c === "fun" || sub === "restaurants") && r() < 0.6) continue; // rarer
        const rupees = Math.round(lo + r() * (hi - lo));
        out.push({ date: iso(d), amount_paise: -rupees * 100, merchant_name: n, category_id: c, subcategory_id: sub, reviewed: back > 0 || d < last - 3 });
      }
    }
  }
  return out;
}

export const SAMPLE_ACCOUNTS = [
  { name: "HDFC Savings", type: "bank", balance_paise: 14832000 },
  { name: "SBI Savings", type: "bank", balance_paise: 4210000 },
  { name: "ICICI Amazon Pay card", type: "card", balance_paise: -1846000, last4: "9876" },
  { name: "Zerodha · stocks", type: "investment", balance_paise: 18690000 },
  { name: "Mutual funds · SIPs", type: "investment", balance_paise: 12450000 },
  { name: "Cash in wallet", type: "cash", balance_paise: 320000 },
] as const;

export const SAMPLE_GOALS = [
  { name: "Goa trip", target_paise: 4000000, saved_paise: 2650000, color: "#E8A00B", months: 2 },
  { name: "Emergency fund", target_paise: 15000000, saved_paise: 9200000, color: "#2FB673", months: 8 },
  { name: "New MacBook", target_paise: 12000000, saved_paise: 3100000, color: "#3B8BF6", months: 5 },
  { name: "Concert fund", target_paise: 1200000, saved_paise: 1000000, color: "#E8508A", months: 1 },
] as const;

/** Net worth for the four months before this one, so the trend line has a shape. */
export function sampleSnapshots(today: string) {
  const cur = monthStart(today);
  return [41200000, 43150000, 44820000, 47100000].map((total, i) => ({
    month: addMonths(cur, i - 4),
    assets_paise: total + 1500000,
    liabilities_paise: 1500000,
  }));
}
