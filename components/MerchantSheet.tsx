"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateMerchant } from "@/app/actions";
import { Sheet, useApp } from "@/components/app";
import { SubPicker } from "@/components/CategoryPicker";
import { CategoryPickerWithNew } from "@/components/CategoryForm";
import { merchantProfile } from "@/lib/analytics";
import { addMonths, monthShort, monthStart, shortDate, todayISO } from "@/lib/dates";
import { inr } from "@/lib/money";
import { fullCategoryName } from "@/lib/taxonomy";
import type { Transaction } from "@/lib/types";

/** Everything about one merchant, with one-tap rename and re-file for all of its transactions. */
export default function MerchantSheet({ name, tx, onClose }: { name: string; tx: Transaction[]; onClose: () => void }) {
  const { cats, toast } = useApp();
  const router = useRouter();
  const p = useMemo(() => merchantProfile(tx, name), [tx, name]);
  const latest = p.rows[0];
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [rename, setRename] = useState(name);
  const [cat, setCat] = useState(latest?.category_id ?? "shop");
  const [sub, setSub] = useState<string | null>(latest?.subcategory_id ?? null);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  const cur = monthStart(todayISO());
  const months = Array.from({ length: 6 }, (_, i) => addMonths(cur, i - 5));
  const byMonth = months.map((m) => -p.rows.filter((t) => t.date.startsWith(m.slice(0, 7)) && t.amount_paise < 0).reduce((s, t) => s + t.amount_paise, 0));
  const peak = Math.max(1, ...byMonth);

  const save = () => {
    setError("");
    start(async () => {
      const r = await updateMerchant(name, { rename_to: rename.trim() !== name ? rename.trim() : undefined, category_id: cat, subcategory_id: sub });
      if (!r.ok) return setError(r.error);
      onClose();
      router.refresh();
      toast(`Updated ${r.changed} transaction${r.changed === 1 ? "" : "s"}. New ones will follow.`);
    });
  };

  return (
    <Sheet title={name} onClose={onClose}>
      {latest && <p className="hint" style={{ marginTop: -6 }}>{fullCategoryName(latest.category_id, latest.subcategory_id, cats.find((c) => c.id === latest.category_id)?.name)}</p>}
      <div className="mstats">
        <div><span className="eyebrow">Spent</span><b className="num">{inr(p.total)}</b><small>{p.count} payment{p.count === 1 ? "" : "s"}</small></div>
        <div><span className="eyebrow">Typical</span><b className="num">{inr(p.median)}</b><small>avg {inr(p.avg)}</small></div>
        <div><span className="eyebrow">How often</span><b>{p.everyDays ? (p.everyDays <= 1 ? "Daily" : `Every ${p.everyDays} days`) : "Once"}</b><small>{p.weekday ? `Mostly ${p.weekday}s` : p.first ? `Since ${shortDate(p.first)}` : ""}</small></div>
      </div>
      <div className="mbars" role="img" aria-label={`Monthly spend at ${name}: ${byMonth.map((v, i) => `${monthShort(months[i])} ${inr(v)}`).join(", ")}`}>
        {byMonth.map((v, i) => (
          <div key={months[i]} className="mbar">
            <i className="m-grow" style={{ height: `${Math.max(v ? 6 : 2, (v / peak) * 100)}%`, animationDelay: `${i * 50}ms`, opacity: i === 5 ? 1 : 0.55 }} />
            <span>{monthShort(months[i])}</span>
          </div>
        ))}
      </div>
      {p.refunds > 0 && <p className="hint">{inr(p.refunds)} came back as refunds.</p>}
      {p.largest && <p className="hint">Largest: {inr(-p.largest.amount_paise)} on {shortDate(p.largest.date)}.</p>}

      {mode === "view" ? (
        <>
          <div className="mlist">
            {p.rows.slice(0, 8).map((t) => (
              <div key={t.id} className="list-row">
                <span className="grow"><b className="num" style={{ fontWeight: 600 }}>{shortDate(t.date)}</b><span className="hint">{t.note ?? (t.amount_paise > 0 ? "Refund" : "")}</span></span>
                <span className={`num${t.amount_paise > 0 ? " good" : ""}`}>{t.amount_paise > 0 ? "+" : "−"}{inr(Math.abs(t.amount_paise))}</span>
              </div>
            ))}
          </div>
          <div className="btns">
            <Link className="btn ghost" href={`/activity?q=${encodeURIComponent(name)}`} onClick={onClose}>All {p.rows.length}</Link>
            <Link className="btn ghost" href={`/ask?q=${encodeURIComponent(`Analyse my spending at ${name}. Is it worth cutting back, and by how much?`)}`} onClick={onClose}>✦ Ask AI</Link>
            <button className="btn" onClick={() => setMode("edit")}>Rename or re-file</button>
          </div>
        </>
      ) : (
        <>
          <label className="lbl" htmlFor="m-name">NAME FOR ALL OF THEM<input id="m-name" className="field" value={rename} onChange={(e) => setRename(e.target.value)} maxLength={80} /></label>
          <div className="lbl">CATEGORY</div>
          <CategoryPickerWithNew value={cat} onChange={(c) => { setCat(c); setSub(null); }} />
          <SubPicker category={cat} value={sub} onChange={setSub} />
          <p className="hint">Changes all {p.rows.length} transactions and every future one from {name}.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="btns">
            <button className="btn ghost" onClick={() => setMode("view")}>Back</button>
            <button className="btn" disabled={pending} onClick={save}>{pending ? "Saving…" : "Apply to all"}</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
