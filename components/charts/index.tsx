import Link from "next/link";
import { inr, inrCompact } from "@/lib/money";
import { firstWeekdayMon, monthShort } from "@/lib/dates";

/*
 * All charts are plain SVG with no hooks, so they render on the server or the client.
 * Entrance motion is pure CSS (see "motion" in globals.css): each mark animates *from* an empty
 * state to its real value, so with reduced motion the final chart simply shows.
 */

/** Typed helper for CSS custom properties in style props. */
const vars = (o: Record<string, string | number>) => o as React.CSSProperties;

export function Ring({ value, color, size = 64, width = 7 }: { value: number; color: string; size?: number; width?: number }) {
  const r = (size - width) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(value, 1)));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)", display: "block" }} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={width} />
      <circle className="m-ring" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={vars({ "--c": c, transition: "stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)" })} />
    </svg>
  );
}

/** 270° arc. `used` = share of budget spent, `pace` = share of month gone (the tick). */
export function GaugeArc({ used, pace }: { used: number; pace: number }) {
  const cx = 140, cy = 140, r = 112, a0 = 135, sweep = 270;
  const pt = (deg: number, rad = r) => [cx + rad * Math.cos((deg * Math.PI) / 180), cy + rad * Math.sin((deg * Math.PI) / 180)] as const;
  const [x1, y1] = pt(a0);
  const [x2, y2] = pt(a0 + sweep);
  const full = `M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 1 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  const u = Math.max(0.001, Math.min(used, 1));
  const [ex, ey] = pt(a0 + sweep * u);
  // The "where you should be by today" tick sits outside the ring so it never crosses the number.
  const [px, py] = pt(a0 + sweep * pace, r + 12);
  const [qx, qy] = pt(a0 + sweep * pace, r + 22);
  const over = used > 1;
  return (
    <svg viewBox="0 0 280 250" aria-hidden="true">
      <defs>
        <linearGradient id="kosh-gauge" x1="0" x2="1" y1="1" y2="0">
          <stop offset="0" stopColor={over ? "var(--bad)" : "var(--accent)"} />
          <stop offset="1" stopColor={over ? "var(--bad)" : "var(--accent-2)"} />
        </linearGradient>
        <filter id="kosh-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      <path d={full} fill="none" stroke="var(--surface-2)" strokeWidth="16" strokeLinecap="round" />
      <path className="m-sweep m-glow" d={full} fill="none" stroke="url(#kosh-gauge)" strokeWidth="16" strokeLinecap="round" pathLength={100} strokeDasharray={`${u * 100} 100`} opacity=".55" filter="url(#kosh-glow)" />
      <path className="m-sweep" d={full} fill="none" stroke="url(#kosh-gauge)" strokeWidth="16" strokeLinecap="round" pathLength={100} strokeDasharray={`${u * 100} 100`} />
      {!over && <circle className="m-late" cx={ex} cy={ey} r="5" fill="var(--bg)" />}
      {!over && pace > 0 && pace < 1 && <line className="m-late" x1={px} y1={py} x2={qx} y2={qy} stroke="var(--fg)" strokeWidth="2.5" strokeLinecap="round" opacity=".55" />}
    </svg>
  );
}

export function Donut({ parts, size = 150, width = 20 }: { parts: { color: string; value: number }[]; size?: number; width?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const r = (size - width) / 2;
  const C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)", display: "block" }} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={width} />
      {parts.map((p, i) => {
        const len = (C * p.value) / total;
        const gap = Math.min(3, len * 0.3);
        const el = <circle key={i} className="m-seg" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={width} strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-acc} style={vars({ "--c": C, animationDelay: `${120 + i * 90}ms` })} />;
        acc += len;
        return el;
      })}
    </svg>
  );
}

export function CashFlowChart({ data, W = 340, H = 150 }: { data: { label: string; income: number; spent: number }[]; W?: number; H?: number }) {
  const bw = W > 500 ? 22 : 14;
  const id = `kosh-cf-${W}`, fs = W > 500 ? 12 : 10, fl = W > 500 ? 12.5 : 11;
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.spent])) * 1.12;
  const step = (W - 10) / data.length;
  const grid = niceTicks(max / 1.12);
  return (
    <svg viewBox={`0 0 ${W} ${H + 24}`} width="100%" role="img" aria-label="Income and spending over the last six months">
      <defs>
        <linearGradient id={`${id}-in`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--good)" /><stop offset="1" stopColor="var(--good)" stopOpacity=".35" /></linearGradient>
        <linearGradient id={`${id}-out`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent)" stopOpacity=".35" /></linearGradient>
      </defs>
      {grid.map((v) => {
        const y = H - ((H - 6) * v) / max;
        return (
          <g key={v}>
            <line x1="0" x2={W} y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 5" />
            <text x="0" y={y - 5} fontSize={fs} fill="var(--muted)" fontFamily="var(--mono)">{inrCompact(v)}</text>
          </g>
        );
      })}
      {data.map((d, k) => {
        const x = 5 + k * step + step / 2;
        const hi = ((H - 6) * d.income) / max;
        const hs = ((H - 6) * d.spent) / max;
        const last = k === data.length - 1;
        const op = last ? 1 : 0.5;
        return (
          <g key={d.label + k}>
            <rect className="m-grow" style={{ animationDelay: `${k * 70}ms` }} x={x - bw - 2} y={H - hi} width={bw} height={Math.max(0, hi)} rx="6" fill={`url(#${id}-in)`} opacity={op}><title>{`${d.label} income ${inr(d.income)}`}</title></rect>
            <rect className="m-grow" style={{ animationDelay: `${k * 70 + 40}ms` }} x={x + 2} y={H - hs} width={bw} height={Math.max(0, hs)} rx="6" fill={`url(#${id}-out)`} opacity={op}><title>{`${d.label} spent ${inr(d.spent)}`}</title></rect>
            <text x={x} y={H + 17} textAnchor="middle" fontSize={fl} fontWeight="800" fill={last ? "var(--fg)" : "var(--muted)"} fontFamily="var(--body)">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Two grid lines at round values below the max. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [];
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => max / s <= 2.5) ?? mag * 10;
  const out: number[] = [];
  for (let v = step; v <= max; v += step) out.push(v);
  return out.slice(-2);
}

export function AreaTrend({ points, W = 340, H = 130 }: { points: { month: string; value: number }[]; W?: number; H?: number }) {
  if (points.length < 2) {
    return <p className="hint" style={{ padding: "12px 0" }}>The trend line appears after your second month of balances.</p>;
  }
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || Math.abs(hi) || 1;
  const X = (i: number) => 12 + (i * (W - 24)) / (points.length - 1);
  const Y = (v: number) => 10 + (H - 20) * (1 - (v - lo + span * 0.05) / (span * 1.1));
  let line = "";
  points.forEach((p, i) => {
    if (!i) { line = `M${X(0)} ${Y(p.value)}`; return; }
    const x0 = X(i - 1), y0 = Y(points[i - 1].value), x1 = X(i), y1 = Y(p.value), cx = (x0 + x1) / 2;
    line += ` C${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`;
  });
  const lx = X(points.length - 1), ly = Y(vals[vals.length - 1]);
  const id = `kosh-area-${W}`, fl = W > 500 ? 12.5 : 11;
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} width="100%" role="img" aria-label="Net worth trend">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".35" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
      {[0.33, 0.66].map((f) => <line key={f} x1="0" x2={W} y1={10 + (H - 20) * f} y2={10 + (H - 20) * f} stroke="var(--line)" strokeDasharray="2 5" />)}
      <path className="m-fade" d={`${line} L${lx} ${H} L${X(0)} ${H} Z`} fill={`url(#${id})`} />
      <path className="m-draw" d={line} pathLength={100} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
      <circle className="m-pulse" cx={lx} cy={ly} r="10" fill="var(--accent)" opacity=".2" />
      <circle className="m-late" cx={lx} cy={ly} r="5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
      {points.map((p, i) => (
        <text key={p.month} x={X(i)} y={H + 17} textAnchor="middle" fontSize={fl} fontWeight="800" fill={i === points.length - 1 ? "var(--fg)" : "var(--muted)"} fontFamily="var(--body)">{monthShort(p.month)}</text>
      ))}
    </svg>
  );
}

const HEAT = [
  "var(--surface-2)",
  "color-mix(in srgb, var(--accent) 25%, var(--surface-2))",
  "color-mix(in srgb, var(--accent) 50%, var(--surface-2))",
  "color-mix(in srgb, var(--accent) 78%, var(--surface-2))",
  "var(--accent)",
];

/** Levels scale with your own typical day, so the map stays useful at any income. */
export function Heatmap({ month, today, totals }: { month: string; today: number; totals: Record<number, number> }) {
  const dim = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const vals = Object.values(totals).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.8)];
  const lvl = (v: number) => (!v ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4);
  const first = firstWeekdayMon(month);
  return (
    <>
      <div className="heat">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i} className="wd">{d}</div>)}
        {Array.from({ length: first }, (_, i) => <div key={"b" + i} />)}
        {Array.from({ length: dim }, (_, i) => {
          const d = i + 1;
          const v = totals[d] ?? 0;
          if (d > today) return <div key={d} className="cell future m-pop" style={{ animationDelay: `${(Math.floor((first + i) / 7) + ((first + i) % 7)) * 28}ms` }}>{d}</div>;
          const l = lvl(v);
          const pos = first + i, delay = (Math.floor(pos / 7) + (pos % 7)) * 28;
          return (
            <Link key={d} href={`/activity?day=${month.slice(0, 8)}${String(d).padStart(2, "0")}`} className={`cell m-pop${d === today ? " today" : ""}`} style={{ background: HEAT[l], color: l >= 3 ? "#fff" : undefined, animationDelay: `${delay}ms` }} title={`${monthShort(month)} ${d}: ${inr(v)}`} aria-label={`${monthShort(month)} ${d}, ${inr(v)} spent`}>
              {d}
            </Link>
          );
        })}
      </div>
    </>
  );
}

export function HeatScale() {
  return (
    <div className="scale" aria-hidden="true">
      Less {HEAT.map((c, i) => <i key={i} style={{ background: c }} />)} More
    </div>
  );
}
