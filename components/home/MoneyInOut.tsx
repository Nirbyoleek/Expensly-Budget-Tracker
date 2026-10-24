import Link from "next/link";
import { inr } from "@/lib/money";
import type { MoneyIn } from "@/lib/finance";

/**
 * Credits and debits side by side. Refunds and money back from friends are shown as money in,
 * then taken off what you spent, so "spent" is what actually left your pocket.
 */
export default function MoneyInOut({ inflow, gross, net, className = "" }: { inflow: MoneyIn; gross: number; net: number; className?: string }) {
  const offsets = gross - net;
  const rows: { label: string; value: number; hint: string }[] = [
    { label: "Income", value: inflow.income, hint: "Salary, interest, cashback and other earnings" },
    { label: "Refunds", value: inflow.refunds, hint: "Taken off the category they came back to" },
    { label: "Back from people", value: inflow.fromPeople, hint: "Splits and paybacks, taken off what you sent to people" },
    { label: "Own transfers & card payments", value: inflow.transfers, hint: "Not counted as income or spending" },
    { label: "Investments redeemed", value: inflow.investments, hint: "Money back from investments" },
  ].filter((r) => r.value > 0);
  const kept = inflow.income - net;

  return (
    <section className={`card ${className}`}>
      <div className="section-h">
        <h2>Money in &amp; out</h2>
        <Link className="link" href="/activity?filter=in">{inflow.count} credit{inflow.count === 1 ? "" : "s"}</Link>
      </div>
      <div className="mstats" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div><span className="eyebrow">Came in</span><b className="num good">{inr(inflow.total)}</b><small>all credits</small></div>
        <div><span className="eyebrow">Actually spent</span><b className="num">{inr(net)}</b><small>{offsets > 0 ? `${inr(gross)} out − ${inr(offsets)} back` : "after refunds"}</small></div>
      </div>
      {rows.length ? (
        <div className="mlist" style={{ marginTop: 8 }}>
          {rows.map((r) => (
            <div key={r.label} className="list-row">
              <span className="grow"><b style={{ fontWeight: 600 }}>{r.label}</b><span className="hint">{r.hint}</span></span>
              <span className="num good">+{inr(r.value)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty">No money has come in this month yet. Import a bank statement to see credits too; card statements mostly show spends.</p>
      )}
      {inflow.income > 0 && (
        <p className="hint" style={{ marginTop: 8 }}>
          {kept >= 0 ? `You've kept ${inr(kept)} of this month's income so far.` : `You've spent ${inr(-kept)} more than you earned this month.`}
        </p>
      )}
    </section>
  );
}
