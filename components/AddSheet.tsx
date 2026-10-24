"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTransactions, findExisting, listAccounts, undoImport } from "@/app/actions";
import { aiSortImport, type AiPick } from "@/app/import-ai";
import { isGenericName, merchantCacheKey, payeeKey, prepareRows, REVIEW_THRESHOLD, vpaOf, type PreparedRow } from "@/lib/ingest/core";
import { CategorySelect } from "@/components/CategoryPicker";
import { parseQuick, parseSms, parseStatement } from "@/lib/ingest/parsers";
import { accountLast4, closingBalance, describeCheck, reconcile, type PdfPage } from "@/lib/ingest/table";
import type { RawRow } from "@/lib/ingest/core";
import { inr } from "@/lib/money";
import { shortDate, todayISO } from "@/lib/dates";
import { Sheet, useApp } from "./app";
import { enqueue, isOfflineError } from "@/lib/offline-queue";
import StatementGuide from "./StatementGuide";

type Row = PreparedRow & { include: boolean; dupe: boolean; edited: boolean };

const SAMPLE_STATEMENT = `Date,Transaction Details,Amount (INR),Type
14/10/2026,UPI/ZOMATO ONLINE/bangalore,418.00,Dr
15/10/2026,POS AMAZON PAY INDIA,2499.00,Dr
16/10/2026,PAYMENT RECEIVED - CRED CLUB THANK YOU,18460.00,Cr
17/10/2026,ECOM NETFLIX.COM,199.00,Dr
18/10/2026,UPI/BLINKIT/grocery,455.00,Dr
19/10/2026,HPCL FUEL STATION SILIGURI,800.00,Dr
20/10/2026,UPI/DOMINOS PIZZA,563.00,Dr
21/10/2026,REFUND MYNTRA DESIGNS,1499.00,Cr`;

export default function AddSheet() {
  const { addMode, closeAdd, openAdd } = useApp();
  if (!addMode) return null;
  return (
    <Sheet title={addMode === "statement" ? "Import statement" : "Add spending"} onClose={closeAdd}>
      <div className="seg" role="tablist">
        {(["quick", "sms", "statement"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={addMode === m} aria-pressed={addMode === m} onClick={() => openAdd(m)}>
            {m === "quick" ? "Quick add" : m === "sms" ? "Bank SMS" : "Statement"}
          </button>
        ))}
      </div>
      {addMode === "statement" ? <StatementPane key="st" /> : <TextPane key={addMode} mode={addMode} />}
    </Sheet>
  );
}

/* ───────────────────────── quick add & SMS ───────────────────────── */

/** AI/cache answers for typed items, kept for the session (null = asked, no confident answer). */
const QUICK_SEEN = new Map<string, AiPick | null>();

function TextPane({ mode }: { mode: "quick" | "sms" }) {
  const { rules, memory } = useApp();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const today = todayISO();

  useEffect(() => {
    const raw = mode === "quick" ? parseQuick(text, today) : parseSms(text, today);
    const prepared = prepareRows(raw, rules, { hash: mode === "sms", memory });
    setRows(prepared.map((r) => ({ ...r, include: true, dupe: false, edited: false })));
    if (mode === "quick") {
      // Words Expensly doesn't know ("kombucha 120") get a quick AI/shared-cache guess once you pause typing.
      const unsure = prepared.filter((r) => r.confidence < REVIEW_THRESHOLD && !AI_SKIP.has(r.category_id));
      if (!unsure.length) return;
      let live = true;
      const applyPicks = () => setRows((rs) => rs.map((r) => {
          const pick = QUICK_SEEN.get(merchantCacheKey(r.merchant_name));
          if (!pick || r.edited || r.confidence >= REVIEW_THRESHOLD || AI_SKIP.has(r.category_id) || r.amount_paise > 0) return r;
          return { ...r, category_id: pick.category_id, subcategory_id: pick.subcategory_id, confidence: pick.confidence >= 0.85 ? 0.8 : 0.6, reasons: [pick.from === "cache" ? "Recognised from Expensly's shared list" : "Recognised by Expensly AI"] };
        }));
      applyPicks();
      // only ask about words not asked about yet this session, so editing the text doesn't spend more AI requests
      const fresh = unsure.filter((r) => !QUICK_SEEN.has(merchantCacheKey(r.merchant_name)));
      if (!fresh.length) return;
      const t = setTimeout(async () => {
        const res = await aiSortImport(fresh.map((r) => ({ name: r.merchant_name, out: r.amount_paise < 0 }))).catch(() => null);
        if (!res || !res.ok) return;
        for (const r of fresh) { const k = merchantCacheKey(r.merchant_name); QUICK_SEEN.set(k, res.picks[k] ?? null); }
        if (live) applyPicks();
      }, 1200);
      return () => { live = false; clearTimeout(t); };
    }
    if (mode !== "sms" || !prepared.length) return;
    const t = setTimeout(async () => {
      try {
        const existing = new Set(await findExisting(prepared.map((r) => r.dedupe_hash!).filter(Boolean)));
        if (existing.size) setRows((rs) => rs.map((r) => (r.dedupe_hash && existing.has(r.dedupe_hash) ? { ...r, dupe: true, include: false } : r)));
      } catch {
        /* the database check is a nicety; adding still skips duplicates */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [text, mode, rules, memory, today]);

  return (
    <>
      <textarea
        id={`add-${mode}`}
        data-autofocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={mode === "quick" ? "chai 20, auto 60, swiggy 340, rent 12k" : "Rs.340.00 debited from A/c XX4417 on 22-10-26 to VPA swiggy@icici. UPI Ref 629184…"}
        aria-label={mode === "quick" ? "Spends to add" : "Bank SMS to read"}
      />
      <p className="hint">
        {mode === "quick"
          ? "Add several at once, separated by commas. Write 1.2k for ₹1,200 and +500 for money in."
          : "Paste one or more UPI or card alerts, with a blank line between them. Messages already in Expensly are skipped."}
      </p>
      <Preview rows={rows} setRows={setRows} />
      <Commit rows={rows} file={mode === "sms" ? { name: "Pasted SMS", kind: "sms" } : undefined} onDone={() => setText("")} />
    </>
  );
}

/* ───────────────────────── statements ───────────────────────── */

/** Kinds the rules decide better than a name ever could: transfers, income, people, investments. */
const AI_SKIP = new Set(["xfer", "income", "people", "invest"]);

function StatementPane() {
  const { rules, memory } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("");
  const [file, setFile] = useState<{ name: string; kind: "csv" | "pdf" | "text" } | null>(null);
  const [needPassword, setNeedPassword] = useState<{ file: File; wrong: boolean } | null>(null);
  const [password, setPassword] = useState("");
  const [over, setOver] = useState(false);
  const [check, setCheck] = useState<{ tone: "good" | "warn" | "none"; text: string } | null>(null);
  const [aiNote, setAiNote] = useState("");
  // The account this statement belongs to, so its balance can follow the statement.
  const [accounts, setAccounts] = useState<Awaited<ReturnType<typeof listAccounts>>>([]);
  const [closing, setClosing] = useState<{ balance_paise: number; date: string; last4: string | null } | null>(null);
  const [acct, setAcct] = useState<string>("skip"); // account id | "new" | "skip"
  const today = todayISO();
  useEffect(() => { listAccounts().then(setAccounts).catch(() => undefined); }, []);

  /** Text or CSV, or a PDF read as a table first and as lines if that fails. */
  const load = async (input: string | PdfPage[], meta: { name: string; kind: "csv" | "pdf" | "text" }) => {
    let raw: RawRow[];
    if (typeof input === "string") raw = parseStatement(input, today);
    else {
      const { parseTablePages } = await import("@/lib/ingest/table");
      const { pagesToText } = await import("@/lib/ingest/pdf");
      const table = parseTablePages(input, today);
      const lines = parseStatement(pagesToText(input), today);
      // the table reader wins unless it clearly found fewer transactions
      raw = table && table.rows.length >= lines.length * 0.8 ? table.rows : lines;
    }
    const rec = reconcile(raw);
    const end = closingBalance(rec.rows);
    const last4 = accountLast4(typeof input === "string" ? input.slice(0, 3000) : input.slice(0, 1).flat().map((r) => r.items.map((i) => i.s).join(" ")).join("\n"));
    setClosing(end ? { ...end, last4 } : null);
    if (end) {
      const match = accounts.find((a) => last4 && a.last4 === last4) ?? (accounts.filter((a) => a.type === "bank").length === 1 ? accounts.find((a) => a.type === "bank") : undefined);
      setAcct(match ? match.id : accounts.some((a) => a.type === "bank") ? "skip" : "new");
    } else setAcct("skip");
    const c = describeCheck(rec.check);
    setCheck(c.text ? c : null);
    const prepared = prepareRows(rec.rows, rules, { memory });
    setFile(meta);
    if (!prepared.length) {
      setRows([]);
      setStatus("No transactions found. Try the CSV export from netbanking, or paste the statement lines as text.");
      return;
    }
    setStatus(`Checking ${prepared.length} rows against what's already in Expensly…`);
    let existing = new Set<string>();
    try {
      existing = new Set(await findExisting(prepared.map((r) => r.dedupe_hash!)));
    } catch {
      /* preview still works without the duplicate check */
    }
    const next = prepared.map((r) => {
      const dupe = existing.has(r.dedupe_hash!);
      return { ...r, dupe, include: !dupe && !r.is_transfer, edited: false };
    });
    setRows(next);
    const d = next.filter((r) => r.dupe).length, x = next.filter((r) => r.is_transfer).length;
    setStatus(`Found ${next.length} transactions in ${meta.name}${d ? ` · ${d} already in Expensly` : ""}${x ? ` · ${x} card payment${x > 1 ? "s" : ""} left out so they don't count twice` : ""}.`);

    // Second pass: merchants the rules couldn't place go to the shared cache, then the AI.
    const unsure = next.filter((r) => !r.dupe && !r.is_transfer && r.confidence < REVIEW_THRESHOLD && !AI_SKIP.has(r.category_id));
    if (!unsure.length) return setAiNote("");
    setAiNote(`✦ Sorting ${unsure.length} unfamiliar merchant${unsure.length === 1 ? "" : "s"}…`);
    const res = await aiSortImport(unsure.map((r) => ({ name: r.merchant_name, out: r.amount_paise < 0 }))).catch(() => null);
    if (!res || !res.ok) return setAiNote("");
    const apply = (r: Row): Row => {
      const pick = res.picks[merchantCacheKey(r.merchant_name)];
      if (!pick || r.edited || r.dupe || r.is_transfer || r.confidence >= REVIEW_THRESHOLD || AI_SKIP.has(r.category_id)) return r;
      if (r.amount_paise > 0 && pick.category_id !== r.category_id) return r; // money in: keep the rules' call
      return {
        ...r,
        category_id: pick.category_id,
        subcategory_id: pick.subcategory_id,
        confidence: pick.confidence >= 0.85 ? 0.8 : 0.6,
        reasons: [pick.from === "cache" ? "Recognised from Expensly's shared merchant list" : "Recognised by Expensly AI from the name", ...(pick.confidence < 0.85 ? ["A best guess, so it's left for you to check"] : [])],
      };
    };
    const filed = next.map(apply).filter((r, k) => r !== next[k]).length;
    setRows((rs) => rs.map(apply));
    setAiNote(filed ? `✦ Sorted ${filed} more with AI${res.cached ? ` (${res.cached} already known)` : ""}. Tap a row to change it.` : "");
  };

  const handleFile = async (f: File, pw?: string) => {
    setStatus(`Reading ${f.name}…`);
    try {
      if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
        const { pdfToPages, PdfPasswordError } = await import("@/lib/ingest/pdf");
        try {
          const pages = await pdfToPages(f, pw);
          setNeedPassword(null);
          await load(pages, { name: f.name, kind: "pdf" });
        } catch (e) {
          if (e instanceof PdfPasswordError) {
            setNeedPassword({ file: f, wrong: e.wrong });
            setStatus("");
          } else throw e;
        }
      } else {
        await load(await f.text(), { name: f.name, kind: /\.csv$/i.test(f.name) ? "csv" : "text" });
      }
    } catch {
      setStatus("Couldn't read that file. Try the CSV export from netbanking, or paste the text.");
    }
  };

  return (
    <>
      <div className="note">
        <b>Using CRED?</b>CRED doesn&apos;t let other apps read its data. Import your card&apos;s monthly e-statement instead; CRED bill payments are spotted and left out so nothing counts twice.
      </div>
      <label
        className={`drop${over ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <input id="statement-file" type="file" accept=".csv,.txt,.tsv,.pdf,text/csv,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
        <b>Choose a statement</b>
        <div className="hint">CSV, PDF or text · read on this device, never uploaded</div>
      </label>
      <StatementGuide />
      {needPassword && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); handleFile(needPassword.file, password); }}>
          <label className="lbl" htmlFor="pdf-pw">THIS PDF IS PASSWORD-PROTECTED
            <div className="ask">
              <input id="pdf-pw" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Statement password" autoFocus />
              <button>Unlock</button>
            </div>
          </label>
          {needPassword.wrong && <p className="error">That password didn&apos;t work. Card statements often use the first 4 letters of your name plus your birth date as DDMM.</p>}
        </form>
      )}
      <details>
        <summary className="hint" style={{ cursor: "pointer" }}>Or paste statement text</summary>
        <textarea id="statement-text" style={{ marginTop: 8 }} placeholder="14 Oct 2026  ZOMATO  418.00 Dr" onChange={(e) => e.target.value.trim() ? load(e.target.value, { name: "pasted text", kind: "text" }) : setRows([])} />
      </details>
      {!rows.length && <button className="btn ghost" onClick={() => load(SAMPLE_STATEMENT, { name: "the sample statement", kind: "csv" })}>Try a sample card statement</button>}
      {status && <p className="hint" role="status">{status}</p>}
      {aiNote && rows.length > 0 && <p className="hint" role="status">{aiNote}</p>}
      {check && rows.length > 0 && <p className={check.tone === "warn" ? "error" : "hint good"} role="status" style={check.tone === "warn" ? { color: "var(--warn, #E8A00B)" } : undefined}>{check.text}</p>}
      <Preview rows={rows} setRows={setRows} />
      {closing && rows.length > 0 && (
        <div className="note acct-pick">
          <b>Closing balance {inr(closing.balance_paise)}{closing.balance_paise < 0 ? " overdrawn" : ""} on {shortDate(closing.date)}</b>
          <label className="lbl" htmlFor="acct-pick">UPDATE THIS ACCOUNT&apos;S BALANCE
            <select id="acct-pick" className="field" value={acct} onChange={(e) => setAcct(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.last4 ? ` ••${a.last4}` : ""} (now {inr(a.balance_paise)})</option>)}
              <option value="new">New bank account{closing.last4 ? ` ••${closing.last4}` : ""}</option>
              <option value="skip">Don&apos;t update a balance</option>
            </select>
          </label>
          <small className="hint">Your net worth on Wealth follows your real balance, with no typing.</small>
        </div>
      )}
      <Commit
        rows={rows}
        file={file ?? undefined}
        account={closing && acct !== "skip" ? (acct === "new" ? { create: { name: bankName(file?.name, closing.last4), type: "bank", last4: closing.last4 }, balance_paise: closing.balance_paise } : { id: acct, balance_paise: closing.balance_paise }) : undefined}
        onDone={() => { setRows([]); setStatus(""); setFile(null); setCheck(null); setAiNote(""); setClosing(null); listAccounts().then(setAccounts).catch(() => undefined); }}
      />
    </>
  );
}

/* ───────────────────────── shared preview & commit ───────────────────────── */

function Preview({ rows, setRows }: { rows: Row[]; setRows: React.Dispatch<React.SetStateAction<Row[]>> }) {
  const { cats, toast } = useApp();
  if (!rows.length) return null;
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  // Fixing one row fixes the others from the same payee that were filed the same way.
  const refile = (i: number, c: string, s: string | null) => {
    const target = rows[i];
    const key = isGenericName(target.merchant_name) && !vpaOf(target.merchant_raw) ? null : payeeKey(target.merchant_name, target.merchant_raw);
    const same = (r: Row, k: number) => k === i || (!!key && !r.edited && r.category_id === target.category_id && payeeKey(r.merchant_name, r.merchant_raw) === key);
    const more = rows.filter((r, k) => k !== i && same(r, k)).length;
    setRows((rs) => rs.map((r, k) => {
      if (!same(r, k)) return r;
      return { ...r, category_id: c, subcategory_id: s, edited: true, is_transfer: c === "xfer", include: c === "xfer" ? false : r.dupe ? r.include : true };
    }));
    if (more) toast(`Also moved ${more} more from ${target.merchant_name}`);
  };
  return (
    <div className="preview">
      {rows.map((r, i) => {
        const cat = cats.find((c) => c.id === r.category_id);
        const note = r.dupe ? "already in Expensly" : r.is_transfer ? "card payment, not spending" : r.confidence < REVIEW_THRESHOLD && !r.edited ? "check the category" : r.refund ? "refund" : "";
        return (
          <div key={i} className={`pv${r.include ? "" : " dim"}`}>
            <input type="checkbox" checked={r.include} onChange={(e) => set(i, { include: e.target.checked })} aria-label={`Include ${r.merchant_name}`} />
            <span className="dot" style={{ background: cat?.color ?? "var(--muted)" }} />
            <span className="nm" title={r.reasons.join(" · ")}>
              {r.merchant_name}
              <small>{shortDate(r.date)}{note ? ` · ${note}` : ""}</small>
            </span>
            <span className={`num${r.amount_paise > 0 ? " good" : ""}`}>{r.amount_paise > 0 ? "+" : "−"}{inr(r.amount_paise)}</span>
            <CategorySelect cats={cats} category={r.category_id} sub={r.subcategory_id} label={`Category for ${r.merchant_name}`} onChange={(c, s) => refile(i, c, s)} />
          </div>
        );
      })}
    </div>
  );
}

/** A sensible name for a new account from the statement's file name: "HDFC ••4417", else "Bank account". */
function bankName(fileName: string | undefined, last4: string | null) {
  const bank = (fileName ?? "").match(/\b(hdfc|sbi|icici|axis|kotak|idfc|yes|indusind|pnb|bob|canara|federal|au|rbl|union)\b/i)?.[1];
  return `${bank ? bank.toUpperCase() : "Bank account"}${last4 ? ` ••${last4}` : ""}`;
}

function Commit({ rows, file, onDone, account }: { rows: Row[]; file?: { name: string; kind: "csv" | "pdf" | "text" | "sms" }; onDone: () => void; account?: Parameters<typeof addTransactions>[0]["account"] }) {
  const { toast, closeAdd } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const chosen = useMemo(() => rows.filter((r) => r.include), [rows]);
  const busy = useRef(false);

  const submit = () => {
    if (busy.current) return;
    busy.current = true;
    setError("");
    start(async () => {
      const payload = {
        rows: chosen.map((r) => ({
          date: r.date,
          amount_paise: r.amount_paise,
          merchant_name: r.merchant_name,
          merchant_raw: r.source === "manual" ? null : r.merchant_raw.slice(0, 400),
          category_id: r.category_id,
          subcategory_id: r.subcategory_id,
          source: r.source === "shortcut" ? "sms" : r.source,
          dedupe_hash: r.dedupe_hash,
          reviewed: r.source === "manual" || r.edited || r.confidence >= REVIEW_THRESHOLD,
        })),
        file,
        account,
      };
      let res: Awaited<ReturnType<typeof addTransactions>>;
      try {
        res = await addTransactions(payload);
      } catch (e) {
        busy.current = false;
        // No connection: keep hand-typed entries on this phone and send them when it's back.
        if (!file && !account && isOfflineError(e) && enqueue(payload.rows)) {
          window.dispatchEvent(new Event("expensly:queued"));
          onDone();
          closeAdd();
          return toast(`You're offline. ${payload.rows.length === 1 ? "It's" : `All ${payload.rows.length} are`} saved on this phone and will sync when you're back online.`);
        }
        return setError(file ? "Couldn't reach Expensly. Check your connection and try again; nothing was lost." : "Couldn't reach Expensly. Try again in a moment.");
      }
      busy.current = false;
      if (!res.ok) return setError(res.error);
      onDone();
      closeAdd();
      router.refresh();
      const msg = `Added ${res.added} transaction${res.added === 1 ? "" : "s"}${res.skipped ? ` · ${res.skipped} already there` : ""}${res.accountName ? ` · ${res.accountName} balance updated` : ""}`;
      const importId = res.importId;
      toast(msg, importId && file?.kind !== "sms" ? { label: "Undo", run: async () => { await undoImport(importId); router.refresh(); toast("Import undone"); } } : undefined);
    });
  };

  if (!rows.length) return null;
  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" disabled={!chosen.length || pending} onClick={submit}>
        {pending ? "Adding…" : chosen.length ? `Add ${chosen.length} transaction${chosen.length > 1 ? "s" : ""}` : "Nothing selected"}
      </button>
    </>
  );
}
