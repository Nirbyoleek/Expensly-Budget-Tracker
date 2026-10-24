"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTransaction, setReviewed } from "@/app/actions";
import { CatIcon, useApp } from "@/components/app";
import Header from "@/components/Header";
import { payeeKey } from "@/lib/ingest/classify";
import TxSheet from "./TxSheet";
import MerchantSheet from "@/components/MerchantSheet";
import AiSort from "./AiSort";
import { matches, parseQuery } from "@/lib/search";
import { TAXONOMY_BY_ID, subName } from "@/lib/taxonomy";
import { inr, inrCompact, inrSigned } from "@/lib/money";
import { longDate, monthLong, shortDate } from "@/lib/dates";
import type { Transaction } from "@/lib/types";

const SOURCE_LABEL: Record<string, string> = { import: "Statement", sms: "SMS", shortcut: "Shortcut" };
/** Transactions per page: enough to scan a busy week, short enough to never feel endless. */
const PAGE = 40;
/** Up to five page numbers around the current one. */
const pageWindow = (page: number, pages: number) => {
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  return Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
};

export default function ActivityView({ tx, initial, aiOn, allMonths = [] }: { tx: Transaction[]; initial: { filter?: string; day?: string; q?: string; sub?: string; month?: string }; aiOn?: boolean; allMonths?: string[] }) {
  const { cats, toast, openAdd, celebrate } = useApp();
  const router = useRouter();
  const [filter, setFilter] = useState(initial.filter ?? "all");
  const [day, setDay] = useState(initial.day ?? "");
  const [q, setQ] = useState(initial.q ?? "");
  const [sub, setSub] = useState(initial.sub ?? "");
  // Months with transactions, newest first. The view opens on the newest (or the day you came from).
  // Older months beyond what's loaded come from the server when picked.
  const loaded = useMemo(() => new Set(tx.map((t) => t.date.slice(0, 7))), [tx]);
  const months = useMemo(() => [...new Set([...loaded, ...allMonths])].sort().reverse(), [loaded, allMonths]);
  const [month, setMonthState] = useState<string>(initial.month ?? initial.day?.slice(0, 7) ?? months[0] ?? "all");
  const setMonth = (m: string) => {
    setMonthState(m);
    if (m !== "all" && !loaded.has(m)) router.push(`/activity?month=${m}`, { scroll: false });
  };
  const [pageState, setPageState] = useState({ key: "", page: 1 });
  const listTop = useRef<HTMLDivElement>(null);
  const [merchant, setMerchant] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; confirmDelete?: boolean } | null>(null);
  const [, start] = useTransition();
  const pendingDeletes = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const catById = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c])), [cats]);
  const rows = useMemo(() => tx.filter((t) => !hidden.has(t.id)).map((t) => (approved.has(t.id) ? { ...t, reviewed: true } : t)), [tx, hidden, approved]);
  const toReview = rows.filter((t) => !t.reviewed).length;

  // Searching and reviewing look across every month; browsing goes a month at a time.
  const searching = !!q.trim();
  const scope = searching || filter === "review" || filter === "uncat" ? "all" : month;

  const list = useMemo(() => {
    let l = scope === "all" ? rows : rows.filter((t) => t.date.startsWith(scope));
    if (filter === "review") l = l.filter((t) => !t.reviewed);
    else if (filter === "income") l = l.filter((t) => t.amount_paise > 0 && t.category_id === "income");
    else if (filter === "in") l = l.filter((t) => t.amount_paise > 0);
    else if (filter === "out") l = l.filter((t) => t.amount_paise < 0);
    else if (filter !== "all") l = l.filter((t) => t.category_id === filter);
    if (sub) l = l.filter((t) => t.subcategory_id === sub);
    if (day) l = l.filter((t) => t.date === day);
    if (q.trim()) {
      const query = parseQuery(q);
      l = l.filter((t) => matches(t, query));
    }
    return l;
  }, [rows, filter, sub, day, q, scope]);

  // Back to page 1 whenever what's being shown changes.
  const pageKey = `${scope}|${filter}|${sub}|${day}|${q}`;
  const page = pageState.key === pageKey ? pageState.page : 1;
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const shown = list.slice((page - 1) * PAGE, page * PAGE);
  const goPage = (p: number) => {
    setPageState({ key: pageKey, page: Math.min(pages, Math.max(1, p)) });
    listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const monthIdx = months.indexOf(month);
  const stepMonth = (d: number) => { const m = months[monthIdx + d]; if (m) { setMonth(m); setDay(""); } };

  const totals = useMemo(
    () => list.reduce((a, t) => (t.category_id === "xfer" ? a : t.amount_paise < 0 ? { ...a, out: a.out - t.amount_paise } : { ...a, in: a.in + t.amount_paise }), { out: 0, in: 0 }),
    [list],
  );

  // This page's rows by day; a month heading appears whenever the month changes (search, all months).
  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const t of shown) m.set(t.date, [...(m.get(t.date) ?? []), t]);
    return [...m.entries()];
  }, [shown]);
  const monthTotals = useMemo(() => {
    const out = new Map<string, number>();
    for (const t of list) if (t.category_id !== "xfer" && t.amount_paise < 0) out.set(t.date.slice(0, 7), (out.get(t.date.slice(0, 7)) ?? 0) - t.amount_paise);
    return out;
  }, [list]);

  // Uncategorised rows can't just be approved: they stay in review until they get a category.
  const approve = (all: string[]) => {
    const uncat = new Set(rows.filter((t) => t.category_id === "uncat").map((t) => t.id));
    const ids = all.filter((id) => !uncat.has(id));
    const skipped = all.length - ids.length;
    if (!ids.length) {
      if (all.length === 1) { setEditing({ id: all[0] }); toast("Pick a category for this one first."); }
      else if (skipped) toast(`${skipped} uncategorised transaction${skipped === 1 ? " needs" : "s need"} a category. Tap each to choose one.`);
      return;
    }
    if (skipped) toast(`Approved ${ids.length}. ${skipped} uncategorised still need${skipped === 1 ? "s" : ""} a category.`);
    const left = rows.filter((t) => !t.reviewed && !ids.includes(t.id)).length;
    if (toReview > 0 && left === 0) {
      celebrate();
      toast("All caught up. Every transaction is reviewed.");
    }
    setApproved((s) => new Set([...s, ...ids]));
    start(async () => {
      const r = await setReviewed(ids, true);
      if (!r.ok) toast(r.error);
      router.refresh();
    });
  };

  /** Hide now, delete after the undo window closes. */
  const remove = (t: Transaction) => {
    setHidden((s) => new Set(s).add(t.id));
    const timer = setTimeout(async () => {
      pendingDeletes.current.delete(t.id);
      const r = await deleteTransaction(t.id);
      if (!r.ok) {
        toast(r.error);
        setHidden((s) => { const n = new Set(s); n.delete(t.id); return n; });
      }
      router.refresh();
    }, 5000);
    pendingDeletes.current.set(t.id, timer);
    toast(`Deleted ${t.merchant_name}`, {
      label: "Undo",
      run: () => {
        clearTimeout(pendingDeletes.current.get(t.id));
        pendingDeletes.current.delete(t.id);
        setHidden((s) => { const n = new Set(s); n.delete(t.id); return n; });
      },
    });
  };

  const fb = (key: string, label: string, color?: string) => (
    <button key={key} className="fbtn" aria-pressed={filter === key} onClick={() => { setFilter(key); setSub(""); }}>
      {color && <span className="dot" style={{ background: color }} />}
      {label}
    </button>
  );

  const editTx = editing ? rows.find((t) => t.id === editing.id) : undefined;

  return (
    <>
      <Header title="Activity" sample={tx.some((t) => t.source === "sample")} />
      <div className="act-layout">
      <aside className="act-side">
        <input id="search" className="search" type="search" placeholder="Search · try “swiggy >300”" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
        <div className="act-summary only-desktop">
          <div><span className="eyebrow">{scope === "all" ? "Showing" : monthLong(`${scope}-01`).split(" ")[0]}</span><b className="num">{list.length}</b></div>
          <div><span className="eyebrow">Out</span><b className="num">{inrCompact(totals.out)}</b></div>
          <div><span className="eyebrow">In</span><b className="num good">{inrCompact(totals.in)}</b></div>
        </div>
        <div className="filters">
          {day && <button className="fbtn" aria-pressed="true" onClick={() => setDay("")}>{shortDate(day)} ✕</button>}
          {fb("all", "All")}
          {fb("review", `To review · ${toReview}`)}
          {rows.some((t) => t.category_id === "uncat") && fb("uncat", `Uncategorised · ${rows.filter((t) => t.category_id === "uncat").length}`, catById.uncat?.color)}
          {fb("in", "Money in", "var(--good)")}
          {fb("out", "Money out")}
          {fb("income", "Income", catById.income?.color)}
          {cats.filter((c) => (c.kind === "spend" && c.id !== "uncat") || c.id === "xfer").map((c) => fb(c.id, c.name, c.color))}
        </div>
        {TAXONOMY_BY_ID[filter]?.subs.length ? (
          <div className="subchips" role="radiogroup" aria-label="Narrow down">
            {TAXONOMY_BY_ID[filter].subs.filter((s) => rows.some((t) => t.category_id === filter && t.subcategory_id === s.id)).map((s) => (
              <button key={s.id} role="radio" aria-checked={sub === s.id} className={sub === s.id ? "on" : ""} style={{ ["--c" as string]: TAXONOMY_BY_ID[filter].color }} onClick={() => setSub(sub === s.id ? "" : s.id)}>{s.name}</button>
            ))}
          </div>
        ) : null}
        {aiOn && toReview > 0 && (
          <div className="act-ai">
            <span>{toReview} to review. Let AI file the unsure ones.</span>
            <AiSort />
          </div>
        )}
        <div className="row act-hint">
          <span className="hint only-mobile">Swipe right to approve · left to delete · tap to edit</span>
          <span className="hint only-desktop">Click a row to edit · drag sideways to approve or delete</span>
          {filter === "review" && toReview > 0 ? (
            <button className="link" onClick={() => approve(rows.filter((t) => !t.reviewed).map((t) => t.id))}>Approve all</button>
          ) : (
            <button className="link" onClick={() => openAdd("statement")}>Import</button>
          )}
        </div>
      </aside>

      <div className="act-main">
      <div ref={listTop} className="act-monthbar">
        {scope === "all" ? (
          <div className="act-month-title">
            <b>{searching ? "Search results" : filter === "review" ? "To review" : filter === "uncat" ? "Uncategorised" : "All months"}</b>
            <small>{searching || filter === "review" || filter === "uncat" ? "across every month" : `${months.length} months`}</small>
            {!searching && filter !== "review" && filter !== "uncat" && months[0] && <button className="link" onClick={() => setMonth(months[0])}>By month</button>}
          </div>
        ) : (
          <>
            <button className="icon-btn" onClick={() => stepMonth(1)} disabled={monthIdx >= months.length - 1} aria-label="Previous month">‹</button>
            <div className="act-month-title">
              <b className="cal-title-text">{monthLong(`${month}-01`)} ▾</b>
              <small>{list.length} transaction{list.length === 1 ? "" : "s"} · {inr(totals.out)} out · <span className="good">{inr(totals.in)} in</span></small>
              <select aria-label="Choose month" value={month} onChange={(e) => { setMonth(e.target.value); setDay(""); }}>
                {months.map((m) => <option key={m} value={m}>{monthLong(`${m}-01`)}</option>)}
                <option value="all">All months</option>
              </select>
            </div>
            <button className="icon-btn" onClick={() => stepMonth(-1)} disabled={monthIdx <= 0} aria-label="Next month">›</button>
          </>
        )}
      </div>
      <section className="card" style={{ padding: "4px 10px 10px" }}>
        {groups.length ? (
          groups.map(([date, items], gi) => {
            const net = items.reduce((a, t) => a + (t.category_id === "xfer" ? 0 : t.amount_paise), 0);
            const prev = groups[gi - 1]?.[0];
            const newMonth = scope === "all" && (!prev || prev.slice(0, 7) !== date.slice(0, 7));
            return (
              <div key={date} className="m-rise" style={{ animationDelay: `${Math.min(gi, 8) * 45}ms` }}>
                {newMonth && (
                  <div className="monthlabel">
                    <span>{monthLong(`${date.slice(0, 7)}-01`)}</span>
                    <span className="num">{inr(monthTotals.get(date.slice(0, 7)) ?? 0)} out</span>
                  </div>
                )}
                <div className="daylabel"><span>{longDate(date)}</span><span className="num">{net ? inrSigned(net) : "₹0"}</span></div>
                {items.map((t) => (
                  <SwipeRow key={t.id} onApprove={() => !t.reviewed && approve([t.id])} onDelete={() => remove(t)} onOpen={() => setEditing({ id: t.id })}>
                    <CatIcon name={t.merchant_name} color={catById[t.category_id]?.color ?? "var(--muted)"} />
                    <div className="mid">
                      <b>{t.merchant_name}</b>
                      <small>
                        {subName(t.category_id, t.subcategory_id) ?? catById[t.category_id]?.name ?? t.category_id}
                        {t.amount_paise > 0 && t.category_id !== "income" && t.category_id !== "xfer" && <span className="src">{t.category_id === "people" ? "Payback" : t.category_id === "invest" ? "Redeemed" : "Refund"}</span>}
                        {SOURCE_LABEL[t.source] && <span className="src">{SOURCE_LABEL[t.source]}</span>}
                      </small>
                    </div>
                    {!t.reviewed && <span className="review" title="Needs review" />}
                    {!t.reviewed && (
                      <button
                        className={`row-approve${t.category_id === "uncat" ? " pick" : ""}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onPointerUp={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); if (t.category_id === "uncat") setEditing({ id: t.id }); else approve([t.id]); }}
                      >
                        {t.category_id === "uncat" ? "Choose category" : "✓ Approve"}
                      </button>
                    )}
                    <div className={`amt num${t.amount_paise > 0 ? " in" : ""}`}>{t.amount_paise > 0 ? "+" : "−"}{inr(t.amount_paise)}</div>
                  </SwipeRow>
                ))}
              </div>
            );
          })
        ) : (
          <div className="empty">{scope !== "all" && !loaded.has(scope) ? `Loading ${monthLong(`${scope}-01`)}…` : tx.length ? (scope === "all" ? "Nothing matches. Clear the search or pick another filter." : `Nothing here for ${monthLong(`${scope}-01`)}. Try another month or filter.`) : "No transactions yet. Tap + to add your first."}</div>
        )}
        {pages > 1 && (
          <nav className="pager" aria-label="Pages">
            <button className="btn ghost sm" disabled={page <= 1} onClick={() => goPage(page - 1)}>‹ Newer</button>
            <span className="hint">
              {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, list.length)} of {list.length}
              <span className="pager-dots">{pageWindow(page, pages).map((p) => (
                <button key={p} className={p === page ? "on" : ""} aria-current={p === page ? "page" : undefined} onClick={() => goPage(p)} aria-label={`Page ${p}`}>{p}</button>
              ))}</span>
            </span>
            <button className="btn ghost sm" disabled={page >= pages} onClick={() => goPage(page + 1)}>Older ›</button>
          </nav>
        )}
      </section>
      </div>
      </div>

      {editTx && <TxSheet tx={editTx} similar={rows.filter((t) => t.id !== editTx.id && t.category_id === editTx.category_id && payeeKey(t.merchant_name, t.merchant_raw) === payeeKey(editTx.merchant_name, editTx.merchant_raw)).length} startWithDelete={editing?.confirmDelete} onClose={() => setEditing(null)} onDelete={() => { setEditing(null); remove(editTx); }} onMerchant={() => { setEditing(null); setMerchant(editTx.merchant_name); }} />}
      {merchant && <MerchantSheet name={merchant} tx={tx} onClose={() => setMerchant(null)} />}
    </>
  );
}

function SwipeRow({ children, onApprove, onDelete, onOpen }: { children: React.ReactNode; onApprove: () => void; onDelete: () => void; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const g = useRef({ x: 0, y: 0, dx: 0, mode: "" as "" | "swipe" | "scroll", down: false });
  const wrap = useRef<HTMLDivElement>(null);
  // Only the action on the side being uncovered shows: green to approve, red to delete.
  const set = (dx: number) => {
    if (ref.current) ref.current.style.transform = dx ? `translateX(${dx}px)` : "";
    const w = wrap.current;
    if (!w) return;
    if (dx > 0) w.dataset.dir = "approve"; else if (dx < 0) w.dataset.dir = "delete"; else delete w.dataset.dir;
    w.toggleAttribute("data-armed", Math.abs(dx) > 90);
  };

  return (
    <div className="swipe" ref={wrap}>
      <div className="act l">✓ Reviewed</div>
      <div className="act r">Delete</div>
      <div
        ref={ref}
        className="tx"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
        onPointerDown={(e) => { g.current = { x: e.clientX, y: e.clientY, dx: 0, mode: "", down: true }; }}
        onPointerMove={(e) => {
          const s = g.current;
          if (!s.down) return;
          const x = e.clientX - s.x, y = e.clientY - s.y;
          if (!s.mode) {
            if (Math.abs(x) > 8 && Math.abs(x) > Math.abs(y)) { s.mode = "swipe"; ref.current?.classList.add("drag"); try { ref.current?.setPointerCapture(e.pointerId); } catch {} }
            else if (Math.abs(y) > 8) s.mode = "scroll";
          }
          if (s.mode === "swipe") { s.dx = Math.max(-140, Math.min(140, x)); set(s.dx); }
        }}
        onPointerUp={() => {
          const s = g.current;
          if (!s.down) return;
          s.down = false;
          ref.current?.classList.remove("drag");
          if (s.mode === "swipe") {
            set(0);
            if (s.dx > 90) setTimeout(onApprove, 150);
            else if (s.dx < -90) setTimeout(onDelete, 150);
          } else if (!s.mode) onOpen();
        }}
        onPointerCancel={() => { g.current.down = false; ref.current?.classList.remove("drag"); set(0); }}
      >
        {children}
      </div>
    </div>
  );
}
