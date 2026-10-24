"use client";

import AskChat from "./AskChat";

/** The AI section. AI runs on the app's central key; the bar shows today's usage against the limit. */
export default function AskView({ ai, initial, usage }: { ai: string | null; initial?: string; usage: { today: number; limit: number; enabled: boolean } }) {
  const on = ai && usage.enabled;
  const tone = usage.today >= usage.limit ? "bad" : usage.today >= usage.limit * 0.8 ? "warn" : "good";
  return (
    <>
      <div className="ai-bar">
        <span className="ai-dot" style={{ background: on ? "var(--good)" : "var(--muted)" }} aria-hidden="true" />
        <span className="grow">
          <b>{on ? "AI on" : "Basic answers"}</b>
          <span className="hint">{on ? ` · ${Math.max(0, usage.limit - usage.today)} of ${usage.limit} questions left today` : !usage.enabled ? " · AI is switched off for your account" : " · AI isn't set up yet"}</span>
        </span>
        {on && <span className={`chip ${tone}`} title="Resets at midnight">{usage.today}/{usage.limit}</span>}
      </div>
      <AskChat initial={initial} />
    </>
  );
}
