"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SUGGESTIONS = ["How's my month going?", "Where can I cut back?", "Will I hit my savings goal?", "Any unusual charges?"];

/** The Overview entry point: questions open the full chat. */
export default function AskKosh() {
  const [q, setQ] = useState("");
  const router = useRouter();
  const go = (question: string) => question.trim() && router.push(`/ask?q=${encodeURIComponent(question.trim())}`);
  return (
    <section className="card">
      <div className="section-h"><h2>Ask Expensly</h2><span className="chip" style={{ color: "var(--accent)", background: "var(--accent-soft)" }}>✦ AI</span></div>
      <form className="ask" onSubmit={(e) => { e.preventDefault(); go(q); }}>
        <input id="ask-home" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Why did I spend more this month?" aria-label="Ask about your money" />
        <button>Ask</button>
      </form>
      <div className="sugg">
        {SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => go(s)}>{s}</button>)}
      </div>
    </section>
  );
}
