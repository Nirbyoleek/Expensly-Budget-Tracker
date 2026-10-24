"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCategory, deleteCategory, updateCategory } from "@/app/actions";
import { CategoryGrid, useApp } from "@/components/app";
import { toPaise } from "@/lib/money";
import type { Category } from "@/lib/types";

export const CATEGORY_COLORS = ["#F2683C", "#E8A00B", "#2FB673", "#12B5B0", "#3B8BF6", "#7D8EFF", "#C25BE0", "#E8508A", "#94A3B8", "#8B6B4A"];
const GROUPS = [
  ["needs", "Need", "Rent, school fees, medicine"],
  ["wants", "Want", "Hobbies, gifts, eating out"],
  ["avoidable", "Avoidable", "Things you'd like to cut"],
] as const;
type Grp = (typeof GROUPS)[number][0];

/**
 * Make or edit one of your own spending categories. Shown inside a sheet: on Budgets it's the
 * whole sheet, when sorting a transaction it opens under the category chips.
 */
export default function CategoryForm({ category, withBudget = true, onDone, onCancel }: {
  category?: Category;
  withBudget?: boolean;
  onDone: (id: string, name: string, color: string) => void;
  onCancel?: () => void;
}) {
  const { toast, cats } = useApp();
  const router = useRouter();
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[(cats.filter((c) => c.user_id).length + 5) % CATEGORY_COLORS.length]);
  const [grp, setGrp] = useState<Grp>(category?.grp ?? "wants");
  const [budget, setBudget] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [moveTo, setMoveTo] = useState("uncat");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const save = () => start(async () => {
    setError("");
    const amount = toPaise(parseFloat(budget.replace(/,/g, "")) || 0);
    let id: string;
    if (category) {
      const r = await updateCategory(category.id, { name, color, grp });
      if (!r.ok) return setError(r.error);
      id = category.id;
    } else {
      const r = await createCategory({ name, color, grp, budget_paise: withBudget ? amount : 0 });
      if (!r.ok) return setError(r.error);
      id = r.id;
    }
    router.refresh();
    toast(category ? `${name.trim()} updated` : `${name.trim()} added${withBudget && amount ? " with a monthly budget" : ""}`);
    onDone(id, name.trim(), color);
  });

  const remove = () => start(async () => {
    if (!category) return;
    const r = await deleteCategory(category.id, moveTo);
    if (!r.ok) return setError(r.error);
    router.refresh();
    const to = cats.find((c) => c.id === moveTo)?.name ?? "Uncategorised";
    toast(`${category.name} deleted${r.moved ? ` · ${r.moved} transaction${r.moved === 1 ? "" : "s"} moved to ${to}` : ""}`);
    onDone(moveTo, to, cats.find((c) => c.id === moveTo)?.color ?? "#9CA3AF");
  });

  return (
    <div className="stack cat-form">
      <label className="lbl" htmlFor="cat-name">NAME
        <input id="cat-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pet care, Gym, Kids" maxLength={40} autoComplete="off" />
      </label>

      <div className="lbl">COLOUR</div>
      <div className="swatches" role="radiogroup" aria-label="Colour">
        {CATEGORY_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={`Colour ${c}`} className={c === color ? "on" : ""} style={{ background: c }} onClick={() => setColor(c)} />
        ))}
      </div>

      <div className="lbl">IT&apos;S A…</div>
      <div className="seg">
        {GROUPS.map(([k, l]) => <button key={k} type="button" aria-pressed={grp === k} onClick={() => setGrp(k)}>{l}</button>)}
      </div>
      <p className="hint">{GROUPS.find((g) => g[0] === grp)![2]}. This decides where it counts in your needs-vs-wants split on Insights.</p>

      {!category && withBudget && (
        <label className="lbl" htmlFor="cat-budget">MONTHLY BUDGET (₹, OPTIONAL)
          <input id="cat-budget" className="field num" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No budget" />
        </label>
      )}

      {!category && <p className="hint">Tip: when you move a transaction here, choose “apply to all” and future ones from the same place land here automatically.</p>}

      {confirm && category && (
        <div className="note danger stack">
          <b>Delete {category.name}?</b>
          <span>Its transactions and merchant rules move to the category you pick. Its budget is removed.</span>
          <label className="lbl" htmlFor="cat-move">MOVE THEM TO
            <select id="cat-move" className="field" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              {cats.filter((c) => c.kind === "spend" && c.id !== category.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="btns">
            <button type="button" className="btn ghost" onClick={() => setConfirm(false)}>Keep it</button>
            <button type="button" className="btn danger" disabled={pending} onClick={remove}>{pending ? "Deleting…" : "Delete"}</button>
          </div>
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      <div className="btns">
        {category ? <button type="button" className="btn ghost" onClick={() => setConfirm(true)}>Delete</button> : onCancel ? <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button> : null}
        <button type="button" className="btn" disabled={pending || !name.trim()} onClick={save}>{pending ? "Saving…" : category ? "Save" : "Create category"}</button>
      </div>
    </div>
  );
}

/** The category chips with a "New category" chip that opens the form right underneath. */
export function CategoryPickerWithNew({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { cats } = useApp();
  const [adding, setAdding] = useState(false);
  const [made, setMade] = useState<{ id: string; name: string; color: string } | null>(null);
  return (
    <>
      <CategoryGrid cats={cats} value={value} onChange={onChange} extra={made} onNew={adding ? undefined : () => setAdding(true)} />
      {adding && (
        <div className="cat-form inline">
          <CategoryForm
            withBudget={false}
            onCancel={() => setAdding(false)}
            onDone={(id, name, color) => { setMade({ id, name, color }); onChange(id); setAdding(false); }}
          />
        </div>
      )}
    </>
  );
}
