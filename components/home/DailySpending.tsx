"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { HEAT, heatLevels } from "@/components/charts/interactive";
import { firstWeekdayMon, monthLong, monthShort } from "@/lib/dates";
import { inr } from "@/lib/money";

// three.js only loads when someone switches to 3D.
const Skyline = dynamic(() => import("@/components/three/Skyline"), {
  ssr: false,
  loading: () => <div className="skyline skel" aria-busy="true" />,
});

export type DailyMonth = { month: string; totals: Record<number, number>; detail: Record<number, { count: number; top: string }> };
type Props = { months: DailyMonth[]; current: string; today: number };

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dimOf = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
/** "1.2k", "340": short enough to sit inside a day cell. */
const short = (p: number) => { const r = p / 100; return r >= 1e5 ? `${(r / 1e5).toFixed(1)}L` : r >= 1e4 ? `${Math.round(r / 1e3)}k` : r >= 1e3 ? `${(r / 1e3).toFixed(1)}k` : String(Math.round(r)); };

export default function DailySpending({ months, current, today }: Props) {
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [idx, setIdx] = useState(Math.max(0, months.findIndex((m) => m.month === current)));
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    try { if (localStorage.getItem("kosh-daily-view") === "3d") setView("3d"); } catch {}
  }, []);
  const choose = (v: "2d" | "3d") => {
    setView(v);
    try { localStorage.setItem("kosh-daily-view", v); } catch {}
  };

  const m = months[idx] ?? { month: current, totals: {}, detail: {} };
  const isCurrent = m.month === current;
  const dim = dimOf(m.month);
  const lastDay = isCurrent ? today : dim; // days that have happened
  const go = (d: number) => { setIdx((i) => Math.min(months.length - 1, Math.max(0, i + d))); setSel(null); };

  const stats = useMemo(() => {
    const vals = Array.from({ length: lastDay }, (_, i) => m.totals[i + 1] ?? 0);
    const total = vals.reduce((a, b) => a + b, 0);
    const noSpend = vals.filter((v) => !v).length;
    const maxDay = vals.reduce((best, v, i) => (v > (vals[best] ?? 0) ? i : best), 0);
    return { total, avg: lastDay ? total / lastDay : 0, noSpend, maxDay: vals[maxDay] ? maxDay + 1 : null, max: vals[maxDay] ?? 0 };
  }, [m, lastDay]);
  const lvl = useMemo(() => heatLevels(m.totals), [m.totals]);
  const first = firstWeekdayMon(m.month);
  const dayIso = (d: number) => `${m.month.slice(0, 8)}${String(d).padStart(2, "0")}`;
  const picked = sel ?? (isCurrent ? today : stats.maxDay);

  return (
    <section className="card o4 cal-card">
      <div className="section-h">
        <h2>Daily spending</h2>
        <div className="seg seg-sm" role="group" aria-label="View">
          <button aria-pressed={view === "2d"} onClick={() => choose("2d")}>Calendar</button>
          <button aria-pressed={view === "3d"} onClick={() => choose("3d")}>3D</button>
        </div>
      </div>

      <div className="cal-nav">
        <button className="icon-btn" onClick={() => go(-1)} disabled={idx === 0} aria-label="Previous month">‹</button>
        <div className="cal-title">
          <b>{monthLong(m.month)}</b>
          {months.length > 1 && (
            <select aria-label="Choose month" value={idx} onChange={(e) => { setIdx(+e.target.value); setSel(null); }}>
              {months.map((x, i) => <option key={x.month} value={i}>{monthLong(x.month)}</option>)}
            </select>
          )}
        </div>
        <button className="icon-btn" onClick={() => go(1)} disabled={idx >= months.length - 1} aria-label="Next month">›</button>
      </div>

      <div className="cal-stats">
        <div><span>{isCurrent ? "So far" : "Total"}</span><b className="num">{inr(stats.total)}</b></div>
        <div><span>Per day</span><b className="num">{inr(stats.avg)}</b></div>
        <div><span>No-spend</span><b className="num">{stats.noSpend} day{stats.noSpend === 1 ? "" : "s"}</b></div>
      </div>

      {view === "2d" ? (
        <>
          <div className="cal" role="grid" aria-label={`Spending in ${monthLong(m.month)}`}>
            {WD.map((d, i) => <div key={d} className={`cal-wd${i >= 5 ? " we" : ""}`}>{d.slice(0, 1)}<span>{d.slice(1)}</span></div>)}
            {Array.from({ length: first }, (_, i) => <div key={"b" + i} />)}
            {Array.from({ length: dim }, (_, i) => {
              const d = i + 1, pos = first + i;
              if (d > lastDay) return <div key={d} className="cal-day future"><i>{d}</i></div>;
              const v = m.totals[d] ?? 0, l = lvl(v);
              return (
                <button
                  key={d}
                  type="button"
                  className={`cal-day m-pop l${l}${isCurrent && d === today ? " today" : ""}${picked === d ? " on" : ""}${pos % 7 >= 5 ? " we" : ""}`}
                  style={{ background: HEAT[l], animationDelay: `${(Math.floor(pos / 7) + (pos % 7)) * 22}ms` }}
                  aria-label={`${d} ${monthShort(m.month)}: ${v ? inr(v) : "no spending"}`}
                  aria-pressed={picked === d}
                  onClick={() => setSel(d)}
                >
                  <i>{d}</i>
                  {v > 0 && <span>{short(v)}</span>}
                </button>
              );
            })}
          </div>
          {picked && (
            <div className="cal-detail" key={m.month + picked}>
              <div>
                <span className="eyebrow">{WD[(first + picked - 1) % 7]}, {picked} {monthShort(m.month)}{isCurrent && picked === today ? " · today" : ""}</span>
                <b className="num">{m.totals[picked] ? inr(m.totals[picked]) : "No spending"}</b>
                {m.detail[picked] && <small>{m.detail[picked].count} spend{m.detail[picked].count > 1 ? "s" : ""} · biggest at {m.detail[picked].top}</small>}
                {!m.totals[picked] && <small>A no-spend day 🎉</small>}
              </div>
              {(m.totals[picked] ?? 0) > 0 && <Link className="btn ghost sm" href={`/activity?day=${dayIso(picked)}`}>See all →</Link>}
            </div>
          )}
        </>
      ) : (
        <Skyline month={m.month} today={lastDay} totals={m.totals} detail={m.detail} />
      )}

      <div className="row" style={{ marginTop: 12, alignItems: "flex-start", gap: 12 }}>
        <p className="hint">Everyday spending only: rent and subscriptions are left out so the pattern shows.{view === "2d" ? " Tap a day for details." : " Drag to orbit; tap a column to open it."}</p>
        <div className="scale" aria-hidden="true" style={{ flex: "none" }}>Less {HEAT.map((c, i) => <i key={i} style={{ background: c }} />)} More</div>
      </div>
    </section>
  );
}
