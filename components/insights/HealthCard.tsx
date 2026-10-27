"use client";

import { useState } from "react";
import Link from "next/link";
import { Ring } from "@/components/charts";
import type { Analysis, HealthStatus } from "@/lib/analytics";

const STATUS: Record<HealthStatus, { word: string; tone: string }> = {
  great: { word: "Great", tone: "good" },
  ok: { word: "Okay", tone: "warn" },
  work: { word: "Needs work", tone: "bad" },
  unknown: { word: "Not enough data", tone: "muted" },
};
const SCORE_COLOR = (s: number) => (s >= 80 ? "var(--good)" : s >= 65 ? "var(--accent)" : s >= 45 ? "var(--warn)" : "var(--bad)");
const BANDS = [[0, 45, "Needs attention"], [45, 65, "Fair"], [65, 80, "Healthy"], [80, 101, "Excellent"]] as const;

/**
 * Money health: one score out of 100, what's pulling it down, and the single change worth the most
 * points. Each part opens to show the target and what to do about it.
 */
export default function HealthCard({ health, prev, month }: { health: Analysis["health"]; prev: number | null; month: string }) {
  const [open, setOpen] = useState<string | null>(health.top?.id ?? null);
  const delta = prev === null ? null : health.score - prev;
  const prevName = new Date(`${month}T00:00:00Z`).toLocaleString("en-IN", { month: "long", timeZone: "UTC" });

  return (
    <section className="card ins-health o1" id="health" aria-labelledby="health-h">
      <div className="section-h"><h2 id="health-h">Money health</h2><span className="hint">Updated as you spend</span></div>

      <div className="health-head">
        <div className="health-ring" role="img" aria-label={`Money health ${health.score} out of 100, ${health.label}`}>
          <Ring value={Math.max(0.02, health.score / 100)} color={SCORE_COLOR(health.score)} size={120} width={11} />
          <div><b className="num">{health.score}</b><span>out of 100</span></div>
        </div>
        <div className="health-sum">
          <span className="health-label" style={{ color: SCORE_COLOR(health.score) }}>{health.label}</span>
          {delta !== null && (
            <span className={`chip ${delta > 0 ? "good" : delta < 0 ? "bad" : ""}`}>{delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {delta === 0 ? "Same as" : `${Math.abs(delta)} ${delta > 0 ? "up" : "down"} on`} {prevName}</span>
          )}
          <div className="health-scale" aria-hidden="true">
            {BANDS.map(([lo, hi, name]) => (
              <span key={name} className={health.score >= lo && health.score < hi ? "on" : ""} style={{ flex: hi - lo }} title={name} />
            ))}
            <i style={{ left: `${Math.min(99, health.score)}%` }} />
          </div>
          <div className="health-scale-labels" aria-hidden="true"><span>0</span><span>45</span><span>65</span><span>80</span><span>100</span></div>
        </div>
      </div>

      {health.top && (
        <div className="health-top-fix">
          <div className="eyebrow">Biggest win · up to +{health.top.gain} points</div>
          <b>{health.top.label}</b>
          <p>{health.top.fix}</p>
          {health.top.href && health.top.action && <Link className="btn sm" href={health.top.href}>{health.top.action} →</Link>}
        </div>
      )}

      <ul className="health-list">
        {health.parts.map((p, i) => {
          const s = STATUS[p.status];
          const isOpen = open === p.id;
          return (
            <li key={p.id} className={isOpen ? "open" : ""}>
              <button className="health-row" aria-expanded={isOpen} aria-controls={`hp-${p.id}`} onClick={() => setOpen(isOpen ? null : p.id)}>
                <span className={`hdot ${s.tone}`} aria-hidden="true" />
                <span className="hname">{p.label}<small className={s.tone}>{s.word}</small></span>
                <span className="hval num">{p.value}</span>
                <span className="hpts num">{p.score}<small>/{p.max}</small></span>
                <span className="hchev" aria-hidden="true">›</span>
              </button>
              <div className="bar thin"><i className="m-fill" style={{ width: `${Math.max(3, (p.score / p.max) * 100)}%`, background: s.tone === "muted" ? "var(--muted)" : `var(--${s.tone})`, animationDelay: `${i * 60}ms` }} /></div>
              {isOpen && (
                <div className="health-detail" id={`hp-${p.id}`}>
                  <p>{p.note}</p>
                  <div className="health-target"><span className="eyebrow">Full marks</span><span>{p.target}</span></div>
                  {p.fix && <p className="health-fix">{p.fix}</p>}
                  {p.href && p.action && <Link className="link" href={p.href}>{p.action} →</Link>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="hint health-foot">Savings 30 · budgets 20 · fees 15 · wants 15 · investing 10 · up to date 10. Tap a row to see how to improve it.</p>
    </section>
  );
}
