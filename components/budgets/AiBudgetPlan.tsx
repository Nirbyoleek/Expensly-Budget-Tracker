"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyBudgets, suggestBudgets, type BudgetSuggestion } from "@/app/ai-actions";
import { Sheet, useApp } from "@/components/app";
import { inr } from "@/lib/money";

/** "Plan with AI": budgets proposed from the last 3 months and your income. Review, tweak, apply. */
export default function AiBudgetPlan() {
  const { toast } = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [items, setItems] = useState<(BudgetSuggestion & { keep: boolean })[] | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const run = () => {
    setOpen(true);
    setItems(null);
    setError("");
    start(async () => {
      const r = await suggestBudgets();
      if (!r.ok) return setError(r.error);
      setSummary(r.summary);
      setItems(r.items.map((i) => ({ ...i, keep: i.suggested !== i.current })));
    });
  };

  const apply = () =>
    start(async () => {
      const chosen = (items ?? []).filter((i) => i.keep);
      const r = await applyBudgets(chosen.map((i) => ({ category_id: i.category_id, limit_paise: i.suggested })));
      if (!r.ok) return setError(r.error);
      setOpen(false);
      router.refresh();
      toast(`Updated ${r.changed} budget${r.changed === 1 ? "" : "s"}. They carry into next month.`);
    });

  const total = (k: "current" | "suggested") => (items ?? []).reduce((s, i) => s + (k === "suggested" && !i.keep ? i.current : i[k]), 0);

  return (
    <>
      <button className="ai-btn" onClick={run}><span aria-hidden="true">✦</span> Plan with AI</button>
      {open && (
        <Sheet title="AI budget plan" onClose={() => setOpen(false)}>
          {error ? (
            <p className="error" role="alert">{error}</p>
          ) : !items ? (
            <div className="brief-loading"><span className="shimmer-text">Looking at your last 3 months and income…</span><i /><i /><i /></div>
          ) : (
            <>
              {summary && <p className="brief-headline" style={{ fontSize: 15 }}>{summary}</p>}
              <div className="plan-head hint"><span>Category</span><span>Avg</span><span>Now</span><span>Plan</span></div>
              <div className="sugg-list">
                {items.map((s, i) => {
                  const diff = s.suggested - s.current;
                  return (
                    <label key={s.category_id} className={`plan-row${s.keep ? "" : " off"}`}>
                      <span className="grow">
                        <span className="row" style={{ justifyContent: "flex-start", gap: 8 }}>
                          <input type="checkbox" checked={s.keep} onChange={(e) => setItems((xs) => xs!.map((x, k) => (k === i ? { ...x, keep: e.target.checked } : x)))} />
                          <b className="ellipsis">{s.name}</b>
                        </span>
                        {s.why && <span className="hint">{s.why}</span>}
                      </span>
                      <span className="num hint">{inr(s.avg)}</span>
                      <span className="num hint">{s.current ? inr(s.current) : "—"}</span>
                      <span className={`num ${diff < 0 ? "good" : diff > 0 ? "warn-text" : ""}`}><b>{inr(s.suggested)}</b></span>
                    </label>
                  );
                })}
              </div>
              <div className="row hint"><span>Total</span><span className="num">{inr(total("current"))} → <b style={{ color: "var(--fg)" }}>{inr(total("suggested"))}</b></span></div>
              <div className="btns">
                <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button className="btn" disabled={pending || !items.some((i) => i.keep)} onClick={apply}>{pending ? "Saving…" : `Apply ${items.filter((i) => i.keep).length}`}</button>
              </div>
            </>
          )}
        </Sheet>
      )}
    </>
  );
}
