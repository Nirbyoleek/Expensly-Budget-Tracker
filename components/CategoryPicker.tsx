"use client";

import { TAXONOMY_BY_ID } from "@/lib/taxonomy";
import type { Category } from "@/lib/types";

/** Compact two-level picker: one select, grouped by category. Value is "cat:sub" (sub may be empty). */
export function CategorySelect({
  cats, category, sub, onChange, label,
}: { cats: Category[]; category: string; sub: string | null; onChange: (category: string, sub: string | null) => void; label: string }) {
  return (
    <select
      value={`${category}:${sub ?? ""}`}
      onChange={(e) => {
        const [c, s] = e.target.value.split(":");
        onChange(c, s || null);
      }}
      aria-label={label}
    >
      {cats.map((c) => {
        const subs = TAXONOMY_BY_ID[c.id]?.subs ?? [];
        if (!subs.length) return <option key={c.id} value={`${c.id}:`}>{c.name}</option>;
        return (
          <optgroup key={c.id} label={c.name}>
            <option value={`${c.id}:`}>{c.name}</option>
            {subs.map((s) => <option key={s.id} value={`${c.id}:${s.id}`}>{s.name}</option>)}
          </optgroup>
        );
      })}
    </select>
  );
}

/** Chips for the subcategories of one category. */
export function SubPicker({ category, value, onChange }: { category: string; value: string | null; onChange: (sub: string | null) => void }) {
  const def = TAXONOMY_BY_ID[category];
  if (!def?.subs.length) return null;
  return (
    <div className="subchips" role="radiogroup" aria-label={`${def.name} type`}>
      {def.subs.map((s) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={s.id === value}
          className={s.id === value ? "on" : ""}
          style={{ ["--c" as string]: def.color }}
          onClick={() => onChange(s.id === value ? null : s.id)}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}
