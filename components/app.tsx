"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Category, MerchantRule } from "@/lib/types";
import type { Memory, MemoryEntry } from "@/lib/ingest/classify";
import { inr, inrCompact } from "@/lib/money";

/* ───────────────────────── context ───────────────────────── */

type Toast = { id: number; text: string; action?: { label: string; run: () => void } };
type AddMode = "quick" | "sms" | "statement";

type AppCtx = {
  cats: Category[];
  rules: MerchantRule[];
  memory: Memory;
  toast: (text: string, action?: Toast["action"]) => void;
  openAdd: (mode?: AddMode) => void;
  addMode: AddMode | null;
  closeAdd: () => void;
  celebrate: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
};

const Ctx = createContext<AppCtx | null>(null);

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp must be used inside <AppProvider>");
  return c;
}

export function AppProvider({ cats, rules, memory: memoryEntries = [], children }: { cats: Category[]; rules: MerchantRule[]; memory?: [string, MemoryEntry][]; children: React.ReactNode }) {
  const memory = useMemo(() => new Map(memoryEntries), [memoryEntries]);
  const [toastState, setToast] = useState<Toast | null>(null);
  const [addMode, setAddMode] = useState<AddMode | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const confetti = useRef<HTMLCanvasElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = useCallback((text: string, action?: Toast["action"]) => {
    clearTimeout(timer.current);
    setToast({ id: Date.now(), text, action });
    timer.current = setTimeout(() => setToast(null), action ? 5000 : 2200);
  }, []);

  const celebrate = useCallback(() => {
    const cv = confetti.current;
    if (!cv || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    burst(cv);
  }, []);

  // ⌘K / Ctrl+K opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAddMode(null);
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useSpotlight();

  return (
    <Ctx.Provider value={{ cats, rules, memory, toast, openAdd: (m = "quick") => { setPaletteOpen(false); setAddMode(m); }, addMode, closeAdd: () => setAddMode(null), celebrate, paletteOpen, setPaletteOpen }}>
      {children}
      {toastState && (
        <div className="toast" role="status" key={toastState.id}>
          <span>{toastState.text}</span>
          {toastState.action && (
            <button onClick={() => { toastState.action!.run(); setToast(null); }}>{toastState.action.label}</button>
          )}
        </div>
      )}
      <canvas ref={confetti} className="confetti" aria-hidden="true" />
    </Ctx.Provider>
  );
}

/* ───────────────────────── spotlight ───────────────────────── */

const GLOW = ".card, .hero, .insight, .goal, .bill, .tile-btn, .act-summary > div";

/** A soft light that follows the cursor across cards. Mouse only; touch and reduced motion skip it. */
function useSpotlight() {
  useEffect(() => {
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = (e.target as Element | null)?.closest?.(GLOW) as HTMLElement | null;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
      });
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("pointermove", onMove);
    };
  }, []);
}

/* ───────────────────────── sheet ───────────────────────── */

/** Open sheets, newest last. Only the top one answers Escape and Tab. */
const openSheets: object[] = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({ title, onClose, children, label }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ y: 0, dy: 0, on: false });

  /** On phones, pull the sheet down by its handle or title to dismiss it. */
  const dragHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (window.innerWidth >= 1024 || (e.target as HTMLElement).closest("button")) return;
      drag.current = { y: e.clientY, dy: 0, on: true };
      ref.current?.classList.add("dragging");
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d.on || !ref.current) return;
      d.dy = Math.max(0, e.clientY - d.y);
      ref.current.style.transform = `translateY(${d.dy}px)`;
    },
    onPointerUp: () => {
      const d = drag.current;
      if (!d.on || !ref.current) return;
      d.on = false;
      ref.current.classList.remove("dragging");
      if (d.dy > 110) {
        ref.current.style.transform = "translateY(110%)";
        setTimeout(onClose, 180);
      } else ref.current.style.transform = "";
    },
  };
  // Escape closes; Tab stays inside the sheet; focus goes back to whatever opened it.
  const opener = useRef<HTMLElement | null>(null);
  const me = useRef({});
  useEffect(() => {
    const id = me.current;
    openSheets.push(id);
    opener.current = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = ref.current;
    (el?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select") ?? el)?.focus({ preventScroll: true });
    return () => {
      openSheets.splice(openSheets.indexOf(id), 1);
      document.body.style.overflow = prev;
      const back = opener.current;
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (openSheets[openSheets.length - 1] !== me.current) return;
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) return e.preventDefault();
      const first = items[0], last = items[items.length - 1];
      const inside = ref.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Portaled to <body> so the sheet sits above the tab bar whatever page renders it.
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} aria-label={label ?? (typeof title === "string" ? title : undefined)}>
        <div className="in" ref={ref} tabIndex={-1}>
          <div className="drag-zone" {...dragHandlers} onPointerCancel={dragHandlers.onPointerUp}>
          <div className="grab" />
          <div className="row">
            <h2 style={{ fontSize: 21, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>{title}</h2>
            <button className="link" onClick={onClose}>Close</button>
          </div>
          </div>
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}

/* ───────────────────────── bits ───────────────────────── */

export function CatIcon({ name, color, size }: { name: string; color: string; size?: "sm" }) {
  return (
    <span className={`ic${size ? " " + size : ""}`} style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}>
      {(name.trim()[0] || "?").toUpperCase()}
    </span>
  );
}

/** Rolls a rupee amount (in paise) up from 82% to its value on mount and whenever it changes. */
export function CountUp({ value, compact }: { value: number; compact?: boolean }) {
  const [shown, setShown] = useState(value);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setShown(value);
    // First time: roll up from 82%. After that: glide from the old number to the new one.
    const from = last.current ?? value * 0.82, t0 = performance.now();
    last.current = value;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 4);
      setShown(from + (value - from) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{compact ? inrCompact(shown) : inr(shown)}</>;
}

export function CategoryGrid({ cats, value, onChange, onNew, extra }: { cats: Category[]; value: string; onChange: (id: string) => void; onNew?: () => void; extra?: { id: string; name: string; color: string } | null }) {
  // a category made a moment ago shows straight away, before the page has reloaded the list
  const list = extra && !cats.some((c) => c.id === extra.id) ? [...cats, extra] : cats;
  return (
    <div className="catgrid" role="radiogroup" aria-label="Category">
      {list.map((c) => (
        <button key={c.id} type="button" role="radio" aria-checked={c.id === value} aria-pressed={c.id === value} onClick={() => onChange(c.id)}>
          <span className="dot" style={{ background: c.color }} />
          {c.name}
        </button>
      ))}
      {onNew && <button type="button" className="new" onClick={onNew}>＋ New category</button>}
    </div>
  );
}

function burst(cv: HTMLCanvasElement) {
  const cx = cv.getContext("2d");
  if (!cx) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = innerWidth * dpr;
  cv.height = innerHeight * dpr;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = ["#7D8EFF", "#F5B03A", "#3DDC97", "#E8508A", "#3B8BF6"];
  const ps = Array.from({ length: 140 }, () => ({ x: innerWidth / 2, y: innerHeight * 0.45, vx: (Math.random() - 0.5) * 11, vy: -Math.random() * 13 - 4, s: Math.random() * 6 + 4, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: cols[(Math.random() * 5) | 0] }));
  const t0 = performance.now();
  const f = (t: number) => {
    cx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of ps) {
      p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.r += p.vr;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c; cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); cx.restore();
    }
    if (t - t0 < 2200) requestAnimationFrame(f);
    else cx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(f);
}
