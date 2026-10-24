"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteEverything, loadSampleData, reclassifyAll, removeSampleData, signOut } from "@/app/actions";
import { useApp } from "@/components/app";
import Header from "@/components/Header";
import IncomeForm from "@/components/IncomeForm";
import PasswordCard from "./PasswordCard";
import NotificationsCard from "./NotificationsCard";
import HealthCard, { type HealthItem } from "./HealthCard";
import type { IncomePlan } from "@/lib/income";

export default function SettingsView({ email, hasSample, hasToken, origin, plan, seenSalary, notify, health }: { email: string; hasSample: boolean; hasToken: boolean; origin: string; plan?: IncomePlan | null; seenSalary?: number | null; notify: { budget: boolean; bills: boolean; weekly: boolean }; health?: HealthItem[] | null }) {
  const { toast, openAdd, cats } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmText, setConfirmText] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [error, setError] = useState("");
  const [recat, setRecat] = useState<{ changed: number; renamed: number; detailed: number; examples: { from: string; to: string; name: string }[] } | null>(null);
  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? id;

  const previewRecat = () =>
    start(async () => {
      const r = await reclassifyAll(true);
      if (!r.ok) return toast(r.error);
      setRecat(r);
    });
  const runRecat = () =>
    start(async () => {
      const r = await reclassifyAll(false);
      if (!r.ok) return toast(r.error);
      setRecat(null);
      router.refresh();
      toast(`Done: ${r.changed} re-filed, ${r.detailed} given a subcategory, ${r.renamed} renamed`);
    });

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (r && !r.ok) return toast(r.error ?? "Something went wrong.");
      router.refresh();
      toast(msg);
    });

  return (
    <>
      <Header title="Settings" />
      <div className="settings-grid">

      <section className="card stack">
        <div className="row"><div><div className="eyebrow">Signed in as</div><b>{email}</b></div>
          <form action={signOut}><button className="link">Sign out</button></form>
        </div>
      </section>

      <PasswordCard email={email} />

      <section className="card stack" id="income">
        <h2>Your income</h2>
        <p className="muted" style={{ fontSize: 14 }}>Your monthly take-home lets Expensly forecast savings, set a daily allowance, flag late salary and score your money health fairly. Change it any time; a raise can start next month without rewriting the past.</p>
        <IncomeForm plan={plan ?? null} seenSalary={seenSalary} />
      </section>

      <NotificationsCard prefs={notify} />

      {health && <HealthCard items={health} />}

      <section className="card stack">
        <h2>Re-categorise everything</h2>
        <p className="muted" style={{ fontSize: 14 }}>Run Expensly&apos;s latest categoriser over your imported transactions: cleaner names, detailed subcategories, fees and refunds picked out. Anything you&apos;ve reviewed keeps its category.</p>
        {recat ? (
          <>
            <div className="note">
              <b>{recat.changed + recat.detailed + recat.renamed ? "Here's what would change" : "Everything is already up to date"}</b>
              {recat.changed} moved to a better category · {recat.detailed} get a subcategory · {recat.renamed} get a cleaner name
              {recat.examples.length > 0 && (
                <ul className="why" style={{ marginTop: 8 }}>
                  {recat.examples.map((e, i) => <li key={i}>{e.name}: {catName(e.from)} → {catName(e.to)}</li>)}
                </ul>
              )}
            </div>
            <div className="btns">
              <button className="btn ghost" onClick={() => setRecat(null)}>Cancel</button>
              <button className="btn" disabled={pending || !(recat.changed + recat.detailed + recat.renamed)} onClick={runRecat}>{pending ? "Working…" : "Apply"}</button>
            </div>
          </>
        ) : (
          <button className="btn ghost" disabled={pending} onClick={previewRecat}>{pending ? "Checking…" : "Preview changes"}</button>
        )}
      </section>

      <section className="card stack">
        <h2>Sample data</h2>
        <p className="muted" style={{ fontSize: 14 }}>Four months of example spending, accounts and goals, so you can try every screen. Your own entries are never touched.</p>
        {hasSample ? (
          <button className="btn ghost" disabled={pending} onClick={() => act(removeSampleData, "Sample data removed")}>Remove sample data</button>
        ) : (
          <button className="btn ghost" disabled={pending} onClick={() => act(loadSampleData, "Sample data loaded")}>Load sample data</button>
        )}
      </section>

      <Link href="/settings/capture" className="card tile-link">
        <span className="glyph-box" aria-hidden="true">✉</span>
        <span><b>Track automatically from iPhone</b><small>Bank SMS land in Expensly within seconds, already sorted. Guided setup with a live check.</small></span>
        <span aria-hidden="true">›</span>
      </Link>

      <section className="card stack">
        <h2>Your data</h2>
        <button className="btn ghost" onClick={() => openAdd("statement")}>Import a statement</button>
        <a className="btn ghost" href="/api/export">Download transactions (CSV, opens in Excel)</a>
        <a className="btn ghost" href="/api/export?format=json">Download everything Expensly has about you (JSON)</a>
        <p className="hint">Your data is stored in Supabase (Mumbai region) and is only used to run Expensly for you. <a className="link" href="/privacy">How your data is handled</a></p>
        {!showDelete ? (
          <button className="link" style={{ color: "var(--bad)", alignSelf: "flex-start" }} onClick={() => setShowDelete(true)}>Delete my account…</button>
        ) : (
          <div className="note danger stack">
            <b>Delete your account and all your data?</b>
            <span>Your login, every transaction, budget, account, goal and reminder is removed for good, straight away. Download a copy first if you want one. Type DELETE to confirm.</span>
            <input id="confirm-delete" className="field" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" autoComplete="off" />
            {error && <p className="error">{error}</p>}
            <div className="btns">
              <button className="btn ghost" onClick={() => { setShowDelete(false); setConfirmText(""); }}>Cancel</button>
              <button className="btn danger" disabled={pending || confirmText.trim().toUpperCase() !== "DELETE"} onClick={() => start(async () => { const r = await deleteEverything(confirmText); if (r && !r.ok) setError(r.error); })}>Delete my account</button>
            </div>
          </div>
        )}
      </section>
      </div>
      <p className="hint" style={{ textAlign: "center" }}>Expensly v0.1 · statements are read on your device and never uploaded</p>
    </>
  );
}
