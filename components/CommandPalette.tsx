"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useApp } from "./app";

type Item = { id: string; group: string; label: string; hint?: string; glyph: string; run: () => void; keywords?: string };

/**
 * ⌘K / Ctrl+K: jump to a page, start an action, search transactions, or ask a question.
 * Arrow keys move, Enter runs, Esc closes.
 */
export default function CommandPalette() {
  const { paletteOpen, setPaletteOpen, openAdd } = useApp();
  if (!paletteOpen) return null;
  return <Palette onClose={() => setPaletteOpen(false)} openAdd={openAdd} />;
}

function Palette({ onClose, openAdd }: { onClose: () => void; openAdd: ReturnType<typeof useApp>["openAdd"] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const go = (href: string) => () => { onClose(); router.push(href); };
  const base: Item[] = [
    { id: "home", group: "Go to", label: "Overview", glyph: "⌂", run: go("/home"), keywords: "home dashboard safe" },
    { id: "activity", group: "Go to", label: "Activity", glyph: "≡", run: go("/activity"), keywords: "transactions list" },
    { id: "review", group: "Go to", label: "Transactions to review", glyph: "●", run: go("/activity?filter=review"), keywords: "approve unreviewed" },
    { id: "askpage", group: "Go to", label: "Ask Expensly (AI)", glyph: "✦", run: go("/ask"), keywords: "ai chat question claude assistant" },
    { id: "insights", group: "Go to", label: "Insights", glyph: "✦", run: go("/insights"), keywords: "health score subscriptions merchants fees interest forecast story analysis" },
    { id: "recurring", group: "Go to", label: "Subscriptions & bills", glyph: "↻", run: go("/insights#recurring"), keywords: "recurring netflix spotify price" },
    { id: "budgets", group: "Go to", label: "Budgets", glyph: "◔", run: go("/budgets"), keywords: "limits categories" },
    { id: "wealth", group: "Go to", label: "Wealth", glyph: "↗", run: go("/wealth"), keywords: "net worth accounts goals recurring" },
    { id: "settings", group: "Go to", label: "Settings", glyph: "⚙", run: go("/settings"), keywords: "sample token export delete" },
    { id: "add", group: "Actions", label: "Add spending", hint: "N", glyph: "+", run: () => openAdd("quick"), keywords: "new expense quick" },
    { id: "import", group: "Actions", label: "Import a statement", glyph: "↧", run: () => openAdd("statement"), keywords: "csv pdf cred card bank upload" },
    { id: "sms", group: "Actions", label: "Paste bank SMS", glyph: "✉", run: () => openAdd("sms"), keywords: "upi alert message" },
    { id: "export", group: "Actions", label: "Download transactions (CSV)", glyph: "⇣", run: () => { onClose(); window.location.href = "/api/export"; }, keywords: "export csv backup" },
  ];

  const term = q.trim().toLowerCase();
  const items = useMemo(() => {
    const matched = term
      ? base.filter((i) => (i.label + " " + (i.keywords ?? "")).toLowerCase().includes(term))
      : base;
    if (!term) return matched;
    return [
      ...matched,
      { id: "search", group: "Search", label: `Find “${q.trim()}” in transactions`, glyph: "⌕", run: go(`/activity?q=${encodeURIComponent(q.trim())}`) },
      {
        id: "ask", group: "Ask Expensly", label: `Ask: ${q.trim()}`, glyph: "✦",
        run: go(`/ask?q=${encodeURIComponent(q.trim())}`),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  useEffect(() => { setSel(0); }, [term]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % Math.max(1, items.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + items.length) % Math.max(1, items.length)); }
    else if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
  };

  let lastGroup = "";
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <div className="palette-in">
          <div className="palette-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input
              ref={input}
              id="palette-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Jump to, search, or ask a question…"
              aria-label="Command"
              aria-activedescendant={items[sel] ? `pal-${items[sel].id}` : undefined}
              autoComplete="off"
            />
            <kbd>esc</kbd>
          </div>
          <div className="palette-list" ref={list} role="listbox">
            {items.map((it, i) => {
              const head = it.group !== lastGroup ? <div className="palette-group" key={"g" + it.group}>{it.group}</div> : null;
              lastGroup = it.group;
              return (
                <div key={it.id}>
                  {head}
                  <button
                    id={`pal-${it.id}`}
                    data-i={i}
                    role="option"
                    aria-selected={i === sel}
                    className="palette-item"
                    onMouseMove={() => setSel(i)}
                    onClick={it.run}
                  >
                    <span className="palette-glyph">{it.glyph}</span>
                    <span className="ellipsis">{it.label}</span>
                    {it.hint && <kbd>{it.hint}</kbd>}
                    {i === sel && <span className="palette-enter" aria-hidden="true">↵</span>}
                  </button>
                </div>
              );
            })}
            {!items.length && <p className="empty">No matches.</p>}
          </div>
          <div className="palette-foot hint"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to run</span><span><kbd>⌘</kbd><kbd>K</kbd> to toggle</span></div>
        </div>
      </div>
    </>,
    document.body,
  );
}
