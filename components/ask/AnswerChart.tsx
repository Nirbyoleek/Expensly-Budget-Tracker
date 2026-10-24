"use client";

import { useState } from "react";
import { useWidth } from "@/components/charts/interactive";
import { inr, inrCompact } from "@/lib/money";

export type ChartSpec = { type?: "bar" | "line"; title?: string; data: { label: string; value: number }[] };

/** Validates what the model wrote; anything odd means no chart rather than a broken one. */
export function readChart(json: string): ChartSpec | null {
  try {
    const c = JSON.parse(json) as ChartSpec;
    const data = (Array.isArray(c.data) ? c.data : [])
      .filter((d) => d && typeof d.label === "string" && Number.isFinite(Number(d.value)))
      .slice(0, 12)
      .map((d) => ({ label: d.label.slice(0, 18), value: Number(d.value) }));
    if (data.length < 2) return null;
    return { type: c.type === "line" ? "line" : "bar", title: typeof c.title === "string" ? c.title.slice(0, 80) : undefined, data };
  } catch {
    return null;
  }
}

/** A small bar or line chart drawn inside an answer. Tap or hover a point to see its value. */
export default function AnswerChart({ spec }: { spec: ChartSpec }) {
  const [ref, w] = useWidth<HTMLDivElement>(300);
  const [sel, setSel] = useState<number | null>(null);
  const H = 150, top = 18, bottom = 24, n = spec.data.length;
  const max = Math.max(1, ...spec.data.map((d) => d.value));
  const y = (v: number) => top + (H - top - bottom) * (1 - Math.max(0, v) / max);
  const slot = w / n;
  const x = (i: number) => slot * i + slot / 2;
  const shown = sel ?? spec.data.reduce((best, d, i) => (d.value > spec.data[best].value ? i : best), 0);
  const label = (l: string) => (slot < 44 ? l.slice(0, 3) : slot < 70 ? l.slice(0, 8) : l);

  return (
    <figure className="answer-chart" ref={ref}>
      {spec.title && <figcaption>{spec.title}</figcaption>}
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`${spec.title ?? "Chart"}: ${spec.data.map((d) => `${d.label} ${inr(d.value * 100)}`).join(", ")}`}>
        {spec.type === "line" ? (
          <>
            <polyline className="m-draw" pathLength={100} points={spec.data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {spec.data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.value)} r={i === shown ? 5 : 3} fill={i === shown ? "var(--accent-2)" : "var(--accent)"} />)}
          </>
        ) : (
          spec.data.map((d, i) => {
            const bw = Math.min(36, slot * 0.62);
            return <rect key={i} className="m-grow" style={{ animationDelay: `${i * 40}ms` }} x={x(i) - bw / 2} y={y(d.value)} width={bw} height={Math.max(2, H - bottom - y(d.value))} rx={Math.min(7, bw / 3)} fill={i === shown ? "var(--accent-2)" : "color-mix(in srgb, var(--accent) 70%, transparent)"} />;
          })
        )}
        {spec.data.map((d, i) => (
          <text key={i} x={x(i)} y={H - 7} textAnchor="middle" fontSize="10.5" fill={i === shown ? "var(--fg)" : "var(--muted)"} fontWeight={i === shown ? 700 : 500}>{label(d.label)}</text>
        ))}
        <text x={Math.min(Math.max(x(shown), 30), w - 30)} y={Math.max(12, y(spec.data[shown].value) - 7)} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--fg)">{inrCompact(spec.data[shown].value * 100)}</text>
        {spec.data.map((_, i) => (
          <rect key={`h${i}`} x={slot * i} y={0} width={slot} height={H} fill="transparent" onMouseEnter={() => setSel(i)} onClick={() => setSel(i)} />
        ))}
      </svg>
    </figure>
  );
}
