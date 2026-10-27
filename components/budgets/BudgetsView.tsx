"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setBudget } from "@/app/actions";
import { CatIcon, CountUp, Sheet, useApp } from "@/components/app";
import { Ring } from "@/components/charts";
import Header from "@/components/Header";
import PlanTabs from "@/components/PlanTabs";
import { inr, inrCompact } from "@/lib/money";
import { monthLong, shortDate } from "@/lib/dates";
import type { Transaction } from "@/lib/types";
import { isCustomCategory, subName } from "@/lib/taxonomy";
import CategoryForm from "@/components/CategoryForm";
import AiBudgetPlan from "./AiBudgetPlan";

type Row = { id: string; name: string; color: string; spent: number; budget: number; p: number; status: "Over" | "Ahead of pace" | "On track"; own: boolean };

export default function BudgetsView(props: {
  month: string;
  pace: number;
  spentByCat: Record<string, number>;
  budgets: Record<string, number>;
  monthTx: Transaction[];
  sample: boolean;
  aiOn?: boolean;
}) {
  const { cats } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [newCat, setNewCat] = useState(false);
  const all: Row[] = cats
    .filter((c) => c.kind === "spend")
    .map((c) => {
      const spent = props.spentByCat[c.id] ?? 0, budget = props.budgets[c.id] ?? 0;
      const p = budget ? spent / budget : spent ? 2 : 0;
      const status: Row["status"] = p > 1 ? "Over" : p > props.pace + 0.12 ? "Ahead of pace" : "On track";
      return { id: c.id, name: c.name, color: c.color, spent, budget, p, status, own: isCustomCategory(c) };
    })
    .sort((a, b) => b.p - a.p);
  // Categories without a budget don't count as "over": they're listed separately with their spend.
  const rows = all.filter((r) => r.budget > 0);
  const unbudgeted = all.filter((r) => r.budget === 0).sort((a, b) => b.spent - a.spent);
  const unbudgetedSpent = unbudgeted.reduce((a, r) => a + r.spent, 0);
  const spent = rows.reduce((a, r) => a + r.spent, 0);
  const total = rows.reduce((a, r) => a + r.budget, 0);
  const count = (s: Row["status"]) => rows.filter((r) => r.status === s).length;
  const tone = (s: Row["status"]) => (s === "Over" ? "bad" : s === "Ahead of pace" ? "warn" : "good");
  const openRow = all.find((r) => r.id === open);

  return (
    <>
      <Header title="Plan" subtitle={monthLong(props.month)} sample={props.sample} />
      <PlanTabs />
      <div className="bud-layout">
      <div className="bud-side">
      <section className="card" style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <div style={{ position: "relative", flex: "none" }}>
          <Ring value={total ? spent / total : 0} color={spent > total ? "var(--bad)" : "var(--accent)"} size={96} width={11} />
          <div className="num" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontWeight: 600, fontSize: 18 }}>{total ? Math.round((spent / total) * 100) : 0}%</div>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="eyebrow">Spent of {inr(total)}</div>
          <div className="num" style={{ fontSize: 28, fontWeight: 600 }}><CountUp value={spent} /></div>
          <div className="hint">{count("Over")} over · {count("Ahead of pace")} ahead of pace · {count("On track")} on track</div>
        </div>
      <div className="bud-stats only-desktop">
          <div><span className="eyebrow">Left</span><b className="num">{inr(Math.max(0, total - spent))}</b></div>
          <div><span className="eyebrow">Even pace by today</span><b className="num">{inr(Math.round(total * props.pace))}</b></div>
          <div><span className="eyebrow">Over budget</span><b className="num">{count("Over")} of {rows.length}</b></div>
        </div>
      </section>
      {props.aiOn && (
        <div className="act-ai">
          <span>Not sure what to set? AI can suggest budgets from your last 3 months and income.</span>
          <AiBudgetPlan />
        </div>
      )}
      <div className="bud-actions">
        <button className="btn ghost sm" onClick={() => setNewCat(true)}>＋ New category</button>
        <span className="hint">{cats.filter((c) => c.user_id).length ? `${cats.filter((c) => c.user_id).length} of your own` : "Make your own, with its own budget"}</span>
      </div>
      <p className="hint only-desktop" style={{ margin: "0 4px" }}>The line on each bar marks where you&apos;d be if you spent evenly through the month. Click a category to change its budget; the new amount carries into later months.</p>
      </div>

      <section className="card bud-list" style={{ paddingBlock: 4 }}>
        {rows.map((r, idx) => (
          <button key={r.id} className="bud" onClick={() => setOpen(r.id)}>
            <div className="row" style={{ width: "100%" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800 }}><CatIcon name={r.name} color={r.color} size="sm" />{r.name}{r.own && <span className="own-badge">Yours</span>}</span>
              <span className={`chip ${tone(r.status)}`}>{r.status}</span>
            </div>
            <div className="bar">
              <i className="m-fill" style={{ width: `${Math.min(r.p, 1) * 100}%`, background: r.spent > r.budget ? "var(--bad)" : `linear-gradient(90deg, color-mix(in srgb, ${r.color} 70%, transparent), ${r.color})`, animationDelay: `${150 + idx * 70}ms` }} />
              <span className="pm" style={{ left: `${props.pace * 100}%` }} />
            </div>
            <div className="row hint" style={{ width: "100%" }}>
              <span className="num">{inr(r.spent)} of {inr(r.budget)}</span>
              <span className="num">{r.spent > r.budget ? `${inr(r.spent - r.budget)} over` : `${inr(r.budget - r.spent)} left`}</span>
            </div>
          </button>
        ))}
      </section>

      {unbudgeted.length > 0 && (
        <section className="card bud-none">
          <div className="section-h">
            <h2>No budget yet</h2>
            <span className="hint num">{unbudgetedSpent ? `${inr(unbudgetedSpent)} spent here` : `${unbudgeted.length} categories`}</span>
          </div>
          {unbudgeted.filter((r) => showAll || r.spent > 0 || r.own).map((r) => (
            <button key={r.id} className="list-row as-btn" onClick={() => setOpen(r.id)}>
              <CatIcon name={r.name} color={r.color} size="sm" />
              <span className="grow"><b>{r.name}{r.own && <span className="own-badge">Yours</span>}</b><span className="hint">{r.spent ? `${inr(r.spent)} this month` : "Nothing yet"}</span></span>
              <span className="link">Set budget</span>
            </button>
          ))}
          {unbudgeted.some((r) => !r.spent && !r.own) && (
            <button className="link" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show ${unbudgeted.filter((r) => !r.spent && !r.own).length} more`}</button>
          )}
        </section>
      )}
      </div>
      <p className="hint only-mobile" style={{ margin: "0 4px" }}>The line on each bar marks where you&apos;d be if you spent evenly through the month. Tap a category to change its budget; the new amount carries into later months.</p>

      {newCat && (
        <Sheet title="New category" onClose={() => setNewCat(false)}>
          <CategoryForm onDone={() => setNewCat(false)} onCancel={() => setNewCat(false)} />
        </Sheet>
      )}
      {openRow && <BudgetSheet row={openRow} month={props.month} tx={props.monthTx.filter((t) => t.category_id === openRow.id)} onClose={() => setOpen(null)} />}
    </>
  );
}

function BudgetSheet({ row, month, tx, onClose }: { row: Row; month: string; tx: Transaction[]; onClose: () => void }) {
  const { toast, cats } = useApp();
  const [editCat, setEditCat] = useState(false);
  const category = cats.find((c) => c.id === row.id);
  const router = useRouter();
  const [value, setValue] = useState(Math.round(row.budget / 100));
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const weeks = [[1, 7], [8, 14], [15, 21], [22, 31]].map(([a, b]) =>
    tx.filter((t) => { const d = +t.date.slice(8); return d >= a && d <= b; }).reduce((s, t) => s - t.amount_paise, 0),
  );
  const max = Math.max(1, ...weeks);
  const subs = Object.entries(
    tx.reduce<Record<string, number>>((m, t) => { const k = t.subcategory_id ?? ""; m[k] = (m[k] ?? 0) - t.amount_paise; return m; }, {}),
  ).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const subMax = Math.max(1, ...subs.map(([, v]) => v));
  const list = [...tx].sort((a, b) => b.date.localeCompare(a.date));

  const save = () =>
    start(async () => {
      const r = await setBudget(row.id, value * 100);
      if (!r.ok) return setError(r.error);
      onClose();
      router.refresh();
      toast(`${row.name} budget set to ${inr(value * 100)}`);
    });

  return (
    <Sheet title={<><span className="dot" style={{ background: row.color, width: 12, height: 12 }} />{row.name}</>} label={row.name} onClose={onClose}>
      <div className="row">
        <div><div className="eyebrow">Spent in {monthLong(month).split(" ")[0]}</div><div className="num" style={{ fontSize: 28, fontWeight: 600 }}>{inr(row.spent)}</div></div>
        <div style={{ position: "relative" }}>
          <Ring value={row.p} color={row.color} size={72} width={8} />
          <span className="num" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 600 }}>{row.budget ? Math.round(row.p * 100) : 0}%</span>
        </div>
      </div>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>By week</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, alignItems: "end", height: 96 }}>
          {weeks.map((v, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
              <span className="num hint">{v ? inrCompact(v) : "–"}</span>
              <div style={{ width: "100%", maxWidth: 44, borderRadius: 8, height: Math.max(4, (v / max) * 56), background: row.color, opacity: i === 3 ? 1 : 0.55 }} />
              <span className="hint">Week {i + 1}</span>
            </div>
          ))}
        </div>
      </div>
      {subs.length > 1 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>By type</div>
          {subs.map(([id, v], i) => (
            <div key={id} style={{ marginBottom: 8 }}>
              <div className="row hint" style={{ marginBottom: 4 }}><span>{subName(row.id, id) ?? "Other"}</span><span className="num">{inr(v)}</span></div>
              <div className="bar thin"><i className="m-fill" style={{ width: `${(v / subMax) * 100}%`, background: row.color, opacity: 1 - i * 0.15, animationDelay: `${i * 60}ms` }} /></div>
            </div>
          ))}
        </div>
      )}
      {row.own && category && (editCat ? (
        <div className="cat-form inline">
          <CategoryForm category={category} onDone={() => { setEditCat(false); onClose(); }} />
          <button className="link" onClick={() => setEditCat(false)}>Close</button>
        </div>
      ) : (
        <button className="link" style={{ alignSelf: "flex-start" }} onClick={() => setEditCat(true)}>Rename, recolour or delete this category</button>
      ))}
      <label className="lbl" htmlFor="budget-range">
        MONTHLY BUDGET · <span className="num" style={{ color: "var(--fg)" }}>{inr(value * 100)}</span>
        <input id="budget-range" type="range" min={0} max={Math.max(30000, value, Math.ceil((Math.max(row.budget, row.spent) / 100) * 2 / 1000) * 1000)} step={250} value={value} onChange={(e) => setValue(+e.target.value)} />
      </label>
      <div className="budget-type">
        <label className="lbl" htmlFor="budget-exact" style={{ flex: 1 }}>OR TYPE AN EXACT AMOUNT (₹)
          <input id="budget-exact" className="field num" inputMode="numeric" value={value || ""} placeholder="0 = no budget" onChange={(e) => setValue(Math.min(1e9, Math.max(0, parseInt(e.target.value.replace(/[^0-9]/g, ""), 10) || 0)))} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn" disabled={pending || value * 100 === row.budget} onClick={save}>{pending ? "Saving…" : "Save budget"}</button>
      <div>
        <div className="row" style={{ marginBottom: 4 }}>
          <span className="eyebrow">{list.length} transaction{list.length === 1 ? "" : "s"}</span>
          <Link className="link" href={`/activity?cat=${row.id}`} onClick={onClose}>See all</Link>
        </div>
        {list.slice(0, 8).map((t) => (
          <div key={t.id} className="list-row">
            <div className="grow"><b className="ellipsis">{t.merchant_name}</b><small className="muted">{shortDate(t.date)}</small></div>
            <b className="num">{t.amount_paise > 0 ? "+" : ""}{inr(t.amount_paise)}</b>
          </div>
        ))}
        {!list.length && <p className="empty">No spending here yet this month.</p>}
      </div>
    </Sheet>
  );
}
