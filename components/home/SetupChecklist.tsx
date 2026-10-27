"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { dismissOnboarding } from "@/app/notify-actions";
import { useApp } from "../app";

type Step = { id: string; title: string; why: string; done: boolean; href?: string; add?: "statement" };

/** First-week checklist on Overview: the four things that make Expensly useful. Hides when done or dismissed. */
export default function SetupChecklist({ hasData, hasIncome, hasBudgets, hasReminders }: { hasData: boolean; hasIncome: boolean; hasBudgets: boolean; hasReminders: boolean }) {
  const { openAdd } = useApp();
  const [hidden, setHidden] = useState(false);
  const [, start] = useTransition();
  const steps: Step[] = [
    { id: "data", title: "Bring in your spending", why: "Import a bank or card statement", done: hasData, add: "statement" },
    { id: "income", title: "Add your monthly income", why: "Unlocks your daily allowance and savings forecast", done: hasIncome, href: "/insights#income" },
    { id: "budgets", title: "Set your budgets", why: "One tap with Plan with AI, based on your last months", done: hasBudgets, href: "/budgets" },
    { id: "reminders", title: "Turn on reminders", why: "Budget warnings and bills due tomorrow", done: hasReminders, href: "/settings#notifications" },
  ];
  const done = steps.filter((s) => s.done).length;
  if (hidden || done === steps.length) return null;
  const next = steps.find((s) => !s.done)!;

  return (
    <section className="card setup o1">
      <div className="section-h">
        <h2>Finish setting up</h2>
        <button className="link muted-link" onClick={() => { setHidden(true); start(async () => { await dismissOnboarding(); }); }} aria-label="Hide the setup checklist">Hide</button>
      </div>
      <div className="setup-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label={`${done} of ${steps.length} done`}>
        {steps.map((s) => <i key={s.id} className={s.done ? "on" : ""} />)}
      </div>
      <p className="hint" style={{ margin: "6px 0 10px" }}>{done} of {steps.length} done</p>
      <ol className="setup-steps">
        {steps.map((s, i) => {
          const body = (
            <>
              <span className={`setup-n${s.done ? " done" : ""}`} aria-hidden="true">{s.done ? "✓" : i + 1}</span>
              <span className="setup-t"><b>{s.title}</b>{!s.done && <small>{s.why}</small>}</span>
              {!s.done && <span className="setup-go" aria-hidden="true">{s === next ? "Start →" : "→"}</span>}
            </>
          );
          const cls = `setup-step${s.done ? " done" : ""}${s === next ? " next" : ""}`;
          if (s.done) return <li key={s.id} className={cls}>{body}</li>;
          return (
            <li key={s.id}>
              {s.add ? <button type="button" className={cls} onClick={() => openAdd(s.add)}>{body}</button> : <Link href={s.href!} className={cls}>{body}</Link>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
