"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { inr, inrCompact } from "@/lib/money";
import { firstWeekdayMon, monthShort, monthLong } from "@/lib/dates";

/*
 * Interactive charts. They measure their own width, so a drawing is always laid out at real pixel size
 * (text never scales up or down), and they respond to hover, touch and arrow keys.
 */

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Width of an element, updated as it resizes. Starts at a sensible guess so the first render isn't empty. */
export function useWidth<T extends HTMLElement>(initial = 340) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(initial);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || initial);
    // a hidden container reports 0; keep the last real width so bar maths never goes negative
    const ro = new ResizeObserver(([e]) => { const cw = Math.round(e.contentRect.width); if (cw > 0) setW(cw); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [initial]);
  return [ref, w] as const;
}

function niceTicks(max: number): number[] {
  if (max <= 0) return [];
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => max / s <= 2.5) ?? mag * 10;
  const out: number[] = [];
  for (let v = step; v <= max; v += step) out.push(v);
  return out.slice(-2);
}

/* ───────────────────────── cash flow ───────────────────────── */

type Month = { month: string; label: string; income: number; spent: number };

/** Income vs spending by month. Hover, tap or arrow keys pick a month; its numbers show underneath. */
export function CashFlow({ data }: { data: Month[] }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [sel, setSel] = useState(data.length - 1);
  const [hover, setHover] = useState<number | null>(null);
  const H = W > 520 ? 190 : 150;
  const active = hover ?? sel;
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.spent])) * 1.12;
  const step = (W - 10) / data.length;
  const bw = Math.min(26, Math.max(10, step * 0.22));
  const y = (v: number) => H - ((H - 6) * v) / max;
  const d = data[active];
  const saved = d.income - d.spent;
  const prev = data[active - 1];

  return (
    <div ref={ref} className="ichart">
      <svg
        width={W}
        height={H + 24}
        role="img"
        aria-label="Income and spending by month. Use the left and right arrow keys to pick a month."
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setSel((s) => Math.max(0, s - 1));
          if (e.key === "ArrowRight") setSel((s) => Math.min(data.length - 1, s + 1));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="icf-in" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--good)" /><stop offset="1" stopColor="var(--good)" stopOpacity=".35" /></linearGradient>
          <linearGradient id="icf-out" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent)" stopOpacity=".35" /></linearGradient>
        </defs>
        {niceTicks(max / 1.12).map((v) => (
          <g key={v}>
            <line x1="0" x2={W} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="2 5" />
            <text x="0" y={y(v) - 5} fontSize="11" fill="var(--muted)" fontFamily="var(--mono)">{inrCompact(v)}</text>
          </g>
        ))}
        {data.map((m, k) => {
          const x = 5 + k * step + step / 2;
          const on = k === active;
          return (
            <g
              key={m.month}
              className="icf-col"
              onPointerEnter={() => setHover(k)}
              onClick={() => setSel(k)}
              style={{ cursor: "pointer" }}
            >
              <rect x={x - step / 2 + 2} y={4} width={step - 4} height={H + 18} rx="10" fill={on ? "color-mix(in srgb, var(--accent) 9%, transparent)" : "transparent"} style={{ transition: "fill .2s" }} />
              <rect className="m-grow" style={{ animationDelay: `${k * 70}ms`, transition: "opacity .2s" }} x={x - bw - 2} y={y(m.income)} width={bw} height={Math.max(0, H - y(m.income))} rx={Math.min(7, bw / 2)} fill="url(#icf-in)" opacity={on ? 1 : 0.45} />
              <rect className="m-grow" style={{ animationDelay: `${k * 70 + 40}ms`, transition: "opacity .2s" }} x={x + 2} y={y(m.spent)} width={bw} height={Math.max(0, H - y(m.spent))} rx={Math.min(7, bw / 2)} fill="url(#icf-out)" opacity={on ? 1 : 0.45} />
              <text x={x} y={H + 17} textAnchor="middle" fontSize="12" fontWeight="800" fill={on ? "var(--fg)" : "var(--muted)"} fontFamily="var(--body)">{m.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="icf-detail" aria-live="polite">
        <span className="eyebrow">{monthLong(d.month)}</span>
        <div className="icf-stats">
          <div><span className="dot" style={{ background: "var(--good)" }} /> In <b className="num">{inr(d.income)}</b></div>
          <div><span className="dot" style={{ background: "var(--accent)" }} /> Out <b className="num">{inr(d.spent)}</b></div>
          <div>Saved <b className={`num ${saved >= 0 ? "good" : "bad"}`}>{saved < 0 ? "−" : ""}{inr(saved)}{d.income && saved > 0 ? ` · ${Math.round((saved / d.income) * 100)}%` : ""}</b></div>
          {prev && prev.spent > 0 && (
            <div className="muted">
              Spending {d.spent >= prev.spent ? "▲" : "▼"} {Math.abs(Math.round((d.spent / prev.spent - 1) * 100))}% vs {prev.label}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── donut + legend ───────────────────────── */

type Slice = { id: string; name: string; color: string; value: number };

/** Category split. Hover a slice or a legend row to read it; click to see those transactions. */
export function CategoryDonut({ slices, size = 160 }: { slices: Slice[]; size?: number }) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const width = 20, r = (size - width - 12) / 2, C = 2 * Math.PI * r, c = size / 2;
  const h = slices.find((s) => s.id === hover);
  let acc = 0;
  return (
    <div className="split">
      <div className="donut" style={{ width: size, height: size }} onPointerLeave={() => setHover(null)}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)", display: "block", overflow: "visible" }} aria-hidden="true">
          <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={width} />
          {slices.map((s, i) => {
            const len = (C * s.value) / total, gap = Math.min(3, len * 0.3);
            const on = s.id === hover, dim = hover && !on;
            const el = (
              <circle
                key={s.id}
                className="m-seg dseg"
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={on ? width + 10 : width}
                strokeDasharray={`${Math.max(0, len - gap)} ${C}`}
                strokeDashoffset={-acc}
                opacity={dim ? 0.35 : 1}
                style={{ ["--c" as string]: C, animationDelay: `${120 + i * 90}ms`, cursor: "pointer", transition: "stroke-width .25s cubic-bezier(.34,1.56,.64,1), opacity .2s" } as React.CSSProperties}
                onPointerEnter={() => setHover(s.id)}
                onClick={() => router.push(`/activity?cat=${s.id}`)}
              />
            );
            acc += len;
            return el;
          })}
        </svg>
        <div className="c" aria-live="polite">
          <div>
            <div className="eyebrow ellipsis" style={{ maxWidth: size - 56 }}>{h ? h.name : "Spent"}</div>
            <div className="num" style={{ fontSize: 20, fontWeight: 600 }}>{inrCompact(h ? h.value : total)}</div>
            {h && <div className="hint num">{Math.round((h.value / total) * 100)}%</div>}
          </div>
        </div>
      </div>
      <div className="legend">
        {slices.slice(0, 8).map((s, i) => (
          <Link
            key={s.id}
            href={`/activity?cat=${s.id}`}
            className={`m-rise${i >= 6 ? " only-desktop-flex" : ""}${hover && hover !== s.id ? " dim" : ""}`}
            style={{ animationDelay: `${200 + i * 60}ms` }}
            onPointerEnter={() => setHover(s.id)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(s.id)}
            onBlur={() => setHover(null)}
          >
            <span className="dot" style={{ background: s.color }} />
            <span className="ellipsis">{s.name}</span>
            <span className="num muted legend-amt">{inr(s.value)}</span>
            <span className="num muted">{Math.round((s.value / total) * 100)}%</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── net worth trend ───────────────────────── */

/** Smooth trend line. Drag or hover across it to read any month. */
export function TrendScrubber({ points }: { points: { month: string; value: number }[] }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [idx, setIdx] = useState<number | null>(null);
  const H = W > 520 ? 190 : 140;
  if (points.length < 2) return <p className="hint" style={{ padding: "12px 0" }}>The trend line appears after your second month of balances.</p>;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || Math.abs(hi) || 1;
  const X = (i: number) => 14 + (i * (W - 28)) / (points.length - 1);
  const Y = (v: number) => 14 + (H - 28) * (1 - (v - lo + span * 0.05) / (span * 1.1));
  let line = `M${X(0)} ${Y(vals[0])}`;
  for (let i = 1; i < points.length; i++) {
    const x0 = X(i - 1), y0 = Y(vals[i - 1]), x1 = X(i), y1 = Y(vals[i]), cx = (x0 + x1) / 2;
    line += ` C${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`;
  }
  const last = points.length - 1;
  const at = idx ?? last;
  const ax = X(at), ay = Y(vals[at]);
  const change = at > 0 ? vals[at] - vals[at - 1] : null;
  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const i = Math.round(((clientX - r.left - 14) / (W - 28)) * (points.length - 1));
    setIdx(Math.max(0, Math.min(last, i)));
  };
  const tipLeft = Math.max(70, Math.min(W - 70, ax));

  return (
    <div ref={ref} className="ichart trend">
      <div className="itip" style={{ left: tipLeft, top: Math.max(0, ay - 64) }}>
        <span className="eyebrow">{monthShort(points[at].month)} {points[at].month.slice(0, 4)}</span>
        <b className="num">{inr(vals[at])}</b>
        {change !== null && <span className={`num ${change >= 0 ? "good" : "bad"}`}>{change >= 0 ? "▲" : "▼"} {inr(change)}</span>}
      </div>
      <svg
        width={W}
        height={H + 24}
        role="img"
        aria-label="Net worth by month. Use the arrow keys to move between months."
        tabIndex={0}
        style={{ touchAction: "pan-y" }}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setIdx(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, (i ?? last) - 1));
          if (e.key === "ArrowRight") setIdx((i) => Math.min(last, (i ?? last) + 1));
        }}
      >
        <defs><linearGradient id="itrend" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".35" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
        {[0.33, 0.66].map((f) => <line key={f} x1="0" x2={W} y1={14 + (H - 28) * f} y2={14 + (H - 28) * f} stroke="var(--line)" strokeDasharray="2 5" />)}
        <path className="m-fade" d={`${line} L${X(last)} ${H} L${X(0)} ${H} Z`} fill="url(#itrend)" />
        <path className="m-draw" d={line} pathLength={100} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
        <line x1={ax} x2={ax} y1={8} y2={H} stroke="var(--fg)" strokeOpacity=".25" strokeDasharray="3 4" style={{ transition: "all .15s" }} />
        {points.map((p, i) => <circle key={p.month} cx={X(i)} cy={Y(vals[i])} r={i === at ? 0 : 3} fill="var(--accent)" opacity=".5" />)}
        <circle className="m-pulse" cx={ax} cy={ay} r="10" fill="var(--accent)" opacity=".2" />
        <circle cx={ax} cy={ay} r="6" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2.5" style={{ transition: "cx .15s, cy .15s" }} />
        {points.map((p, i) => (
          <text key={p.month} x={X(i)} y={H + 18} textAnchor="middle" fontSize="12" fontWeight="800" fill={i === at ? "var(--fg)" : "var(--muted)"} fontFamily="var(--body)">{monthShort(p.month)}</text>
        ))}
      </svg>
    </div>
  );
}

/* ───────────────────────── heatmap ───────────────────────── */

export const HEAT = [
  "var(--surface-2)",
  "color-mix(in srgb, var(--accent) 25%, var(--surface-2))",
  "color-mix(in srgb, var(--accent) 50%, var(--surface-2))",
  "color-mix(in srgb, var(--accent) 78%, var(--surface-2))",
  "var(--accent)",
];

/** Spending level 0–4 for a day, relative to your own typical day this month. */
export function heatLevels(totals: Record<number, number>) {
  const vals = Object.values(totals).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.8)];
  return (v: number) => (!v ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4);
}

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function DayTip({ month, day, total, detail }: { month: string; day: number; total: number; detail?: { count: number; top: string } }) {
  const wd = WD[(firstWeekdayMon(month) + day - 1) % 7];
  return (
    <>
      <span className="eyebrow">{wd}, {day} {monthShort(month)}</span>
      <b className="num">{total ? inr(total) : "No spending"}</b>
      {detail && <span className="hint">{detail.count} spend{detail.count > 1 ? "s" : ""} · biggest {detail.top}</span>}
    </>
  );
}

/** Calendar heatmap with a live tooltip. */
export function Heatmap2D({ month, today, totals, detail }: { month: string; today: number; totals: Record<number, number>; detail: Record<number, { count: number; top: string }> }) {
  const dim = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const lvl = useMemo(() => heatLevels(totals), [totals]);
  const first = firstWeekdayMon(month);
  const [tip, setTip] = useState<{ d: number; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const show = (d: number, el: HTMLElement) => {
    const b = box.current?.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (b) setTip({ d, x: r.left - b.left + r.width / 2, y: r.top - b.top });
  };
  return (
    <div className="ichart" ref={box} onPointerLeave={() => setTip(null)}>
      <div className="heat">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i} className="wd">{d}</div>)}
        {Array.from({ length: first }, (_, i) => <div key={"b" + i} />)}
        {Array.from({ length: dim }, (_, i) => {
          const d = i + 1, pos = first + i, delay = (Math.floor(pos / 7) + (pos % 7)) * 28;
          if (d > today) return <div key={d} className="cell future m-pop" style={{ animationDelay: `${delay}ms` }}>{d}</div>;
          const v = totals[d] ?? 0, l = lvl(v);
          return (
            <Link
              key={d}
              href={`/activity?day=${month.slice(0, 8)}${String(d).padStart(2, "0")}`}
              className={`cell m-pop${d === today ? " today" : ""}${tip?.d === d ? " hot" : ""}`}
              style={{ background: HEAT[l], color: l >= 3 ? "#fff" : undefined, animationDelay: `${delay}ms` }}
              aria-label={`${monthShort(month)} ${d}, ${inr(v)} spent`}
              onPointerEnter={(e) => show(d, e.currentTarget)}
              onFocus={(e) => show(d, e.currentTarget)}
            >
              {d}
            </Link>
          );
        })}
      </div>
      {tip && (
        <div className="itip" style={{ left: tip.x, top: tip.y - 8, transform: "translate(-50%, -100%)" }}>
          <DayTip month={month} day={tip.d} total={totals[tip.d] ?? 0} detail={detail[tip.d]} />
        </div>
      )}
    </div>
  );
}
