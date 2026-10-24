import { BANK_LABELS, BRANDS, ITEM_RULES, KEYWORD_RULES, TRANSFER_RE, type Brand } from "./merchants";
import type { MerchantRule } from "@/lib/types";

/**
 * Expensly's categoriser. Each stage either decides or passes; the first confident answer wins.
 *
 *   1. your rules            "always put X in Y"
 *   2. card bills & self transfers
 *   3. structure             interest, GST, forex fees, ATM, cashback, salary, SIPs, EMIs …
 *   4. memory                how you categorised this merchant before
 *   5. known brands          ~300 Indian merchants, each with a subcategory
 *   6. the bank's own label  "…,JALPAIGURI RESTAURANTS"
 *   7. people                UPI payments to a person's name
 *   8. keywords              "medical", "salon", "petrol" …
 *   9. fallback
 *
 * Every decision carries plain-language reasons so the app can say *why*.
 */

export type Classification = {
  category_id: string;
  subcategory_id: string | null;
  confidence: number;
  reasons: string[];
  /** A friendlier name when the bank's wording is useless ("DEBIT INTEREST" → "Card interest"). */
  name?: string;
  /** Money coming back for a purchase: counts against the category, not as income. */
  refund?: boolean;
  /** Decided from the wording itself (fees, interest, cashback …), not the merchant. */
  structural?: boolean;
  /** Charged in a foreign currency. */
  foreign?: string;
};

export type MemoryEntry = { category_id: string; subcategory_id: string | null; n: number };
/** merchant name (lower-cased) → what you chose for it before. */
export type Memory = Map<string, MemoryEntry>;

/* ───────────────────────── name cleaning ───────────────────────── */

const CITIES = [
  "bangalore", "banglore", "bengaluru", "mumbai", "bombay", "delhi", "new delhi", "newdelhi", "gurgaon", "gurugram", "noida", "kolkata",
  "calcutta", "chennai", "hyderabad", "pune", "ahmedabad", "surat", "jaipur", "lucknow", "kanpur", "nagpur", "indore", "bhopal", "patna",
  "siliguri", "jalpaiguri", "guwahati", "ghaziabad", "faridabad", "chandigarh", "kochi", "cochin", "thane", "navi mumbai", "vadodara",
  "coimbatore", "mysore", "mysuru", "visakhapatnam", "bhubaneswar", "dehradun", "london", "singapore", "dublin", "san francisco",
  "amsterdam", "luxembourg", "cupertino", "seattle", "mountain view", "india",
].sort((a, b) => b.length - a.length);

const COMPANY_NOISE = ["private", "limited", "pvt", "ltd", "llp", "inc", "technologies", "technology", "services", "solutions", "enterprises", "corporation", "company", "india", "retail", "online", "internet", "digital"];

const STOP = new Set([
  "upi", "dr", "cr", "p2m", "p2a", "imps", "neft", "rtgs", "pos", "ecom", "ach", "nach", "mb", "ib", "ref", "txn", "ecs", "bil", "bpay",
  "yesb", "hdfc", "icic", "utib", "sbin", "kkbk", "pytm", "punb", "barb", "idib", "cnrb", "ubin", "indb", "fdrl", "axis", "sbi", "ybl", "okaxis", "oksbi", "okhdfcbank", "okicici",
  "payment", "paid", "via", "to", "from", "the", "for", "upiintent", "collect", "pay", "transfer", "trf", "debit", "credit", "d", "c", "si",
]);

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s&\-.'(])([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/\s+/g, " ").trim();

/** Drop a city glued to the end of a word: "ZOMATOGURGAON" → "ZOMATO", "CoffeeDelhi" → "Coffee". */
function unglueCity(s: string): string {
  let out = s.trim();
  for (let i = 0; i < 2; i++) {
    const low = out.toLowerCase();
    const city = CITIES.find((c) => low.endsWith(c) && low.length > c.length + 2);
    if (!city) break;
    out = out.slice(0, out.length - city.length).trim();
  }
  return out;
}

export type Cleaned = { name: string; label: string | null; foreign: string | null; vpa: string | null };

/** Strip everything a bank adds around a merchant name. */
export function cleanRaw(rawIn: string): Cleaned {
  let s = rawIn.split(" | ")[0]; // SMS rows: "merchant | full message"
  let foreign: string | null = null;
  let label: string | null = null;
  let vpa: string | null = null;

  s = s.replace(/\(\s*(usd|eur|gbp|aed|sgd|jpy|aud|cad|chf|thb)\s*([\d,.]+)\s*\)/i, (_, cur, amt) => {
    foreign = `${cur.toUpperCase()} ${amt}`;
    return " ";
  });
  s = s.replace(/[\w.\-]+@[a-z]+\b/gi, (v) => {
    vpa ??= v.toLowerCase();
    return " " + v.split("@")[0].replace(/[._\-]/g, " ") + " ";
  });
  s = s
    .replace(/^[\s|]+/, "")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ") // times
    .replace(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g, " ") // dates printed in the narration
    .replace(/https?:\/\/\S*|www\.\S*|\b[\w-]+\.(?:com|in|co|net|org|io|ai)\b\S*/gi, " ") // urls
    .replace(/\bIN\s+\d+\s*$/i, " ") // "FLIPKART BANGALORE IN 525"
    .replace(/(?:\s+(?:C|D|CR|DR|\+|-))+\s*$/i, " ") // trailing direction markers
    .replace(/\b(?:x+|\*+)\d{3,4}\b/gi, " ")
    .replace(/\b\d{5,}\b/g, " ")
    .replace(/^\s*[A-Z]{2,4}\s?\*\s*/i, "") // gateway prefixes: PYU*, PTM*, RAZ*, PAY*, PNB*
    .replace(/^\s*m\s?\/?\s?s\.?\s+/i, ""); // "M/S", "M S"

  // "MERCHANT,CITY LABEL": the bank's own category label after the comma
  const comma = s.indexOf(",");
  if (comma > 2) {
    const tail = s.slice(comma + 1);
    for (const [re] of BANK_LABELS) if (re.test(tail)) { label = tail.trim(); break; }
    s = s.slice(0, comma);
  }

  // Slash- or dash-separated bank formats: keep the first part that looks like a name.
  if (/[\/]|-[A-Z]{3,}-/i.test(s)) {
    const parts = s.split(/[\/]|(?<=\S)-(?=\S)/).map((p) => p.trim()).filter(Boolean);
    const named = parts.find((p) => /[a-z]{3,}/i.test(p) && !STOP.has(p.toLowerCase()) && !/^\d/.test(p) && !/^(?:cr|dr|d|c)$/i.test(p));
    if (named) s = named;
  }

  s = s.replace(/\*/g, " ");
  s = unglueCity(s);
  let words = s.replace(/[^a-z0-9&.' ]/gi, " ").split(/\s+/).filter(Boolean);
  words = words.filter((w) => !STOP.has(w.toLowerCase()) || words.length === 1);
  // drop trailing cities, company words and truncated company words ("PRIVATE LI", "TECHNOLOGI")
  const isNoise = (w: string) => {
    const l = w.toLowerCase().replace(/\.$/, "");
    if (CITIES.includes(l)) return true;
    return l.length >= 2 && COMPANY_NOISE.some((n) => n.startsWith(l) && (l.length >= 3 || n === "llp" || l === "pv" || l === "lt"));
  };
  while (words.length > 1 && isNoise(words[words.length - 1])) words.pop();
  if (words.length > 1) words[words.length - 1] = words[words.length - 1].replace(/^(resta|restau|restaur|restaura|restauran)$/i, "Restaurant");
  if (words.length && /^\d+$/.test(words[words.length - 1])) words.pop();
  return { name: titleCase(words.join(" ")).slice(0, 40).trim(), label, foreign, vpa };
}

/* ───────────────────────── brands ───────────────────────── */

const keyRe = new Map<string, RegExp>();
function hasKey(text: string, key: string): boolean {
  if (key.length >= 6 || /[^a-z0-9]/.test(key)) return text.includes(key);
  let re = keyRe.get(key);
  if (!re) keyRe.set(key, (re = new RegExp(`(?<![a-z])${key}(?![a-z])`)));
  return re.test(text);
}

/** The brand with the most specific matching key ("swiggy instamart" beats "swiggy"). */
export function findBrand(text: string): Brand | undefined {
  const low = " " + text.toLowerCase() + " ";
  let best: Brand | undefined, bestLen = 0;
  for (const b of BRANDS) for (const k of b.keys) if (k.length > bestLen && hasKey(low, k)) { best = b; bestLen = k.length; }
  return best;
}

/* ───────────────────────── structural detectors ───────────────────────── */

type Detector = { test: RegExp; dir: "in" | "out" | "any"; cat: string; sub: string | null; name?: string; why: string; conf?: number };

const DETECTORS: Detector[] = [
  { test: /cash ?back|reward(?:s)? (?:credit|redeem|redemption)|reward points? (?:credit|redeem)/i, dir: "in", cat: "income", sub: "cashback", name: "Cashback", why: "Says cashback or rewards" },
  { test: /debit interest|interest charge|finance charge|interest on (?:card|outstanding|purchase|cash)|\bint(?:erest)?\.? ?chg|interest debited|retail interest/i, dir: "out", cat: "fees", sub: "interest", name: "Card interest", why: "Interest charged on an unpaid balance" },
  { test: /\b[cis]?gst\b|gst[- ]|igst|cgst|sgst/i, dir: "out", cat: "fees", sub: "gst", name: "GST on charges", why: "GST charged on fees or interest" },
  { test: /foreign currency (?:transaction )?(?:fee|markup|mark-up|charge)|forex markup|cross[- ]currency|markup fee|dcc (?:fee|markup)/i, dir: "out", cat: "fees", sub: "forex", name: "Forex markup", why: "Fee for paying in a foreign currency" },
  { test: /late (?:payment )?(?:fee|charge)|penal (?:interest|charge)|over ?limit|bounce|return(?:ed)? charge|ecs return|nach return|cheque return/i, dir: "out", cat: "fees", sub: "late", name: "Late or penalty fee", why: "A late, bounce or penalty charge" },
  { test: /annual fee|joining fee|renewal fee|membership fee (?:for )?card|card fee/i, dir: "out", cat: "fees", sub: "annual", name: "Card annual fee", why: "Card annual or joining fee" },
  { test: /convenience fee|platform fee|processing fee|handling fee|surcharge/i, dir: "out", cat: "fees", sub: "platform", why: "A convenience, processing or surcharge fee" },
  { test: /sms (?:alert )?charges?|\bamc\b|min(?:imum)? bal|non[- ]?maint|chq ?book|cheque ?book|service charge|debit card (?:annual|fee)|atm (?:charge|fee)|card replacement/i, dir: "out", cat: "fees", sub: "bank", name: "Bank charges", why: "A bank service charge" },
  { test: /\batm\b|cash withdrawal|cash wdl|\bnwd\b|\bawd\b|\batw\b|cash at pos/i, dir: "out", cat: "cash", sub: "atm", name: "ATM withdrawal", why: "Cash taken out" },
  { test: /salary|\bsal\b|payroll|sal cr|wages/i, dir: "in", cat: "income", sub: "salary", why: "Says salary" },
  { test: /dividend|\bdiv\b/i, dir: "in", cat: "income", sub: "dividend", name: "Dividend", why: "A dividend payout" },
  { test: /interest (?:paid|credit|earned)|\bint\.? ?(?:pd|cr|credit)\b|sb ?int|savings interest|fd interest|\binterest\b/i, dir: "in", cat: "income", sub: "interest", name: "Interest earned", why: "Interest paid to you" },
  { test: /\bsip\b|mutual fund|\bmf\b|systematic investment|bse ?star|\bamc\b.*(?:fund|mf)/i, dir: "out", cat: "invest", sub: "sip", why: "A mutual fund investment" },
  { test: /fixed deposit|\bfd\b (?:booking|creation|open)|recurring deposit|\brd\b inst|\brd\b a\/?c/i, dir: "out", cat: "invest", sub: "deposits", why: "Money put into a deposit" },
  { test: /\bppf\b|\bepf\b|\bnps\b|\bapy\b|atal pension|sukanya/i, dir: "out", cat: "invest", sub: "retirement", why: "A retirement or long-term savings scheme" },
  { test: /\bemi\b|loan (?:repay|inst|emi)|\bloan\b.*(?:nach|ecs|ach)|(?:nach|ecs|ach).*\bloan\b/i, dir: "out", cat: "bills", sub: "emi", why: "A loan EMI" },
  { test: /advance tax|self assessment tax|\btds\b|income tax|property tax|municipal tax|gst payment/i, dir: "out", cat: "govt", sub: "tax", why: "A tax payment" },
];

const REFUND_RE = /refund|reversal|reversed|\brev\b|chargeback|cancell?ation|cancelled|\brfnd\b/i;
const UPI_RE = /\bupi\b|\bvpa\b|@[a-z]{2,}|\bp2a\b|\bimps\b|sent rs|sent inr|paid to|trf to|transfer to|\bneft\b/i;
/** "UPI/DR/…/NAME" or "UPI/CR/…/NAME": the bank says outright it's a UPI transfer, so a bare first name is a person. */
const UPI_P2P_RE = /\bupi\s*\/\s*(?:dr|cr|p2p|p2a)\b/i;
/** Direction markers ("UPI/DR/", "/CR/") aren't words: "DR" here isn't a doctor. */
const stripDirection = (s: string) => s.replace(/\/\s*(?:dr|cr)\s*\//gi, "/").replace(/\b(?:dr|cr)\s*$/i, "");
const MERCHANT_QR_RE = /paytmqr|bharatpe|\bq\d{6,}@|phonepe ?merchant|gpay-?\d|\bmerchant\b|\bpinelabs\b|razorpay/i;

/** Two or three alphabetic words with no business words: probably a person. */
function looksLikePerson(name: string, allowOneWord = false): boolean {
  const w = name.split(/\s+/).filter(Boolean);
  if (w.length < (allowOneWord ? 1 : 2) || w.length > 4) return false;
  if (w.length === 1 && (w[0].length < 3 || keywordGuess(w[0]))) return false;
  if (!w.every((x) => /^[a-z.]+$/i.test(x) && x.replace(/\./g, "").length >= 1)) return false;
  return !KEYWORD_RULES.some((k) => k.words.some((kw) => w.some((x) => x.toLowerCase() === kw)));
}

/** Two to four plain words with no business words, like "Lara Sharma": never sent to the AI or the shared cache. */
export const mayBePerson = (name: string) => looksLikePerson(name);

/** The shared-cache key for a merchant name: lowercase words only. */
export const merchantCacheKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

function keywordGuess(text: string, typed = false): { cat: string; sub: string; conf: number; word: string } | null {
  const low = " " + text.toLowerCase().replace(/[^a-z0-9é ]+/g, " ").replace(/\s+/g, " ") + " ";
  let best: { cat: string; sub: string; conf: number; word: string } | null = null;
  // Item words ("coke", "haircut") only for things you typed: in a bank's merchant text they'd misfire.
  for (const k of typed ? [...KEYWORD_RULES, ...ITEM_RULES] : KEYWORD_RULES) {
    for (const word of k.words) {
      if (!low.includes(` ${word} `)) continue;
      if (!best || k.w > best.conf) best = { cat: k.cat, sub: k.sub, conf: k.w, word };
    }
  }
  return best;
}

/* ───────────────────────── classify ───────────────────────── */

export const ruleKey = (merchantName: string) => merchantName.trim().toLowerCase();

/** Names Expensly gives rows it couldn't name. Never learn from them or apply them to "all". */
const GENERIC = new Set(["money sent", "money received", "card payment", "statement entry", "upi payment", "expense", "cashback", "interest earned", "bank charges", "card bill payment", "card payment received", "self transfer"]);
export const isGenericName = (name: string) => GENERIC.has(ruleKey(name));

const SHARED_VPA = /^(?:razorpay|rzp|billdesk|payu|cashfree|ccavenue|juspay|easebuzz|cred\.?club|credpay|paytm|phonepe|gpay|googlepay|amazonpay|apay|bharatpe|mobikwik|airtel|jio|upi|merchant|pay|payment|payments|collect)[.\-]?(?:\w{0,6})?@/;

/** The UPI ID in a row's bank text, if any. More stable than the name: names get cut short, IDs don't. */
export function vpaOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  for (const m of raw.matchAll(/[\w.\-]{3,}@[a-z]{2,}\b/gi)) {
    const v = m[0].toLowerCase();
    // gateway IDs are shared by thousands of merchants, so they say nothing about who was paid
    if (/[a-z]/.test(v.split("@")[0]) && !SHARED_VPA.test(v)) return v;
  }
  return null;
}

/** Who a payment went to or came from: the UPI ID when there is one, else the cleaned name. */
export function payeeKey(merchantName: string, raw?: string | null): string {
  return vpaOf(raw) ?? ruleKey(merchantName);
}

const brandConf = (b: Brand) => (b.name === "CRED Pay" ? 0.5 : 0.95);

export function classify(
  merchantName: string,
  raw: string,
  amountPaise: number,
  opts: { rules?: MerchantRule[]; memory?: Memory; label?: string | null; foreign?: string | null; typed?: boolean } = {},
): Classification {
  const { rules = [], memory } = opts;
  const out = amountPaise < 0;
  const key = ruleKey(merchantName);
  const vpa = vpaOf(raw);
  const remembered = () => (vpa ? memory?.get(vpa) : undefined) ?? (isGenericName(merchantName) ? undefined : memory?.get(key));
  const rawLow = raw.toLowerCase();
  const foreign = opts.foreign ?? undefined;
  const done = (c: Omit<Classification, "foreign">): Classification => ({
    ...c,
    reasons: foreign ? [...c.reasons, `Charged in ${foreign.split(" ")[0]}`] : c.reasons,
    foreign,
  });

  // 1. rules
  const rule = (vpa ? rules.find((r) => r.pattern === vpa) : undefined) ?? (isGenericName(merchantName) ? undefined : rules.find((r) => r.pattern === key)) ?? rules.find((r) => r.pattern.length >= 4 && rawLow.includes(r.pattern));
  if (rule)
    return done({ category_id: rule.category_id, subcategory_id: rule.subcategory_id ?? null, confidence: 1, name: rule.rename_to ?? undefined, reasons: [`Your rule for “${rule.pattern}”`] });

  // 2. card bills and own-account moves
  if (TRANSFER_RE.test(raw)) {
    const self = /self transfer|own a\/?c|own account|\bsweep\b/i.test(raw);
    return done({ category_id: "xfer", subcategory_id: self ? "self" : "card", confidence: 0.9, reasons: [self ? "Money moved between your own accounts" : "A credit card bill payment, so it isn't counted as spending"] });
  }

  // 3. structure
  for (const d of DETECTORS) {
    if ((d.dir === "out" && !out) || (d.dir === "in" && out)) continue;
    if (!d.test.test(raw)) continue;
    // a brand named in the text wins over a loose word ("Interest" in a shop name is rare, but "SIP" in a café isn't)
    if (d.cat !== "fees" && d.cat !== "cash" && d.sub !== "cashback" && findBrand(raw) && d.cat !== "income") break;
    return done({ category_id: d.cat, subcategory_id: d.sub, confidence: d.conf ?? 0.95, name: d.name, structural: true, reasons: [d.why] });
  }

  const brand = findBrand(merchantName + " " + raw);

  // Money in that isn't income: refunds from shops
  if (!out) {
    const refundWords = REFUND_RE.test(raw);
    const spendBrand = brand && brand.cat !== "income" && brand.cat !== "invest";
    if (refundWords || spendBrand) {
      const mem = remembered();
      const cat = mem?.category_id && mem.category_id !== "income" ? mem.category_id : spendBrand ? brand!.cat : keywordGuess(merchantName + " " + raw)?.cat;
      const sub = mem?.category_id === cat ? mem?.subcategory_id ?? null : spendBrand && brand!.cat === cat ? brand!.sub : null;
      if (cat && cat !== "fees")
        return done({ category_id: cat, subcategory_id: sub, confidence: spendBrand ? 0.9 : 0.75, refund: true, reasons: [`Money back from ${brand?.name ?? merchantName}, so it reduces your ${cat === "shop" ? "shopping" : "spending"} rather than counting as income`] });
      if (refundWords)
        return done({ category_id: "uncat", subcategory_id: null, confidence: 0.5, refund: true, reasons: ["Looks like a refund, but the shop isn't clear"] });
    }
    if (brand?.cat === "invest") return done({ category_id: "invest", subcategory_id: brand.sub, confidence: 0.85, reasons: [`Money back from ${brand.name}: a redemption or withdrawal`] });
    const fromPerson = UPI_RE.test(raw) && looksLikePerson(merchantName, UPI_P2P_RE.test(raw));
    if (/freelance|invoice|consult|client/i.test(raw)) return done({ category_id: "income", subcategory_id: "freelance", confidence: 0.85, reasons: ["Looks like payment for work"] });
    // A friend paying you back: it offsets what you've sent to people instead of inflating income.
    if (fromPerson)
      return done({ category_id: "people", subcategory_id: "p2p", confidence: 0.7, refund: true, reasons: [`Money received from ${merchantName}`, "Counted against what you've sent to people, so splits and paybacks don't look like income. File it as Income if it was pay or a gift"] });
    return done({
      category_id: "income",
      subcategory_id: "other",
      confidence: /neft|imps|rtgs/i.test(raw) ? 0.8 : 0.7,
      reasons: ["Money coming in"],
    });
  }

  // 4. memory (by UPI ID first, then by name)
  const mem = remembered();
  if (mem && mem.category_id !== "income")
    return done({ category_id: mem.category_id, subcategory_id: mem.subcategory_id, confidence: mem.n >= 2 ? 0.93 : 0.86, reasons: [`You filed ${merchantName} here ${mem.n === 1 ? "before" : `${mem.n} times`}`] });

  // 5. brands
  if (brand) {
    const reasons = [`Recognised ${brand.name}`];
    if (brand.name === "CRED Pay") reasons.push("Paid through CRED: usually rent, education or a bill. Tell Expensly which and it will remember");
    return done({ category_id: brand.cat, subcategory_id: brand.sub || null, confidence: brandConf(brand), reasons });
  }

  // 6. the bank's own label
  const label = opts.label;
  if (label) {
    const hit = BANK_LABELS.find(([re]) => re.test(label));
    if (hit) {
      const kw = keywordGuess(merchantName);
      // a specific word in the name refines a vague label ("RETAIL STORES" + "pharmacy")
      if (kw && (hit[1] === "shop" && hit[2] === "other")) return done({ category_id: kw.cat, subcategory_id: kw.sub, confidence: kw.conf, reasons: [`The name mentions “${kw.word}”`] });
      return done({ category_id: hit[1], subcategory_id: hit[2], confidence: hit[2] === "other" ? 0.6 : 0.85, reasons: [`Your bank labels it “${titleCase(label.replace(/^[^ ]+ /, (m) => (CITIES.includes(m.trim().toLowerCase()) ? "" : m)))}”`] });
    }
  }

  // 7. people
  if (UPI_RE.test(raw) && !MERCHANT_QR_RE.test(raw) && looksLikePerson(merchantName, UPI_P2P_RE.test(raw)))
    return done({ category_id: "people", subcategory_id: "p2p", confidence: 0.62, reasons: [`A UPI payment to a person (${merchantName})`, "Set a category if it was for something specific"] });

  // 8. keywords
  const kw = keywordGuess(merchantName + " " + stripDirection(raw.split(" | ")[0]), opts.typed);
  if (kw) return done({ category_id: kw.cat, subcategory_id: kw.sub, confidence: kw.conf, reasons: [`The name mentions “${kw.word}”`] });

  // 9. fallback
  if (MERCHANT_QR_RE.test(raw)) return done({ category_id: "uncat", subcategory_id: null, confidence: 0.4, reasons: ["Paid at a shop's QR code, but the shop is unknown", "Pick a category once and Expensly remembers this payee"] });
  return done({ category_id: "uncat", subcategory_id: null, confidence: 0.3, reasons: ["Expensly doesn't know this merchant yet", "Pick a category once and Expensly remembers it"] });
}

/* ───────────────────────── memory ───────────────────────── */

/**
 * Learn from what you've confirmed or changed. Only reviewed rows count, so Expensly's own guesses
 * don't reinforce themselves.
 */
export function buildMemory(
  txns: { merchant_name: string; merchant_raw?: string | null; category_id: string; subcategory_id?: string | null; reviewed: boolean }[],
): Memory {
  const votes = new Map<string, Map<string, number>>();
  const vote = (k: string, id: string) => {
    const v = votes.get(k) ?? new Map<string, number>();
    v.set(id, (v.get(id) ?? 0) + 1);
    votes.set(k, v);
  };
  for (const t of txns) {
    if (!t.reviewed || t.category_id === "xfer") continue;
    const id = `${t.category_id}:${t.subcategory_id ?? ""}`;
    if (!isGenericName(t.merchant_name)) vote(ruleKey(t.merchant_name), id);
    const vpa = vpaOf(t.merchant_raw);
    if (vpa) vote(vpa, id);
  }
  const mem: Memory = new Map();
  for (const [k, v] of votes) {
    const [id, n] = [...v.entries()].sort((a, b) => b[1] - a[1])[0];
    const [category_id, sub] = id.split(":");
    mem.set(k, { category_id, subcategory_id: sub || null, n });
  }
  return mem;
}
