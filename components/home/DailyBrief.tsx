"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { getDailyBrief, type Brief } from "@/app/ai-actions";

const MOOD = { good: ["var(--good)", "On track"], watch: ["var(--warn)", "Worth watching"], alert: ["var(--bad)", "Needs attention"] } as const;

/** The AI's morning brief. Made once a day on first visit, then cached. */
export default function DailyBrief({ initial, aiOn }: { initial: Brief | null; aiOn: boolean }) {
  const [brief, setBrief] = useState<Brief | null>(initial);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const asked = useRef(false);

  const load = (refresh: boolean) =>
    start(async () => {
      setError("");
      const r = await getDailyBrief(refresh);
      if (r.ok) setBrief(r.brief);
      else setError(r.error);
    });

  useEffect(() => {
    if (!brief && aiOn && !asked.current) { asked.current = true; load(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!aiOn) return null;
  const [color, label] = MOOD[brief?.mood ?? "good"];

  return (
    <section className="card brief" style={{ ["--mood" as string]: color }}>
      <div className="section-h">
        <h2><span className="brief-spark" aria-hidden="true">✦</span> Today&apos;s brief</h2>
        {brief && <span className="chip" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>{label}</span>}
      </div>
      {brief ? (
        <div className={pending ? "brief-body dim" : "brief-body"}>
          <p className="brief-headline">{brief.headline}</p>
          <ul>{brief.points.map((p, i) => <li key={i} className="m-rise" style={{ animationDelay: `${i * 70}ms` }}>{p}</li>)}</ul>
          {brief.tip && <div className="brief-tip"><b>Today</b>{brief.tip}</div>}
          <div className="row">
            <Link className="link" href={`/ask?q=${encodeURIComponent("Tell me more about today's brief: " + brief.headline)}`}>Ask a follow-up →</Link>
            <button className="link muted-link" disabled={pending} onClick={() => load(true)}>{pending ? "Refreshing…" : "Refresh"}</button>
          </div>
        </div>
      ) : pending ? (
        <div className="brief-loading" aria-live="polite">
          <span className="shimmer-text">Reading your month…</span>
          <i /><i /><i />
        </div>
      ) : (
        <div className="stack">
          {error && <p className="hint">{error}</p>}
          <button className="btn ghost" onClick={() => load(false)}>Get today&apos;s brief</button>
        </div>
      )}
    </section>
  );
}
