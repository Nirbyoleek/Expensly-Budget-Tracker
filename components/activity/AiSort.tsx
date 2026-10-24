"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyCategorySuggestions, suggestCategories, type CatSuggestion } from "@/app/ai-actions";
import { Sheet, useApp } from "@/components/app";
import { inr } from "@/lib/money";
import { shortDate } from "@/lib/dates";

/** "Sort with AI": the AI proposes categories for transactions the rules weren't sure about. You pick which to keep. */
export default function AiSort() {
  const { toast, celebrate } = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<(CatSuggestion & { keep: boolean })[] | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const run = () => {
    setOpen(true);
    setItems(null);
    setError("");
    start(async () => {
      const r = await suggestCategories();
      if (!r.ok) return setError(r.error);
      setItems(r.suggestions.map((s) => ({ ...s, keep: true })));
      setNote(r.looked ? `Looked at ${r.looked} unsure transaction${r.looked === 1 ? "" : "s"}.` : "Nothing needs sorting: every transaction has a confident category.");
    });
  };

  const apply = () =>
    start(async () => {
      const chosen = (items ?? []).filter((i) => i.keep);
      const r = await applyCategorySuggestions(chosen.map((i) => ({ id: i.id, category_id: i.category_id, subcategory_id: i.subcategory_id })));
      if (!r.ok) return setError(r.error);
      setOpen(false);
      router.refresh();
      celebrate();
      toast(`Re-filed ${r.changed} transaction${r.changed === 1 ? "" : "s"}. Expensly will remember these merchants.`);
    });

  const kept = items?.filter((i) => i.keep).length ?? 0;

  return (
    <>
      <button className="ai-btn" onClick={run}><span aria-hidden="true">✦</span> Sort with AI</button>
      {open && (
        <Sheet title="Sort with AI" onClose={() => setOpen(false)}>
          {error ? (
            <p className="error" role="alert">{error}</p>
          ) : !items ? (
            <div className="brief-loading"><span className="shimmer-text">Reading merchant names and bank text…</span><i /><i /><i /></div>
          ) : (
            <>
              <p className="hint">{note}{items.length ? ` ${items.length} could go somewhere better. Untick any you disagree with.` : ""}</p>
              <div className="sugg-list">
                {items.map((s, i) => (
                  <label key={s.id} className={`sugg-row${s.keep ? "" : " off"}`}>
                    <input type="checkbox" checked={s.keep} onChange={(e) => setItems((xs) => xs!.map((x, k) => (k === i ? { ...x, keep: e.target.checked } : x)))} />
                    <span className="grow">
                      <b className="ellipsis">{s.merchant}</b>
                      <span className="hint">{shortDate(s.date)} · {inr(Math.abs(s.amount))}</span>
                      <span className="move"><s>{s.from}</s> → <b>{s.to}</b></span>
                      {s.why && <span className="hint">{s.why}</span>}
                    </span>
                  </label>
                ))}
              </div>
              {items.length > 0 && (
                <div className="btns">
                  <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
                  <button className="btn" disabled={pending || !kept} onClick={apply}>{pending ? "Saving…" : `Apply ${kept}`}</button>
                </div>
              )}
            </>
          )}
        </Sheet>
      )}
    </>
  );
}
