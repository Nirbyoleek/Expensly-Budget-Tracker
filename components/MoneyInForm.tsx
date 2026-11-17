"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addMoneyIn } from "@/app/actions";
import { useApp } from "@/components/app";
import { inr, toPaise } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { MONEY_IN_SOURCES, subName, type MoneyInSource } from "@/lib/taxonomy";

const HINT: Partial<Record<MoneyInSource, string>> = {
  freelance: "Upwork client, side gig, your shop",
  family: "Mom, Dad, your brother",
  gifts: "Birthday, wedding shagun",
  sold: "OLX buyer, old phone",
  rent: "Tenant, PG room",
  cashback: "CRED, credit card rewards",
  interest: "Savings account, FD",
  dividend: "A company you hold shares in",
};

/**
 * Money you got from somewhere other than your salary. It's saved as income, and you can add it to
 * this month's budget so "safe to spend" grows with it. Salary stays under "Your income".
 */
export default function MoneyInForm({ onDone }: { onDone: () => void }) {
  const { toast } = useApp();
  const router = useRouter();
  const today = todayISO();
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<MoneyInSource | null>(null);
  const [from, setFrom] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [toBudget, setToBudget] = useState(true);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const rupees = parseFloat(amount.replace(/[,\s₹]/g, "").replace(/k$/i, "e3"));
  const paise = Number.isFinite(rupees) && rupees > 0 ? toPaise(rupees) : 0;
  const thisMonth = date.slice(0, 7) === today.slice(0, 7);

  const save = () => start(async () => {
    setError("");
    if (!paise) return setError("Enter how much you got.");
    if (!source) return setError("Pick where it came from.");
    const r = await addMoneyIn({ amount_paise: paise, source, from: from.trim() || null, date, note: note.trim() || null, adds_to_budget: toBudget && thisMonth });
    if (!r.ok) return setError(r.error);
    router.refresh();
    toast(
      toBudget && thisMonth && r.hasBudgets
        ? `+${inr(paise)} added. This month's budget is now ${inr(r.budgetTotal)}.`
        : toBudget && thisMonth
          ? `+${inr(paise)} added. Set budgets to have it raise what's safe to spend.`
          : `+${inr(paise)} added as money in.`,
    );
    onDone();
  });

  return (
    <div className="stack money-in">
      <label className="lbl" htmlFor="mi-amount">HOW MUCH DID YOU GET?
        <span className="amount-field">
          <span aria-hidden="true">₹</span>
          <input id="mi-amount" data-autofocus className="field num" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5,000" />
        </span>
      </label>

      <div className="lbl" id="mi-source-l">WHERE FROM?</div>
      <div className="catgrid" role="radiogroup" aria-labelledby="mi-source-l">
        {MONEY_IN_SOURCES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={source === s} aria-pressed={source === s} onClick={() => setSource(s)}>
            <span className="dot" style={{ background: "var(--good)" }} />{subName("income", s)}
          </button>
        ))}
      </div>
      <p className="hint">Salary isn&apos;t here: set it once under <b>Your income</b> in Settings and Expensly tracks it every month.</p>

      <label className="lbl" htmlFor="mi-from">FROM WHOM? (OPTIONAL)
        <input id="mi-from" className="field" value={from} onChange={(e) => setFrom(e.target.value)} maxLength={60} placeholder={source ? HINT[source] ?? "Who paid you" : "Who paid you"} autoComplete="off" />
      </label>

      <div className="mi-row">
        <label className="lbl" htmlFor="mi-date">DATE
          <input id="mi-date" className="field" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
        </label>
        <label className="lbl" htmlFor="mi-note">NOTE (OPTIONAL)
          <input id="mi-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. logo design" />
        </label>
      </div>

      <label className={`mi-toggle${!thisMonth ? " off" : ""}`}>
        <input type="checkbox" checked={toBudget && thisMonth} disabled={!thisMonth} onChange={(e) => setToBudget(e.target.checked)} />
        <span>
          <b>Add to this month&apos;s budget</b>
          <small>{thisMonth ? (paise ? `Raises what you can spend this month by ${inr(paise)}.` : "Raises what you can spend this month by this amount.") : "Only money from this month can be added to its budget."}</small>
        </span>
      </label>

      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" disabled={pending} onClick={save}>{pending ? "Saving…" : paise ? `Add +${inr(paise)}` : "Add money in"}</button>
    </div>
  );
}
