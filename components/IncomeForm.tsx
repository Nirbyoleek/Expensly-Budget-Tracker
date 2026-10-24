"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveIncomePlan } from "@/app/actions";
import { useApp } from "@/components/app";
import { inr } from "@/lib/money";
import type { IncomePlan } from "@/lib/income";

const rupees = (s: string) => {
  const t = s.replace(/[,₹\s]/g, "").toLowerCase();
  const k = t.endsWith("k") ? 1000 : t.endsWith("l") ? 100000 : 1;
  const n = parseFloat(t.replace(/[kl]$/, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * k * 100) : NaN;
};

const ordinal = (n: number) => n + ([11, 12, 13].includes(n % 100) ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");

/** Monthly take-home, other regular income, payday and savings goal. */
export default function IncomeForm({ plan, seenSalary, onSaved, compact }: { plan: IncomePlan | null; seenSalary?: number | null; onSaved?: () => void; compact?: boolean }) {
  const { toast } = useApp();
  const router = useRouter();
  const [salary, setSalary] = useState(plan ? String(plan.salary_paise / 100) : seenSalary ? String(Math.round(seenSalary / 100)) : "");
  const [other, setOther] = useState(plan?.other_paise ? String(plan.other_paise / 100) : "");
  const [payday, setPayday] = useState(plan?.payday ? String(plan.payday) : "1");
  const [goal, setGoal] = useState(plan?.savings_goal_pct ?? 20);
  const [from, setFrom] = useState<"this" | "next">("this");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const s = rupees(salary || "0"), o = rupees(other || "0");
  const total = (Number.isNaN(s) ? 0 : s) + (Number.isNaN(o) ? 0 : o);

  const save = () => {
    if (Number.isNaN(s) || Number.isNaN(o)) return setError("Enter amounts in rupees, like 85000 or 85k.");
    if (!total) return setError("Enter your monthly take-home pay.");
    setError("");
    start(async () => {
      const r = await saveIncomePlan({ salary_paise: s, other_paise: o, payday: payday ? Number(payday) : null, savings_goal_pct: goal, from });
      if (!r.ok) return setError(r.error);
      router.refresh();
      toast(`Saved. Expensly now plans around ${inr(total)} a month.`);
      onSaved?.();
    });
  };

  return (
    <div className="stack income-form">
      <div className="btns">
        <label className="lbl" htmlFor="inc-salary">TAKE-HOME SALARY
          <input id="inc-salary" className="field num" inputMode="decimal" placeholder="85,000" value={salary} onChange={(e) => setSalary(e.target.value)} />
        </label>
        <label className="lbl" htmlFor="inc-payday">PAYDAY
          <select id="inc-payday" className="field" value={payday} onChange={(e) => setPayday(e.target.value)}>
            {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1 === 31 ? "Last day" : ordinal(i + 1)}</option>)}
          </select>
        </label>
      </div>
      <label className="lbl" htmlFor="inc-other">OTHER REGULAR INCOME · OPTIONAL
        <input id="inc-other" className="field num" inputMode="decimal" placeholder="Freelance, rent received, allowance…" value={other} onChange={(e) => setOther(e.target.value)} />
      </label>
      <label className="lbl" htmlFor="inc-goal">
        SAVINGS GOAL · <span className="num" style={{ color: "var(--fg)" }}>{goal}%{total ? ` = ${inr(Math.round((total * goal) / 100))} a month` : ""}</span>
        <input id="inc-goal" type="range" min={0} max={60} step={5} value={goal} onChange={(e) => setGoal(+e.target.value)} />
      </label>
      {!compact && plan && (
        <div className="seg" role="group" aria-label="Applies from">
          <button type="button" aria-pressed={from === "this"} onClick={() => setFrom("this")}>From this month</button>
          <button type="button" aria-pressed={from === "next"} onClick={() => setFrom("next")}>From next month</button>
        </div>
      )}
      <p className="hint">Use take-home pay, after tax and PF. Expensly compares it with the salary credits in your statements, so missing or late pay gets flagged.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" disabled={pending} onClick={save}>{pending ? "Saving…" : plan ? "Update income" : "Save income"}</button>
    </div>
  );
}
