"use client";

import { useState } from "react";
import { CountUp } from "@/components/app";
import { GaugeArc } from "@/components/charts";
import { inr } from "@/lib/money";

type Props = {
  safePerDay: number;
  daysLeft: number;
  budgetTotal: number;
  spent: number;
  upcomingTotal: number;
  projected: number;
  pace: number;
  paceDiff: number;
};

/** The gauge card. Tap it (or use the arrow keys) to switch between three readings of the same budget. */
export default function SafeHero(p: Props) {
  const [mode, setMode] = useState(0);
  const used = p.budgetTotal ? p.spent / p.budgetTotal : 0;
  const over = p.budgetTotal > 0 && p.spent > p.budgetTotal;
  const left = Math.max(0, p.budgetTotal - p.spent);
  const projDiff = p.budgetTotal - p.projected;
  const days = `${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"}`;

  const views = [
    over
      ? { label: "Over budget by", value: p.spent - p.budgetTotal, sub: `${Math.round(used * 100)}% of ${inr(p.budgetTotal)} used`, tone: "bad" }
      : p.budgetTotal > 0 && p.safePerDay === 0
        ? { label: "Budget used up", value: 0, sub: `${inr(p.upcomingTotal)} of bills still to come`, tone: "bad" }
        : { label: "Safe to spend today", value: p.safePerDay, sub: `a day for the next ${days}`, tone: "" },
    { label: over ? "Spent this month" : "Left this month", value: over ? p.spent : left, sub: over ? `against a ${inr(p.budgetTotal)} budget` : `of ${inr(p.budgetTotal)}`, tone: "" },
    { label: "Month-end forecast", value: p.projected, sub: projDiff >= 0 ? `${inr(projDiff)} under budget` : `${inr(-projDiff)} over budget`, tone: projDiff >= 0 ? "good" : "bad" },
  ];
  const v = views[mode];
  const next = () => setMode((m) => (m + 1) % views.length);
  const digits = inr(v.value).length; // "₹45,578" → 7
  const size = digits >= 9 ? "xl" : digits >= 7 ? "lg" : "";

  const stats: { v?: number; t?: string; l: string }[] = over
    ? [{ v: p.spent, l: "Spent" }, { v: p.budgetTotal, l: "Budget" }, { t: days, l: "Left in month" }]
    : [{ v: left, l: "Left" }, { t: `${Math.round(used * 100)}%`, l: "Used" }, p.upcomingTotal > 0 ? { v: p.upcomingTotal, l: "Bills due" } : { t: days, l: "Left in month" }];

  return (
    <section
      className={`hero o1 hero-tap${over ? " is-over" : ""}`}
      aria-label="Budget at a glance"
      role="button"
      tabIndex={0}
      onClick={next}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") { e.preventDefault(); next(); }
        if (e.key === "ArrowLeft") { e.preventDefault(); setMode((m) => (m + views.length - 1) % views.length); }
      }}
    >
      <div className="gauge">
        <GaugeArc used={mode === 2 ? (p.budgetTotal ? p.projected / p.budgetTotal : 0) : used} pace={p.pace} />
        <div className="center">
          <div className="eyebrow" key={"l" + mode} style={{ animation: "rise-in .35s var(--ease-out) both" }}>{v.label}</div>
          <div className={`big shimmer-text ${size}`}><CountUp value={v.value} /></div>
          <div className={`per ${v.tone}`} key={"s" + mode} style={{ animation: "rise-in .35s var(--ease-out) .05s both" }}>{v.sub}</div>
        </div>
      </div>
      <div className="hero-stats">
        {stats.map((s) => (
          <div key={s.l}><b>{s.v !== undefined ? <CountUp value={s.v} compact /> : s.t}</b><span>{s.l}</span></div>
        ))}
      </div>
      {over ? (
        <p className="hero-note">Keep to essentials for the next {days}.</p>
      ) : p.budgetTotal > 0 && p.pace > 0 ? (
        <div className="center-row" style={{ gap: 12, alignItems: "center" }}>
          <span className={`chip ${p.paceDiff >= 0 ? "good" : "bad"}`} title="Compared with an even spread of your budget across the month">
            {p.paceDiff >= 0 ? `▼ ${inr(p.paceDiff)} less than planned by today` : `▲ ${inr(-p.paceDiff)} more than planned by today`}
          </span>
        </div>
      ) : null}
      <div className="hero-dots" aria-hidden="true">
        {views.map((_, i) => <i key={i} className={i === mode ? "on" : ""} />)}
        <span className="hint">Tap to switch</span>
      </div>
    </section>
  );
}
