"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadSampleData } from "@/app/actions";
import { useApp } from "../app";

export default function GetStarted() {
  const { openAdd, toast } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <section className="stack getstarted">
      <div className="hero gs-hero" style={{ padding: 24 }}>
        <div className="eyebrow">Welcome to Expensly · step 1 of 4</div>
        <h1 style={{ fontSize: 30, margin: "8px 0 6px" }}>Let&apos;s find out what&apos;s safe to spend today.</h1>
        <p className="muted">Bring in your spending any of these ways. You can mix them; duplicates are caught.</p>
      </div>
      <button className="tile-btn" onClick={() => openAdd("statement")}>
        <span className="glyph-box" style={{ background: "color-mix(in srgb, var(--accent-2) 16%, transparent)", color: "var(--accent-2)" }}>↧</span>
        <span><b>Import a statement</b><small>Bank or card (including CRED cards) · CSV, PDF or text</small></span>
      </button>
      <button className="tile-btn" onClick={() => openAdd("sms")}>
        <span className="glyph-box" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>✉</span>
        <span><b>Paste bank SMS</b><small>UPI and card alerts, as many as you like</small></span>
      </button>
      <button className="tile-btn" onClick={() => openAdd("quick")}>
        <span className="glyph-box" style={{ background: "color-mix(in srgb, var(--good) 16%, transparent)", color: "var(--good)" }}>+</span>
        <span><b>Type a few spends</b><small>“chai 20, auto 60, swiggy 340”</small></span>
      </button>
      <button
        className="btn ghost gs-sample"
        disabled={pending}
        onClick={() => start(async () => { const r = await loadSampleData(); if (r.ok) { router.refresh(); toast("Sample data loaded. Remove it any time in Settings."); } else toast(r.error); })}
      >
        {pending ? "Loading sample data…" : "Explore with sample data first"}
      </button>
    </section>
  );
}
