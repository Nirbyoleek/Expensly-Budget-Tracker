"use client";

import { useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import MerchantSheet from "@/components/MerchantSheet";
import IncomeForm from "@/components/IncomeForm";
import type { IncomePlan } from "@/lib/income";
import { CountUp, Sheet, useApp } from "@/components/app";
import { Ring } from "@/components/charts";
import { WEEKDAY_SHORT, type Alert, type Analysis, type CategoryBreakdown } from "@/lib/analytics";
import { monthLong, monthShort, shortDate } from "@/lib/dates";
import { inr, inrCompact } from "@/lib/money";
import { TAXONOMY_BY_ID, subName } from "@/lib/taxonomy";
import type { Transaction } from "@/lib/types";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const SCORE_COLOR = (s: number) => (s >= 80 ? "var(--good)" : s >= 65 ? "var(--accent)" : s >= 45 ? "var(--warn)" : "var(--bad)");
const ALERT_GLYPH: Record<Alert["kind"], [string, string]> = {
  unusual: ["▲", "var(--warn)"], duplicate: ["⧉", "var(--bad)"], new: ["✦", "var(--accent)"], price: ["↑", "var(--bad)"], fees: ["!", "var(--bad)"], big: ["●", "var(--accent)"],
};
const CADENCE: Record<string, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Every 3 months", yearly: "Yearly" };

function Spark({ values, color }: { values: number[]; color: string }) {
  const W = 72, H = 24, max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - 2 - (v / max) * (H - 4)}`).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ overflow: "visible", flex: "none" }}>
      <polyline className="m-draw" pathLength={100} points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={W} cy={H - 2 - (values[values.length - 1] / max) * (H - 4)} r="2.6" fill={color} />
    </svg>
  );
}

function Delta({ now, before, invert }: { now: number; before: number; invert?: boolean }) {
  if (before <= 0) return null;
  const d = now / before - 1;
  if (Math.abs(d) < 0.08) return <span className="chip">≈ usual</span>;
  const up = d > 0;
  return <span className={`chip ${up !== !!invert ? "bad" : "good"}`}>{up ? "▲" : "▼"} {Math.round(Math.abs(d) * 100)}%</span>;
}

export default function InsightsView({ a, plan, tx, budgetTotal, today, sample }: { a: Analysis; plan?: IncomePlan | null; tx: Transaction[]; budgetTotal: number; today: string; sample: boolean }) {
  const { cats } = useApp();
  const [merchant, setMerchant] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(a.breakdown[0]?.id ?? null);
  const [editIncome, setEditIncome] = useState(false);
  const inc = a.income;
  const cat = (id: string) => cats.find((c) => c.id === id);
  const spent = a.breakdown.reduce((s, b) => s + b.total, 0);
  const recurMonthly = a.recurring.filter((r) => r.category_id !== "invest").reduce((s, r) => s + r.monthly, 0);
  // Percentages are of what you earn: the planned income, or what actually came in if that's more.
  const s = { ...a.split, income: Math.max(a.split.income, inc?.plan?.total ?? 0) }, base = Math.max(s.income, s.needs + s.wants + s.avoidable + s.savings, 1);
  const weekMax = Math.max(1, ...a.weekday.avg);

  return (
    <>
      <Header title="Insights" subtitle={monthLong(today)} sample={sample} />

      <div className="ins-grid">
        <div className="ins-col">
        {/* health */}
        <section className="card ins-health o1">
          <div className="section-h"><h2>Money health</h2><span className="hint">Updated as you spend</span></div>
          <div className="health-top">
            <div className="health-ring">
              <Ring value={a.health.score / 100} color={SCORE_COLOR(a.health.score)} size={128} width={11} />
              <div><b className="num">{a.health.score}</b><span>{a.health.label}</span></div>
            </div>
            <ul className="health-parts">
              {a.health.parts.map((p, i) => (
                <li key={p.id} title={p.note}>
                  <div className="row"><span>{p.label}</span><span className="num hint">{p.score}/{p.max}</span></div>
                  <div className="bar thin"><i className="m-fill" style={{ width: pct(p.score / p.max), background: SCORE_COLOR((p.score / p.max) * 100), animationDelay: `${i * 70}ms` }} /></div>
                  <small>{p.note}</small>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* income */}
        <section className="card ins-income o2">
          <div className="section-h"><h2>Income & savings</h2><button className="link" onClick={() => setEditIncome(true)}>{inc ? "Edit" : "Add income"}</button></div>
          {inc ? (
            <>
              <div className="inc-stats">
                <div>
                  <span className="eyebrow">Monthly income</span>
                  <b className="num">{inr(inc.plan.total)}</b>
                  <small>{inc.plan.other_paise ? `${inrCompact(inc.plan.salary_paise)} salary + ${inrCompact(inc.plan.other_paise)} other` : "Salary"}{inc.extra > 0 ? ` · +${inrCompact(inc.extra)} extra this month` : ""}</small>
                </div>
                <div>
                  <span className="eyebrow">Salary</span>
                  <b className={inc.salaryArrived ? "good" : ""}>{inc.salaryArrived ? `✓ ${inc.salaryDate ? shortDate(inc.salaryDate) : "Received"}` : inc.daysToPayday === 0 ? "Due today" : inc.daysToPayday !== null ? `In ${inc.daysToPayday} day${inc.daysToPayday === 1 ? "" : "s"}` : "Not seen yet"}</b>
                  <small>{inc.salaryArrived ? `${inr(inc.salaryReceived || inc.plan.salary_paise)} credited` : inc.nextPayday ? `Payday ${shortDate(inc.nextPayday)}` : "Import a bank statement to match it"}</small>
                </div>
                <div>
                  <span className="eyebrow">Set to keep</span>
                  <b className={`num ${inc.goalGap >= 0 ? "good" : "bad"}`}><CountUp value={Math.max(0, inc.projectedLeft) + a.split.savings} /></b>
                  <small>{inc.projectedRate < 0 ? "spending more than you earn" : `${Math.round(inc.projectedRate * 100)}%`} · goal {inc.plan.savings_goal_pct}% ({inrCompact(inc.goal)})</small>
                </div>
                <div>
                  <span className="eyebrow">Daily allowance</span>
                  <b className="num">{inr(inc.dailyAllowance)}</b>
                  <small>everyday spend that still hits the goal</small>
                </div>
              </div>
              <div className="eyebrow" style={{ margin: "16px 0 8px" }}>Plan vs actual this month</div>
              {([["Needs", a.split.needs + a.split.avoidable, inc.targets.needs, "#3B8BF6"], ["Wants", a.split.wants, inc.targets.wants, "#E8508A"], ["Savings", Math.max(0, inc.projectedLeft) + a.split.savings, inc.targets.savings, "#3DDC97"]] as const).map(([k, v, target, c], i) => {
                const over = k !== "Savings" ? v > target : v < target;
                return (
                  <div key={k} className="target-row">
                    <div className="row hint"><span><b style={{ color: "var(--fg)" }}>{k}</b> {k === "Savings" ? "projected" : "so far"}</span><span className="num">{inr(v)} <span className={over ? "bad" : "good"}>/ {inr(target)}</span></span></div>
                    <div className="bar thin">
                      <i className="m-fill" style={{ width: pct(Math.min(1, v / Math.max(1, target * 1.25))), background: c, animationDelay: `${i * 80}ms` }} />
                      <span className="pm" style={{ left: "80%" }} title="Target" />
                    </div>
                  </div>
                );
              })}
              {inc.history.some((h) => h.amount > 0) && (
                <>
                  <div className="eyebrow" style={{ margin: "16px 0 8px" }}>Salary credits, 6 months</div>
                  <div className="mbars" style={{ height: 70 }}>
                    {inc.history.map((h, i) => (
                      <div key={h.month} className="mbar" title={`${monthShort(h.month)}: ${inr(h.amount)}`}>
                        <i className="m-grow" style={{ height: `${Math.max(h.amount ? 8 : 3, (h.amount / Math.max(1, ...inc.history.map((x) => x.amount), inc.plan.salary_paise)) * 100)}%`, background: h.amount ? "var(--good)" : "var(--line-2)", animationDelay: `${i * 50}ms` }} />
                        <span>{monthShort(h.month)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="inc-cta">
              <p>Add your monthly salary and Expensly can forecast how much you'll save, give you a daily spending allowance, warn you when salary is late and compare your spending with a 50/30/20 plan.</p>
              <button className="btn" onClick={() => setEditIncome(true)}>Add monthly income</button>
            </div>
          )}
        </section>

        {/* needs / wants / savings */}
        <section className="card ins-split o3">
          <div className="section-h"><h2>Needs, wants & savings</h2><span className="hint">50 / 30 / 20 is a good guide</span></div>
          <div className="nw-bar" role="img" aria-label={`Needs ${inr(s.needs)}, wants ${inr(s.wants)}, fees ${inr(s.avoidable)}, invested ${inr(s.savings)}${s.income ? ` of ${inr(s.income)} income` : ""}`}>
            {([["Needs", s.needs, "#3B8BF6"], ["Wants", s.wants, "#E8508A"], ["Fees", s.avoidable, "#EF4444"], ["Invested", s.savings, "#3DDC97"]] as const).map(([k, v, c]) =>
              v > 0 ? <i key={k} className="m-fill" style={{ width: pct(v / base), background: c }} title={`${k} ${inr(v)}`} /> : null,
            )}
            {s.income > 0 && <><span className="mark" style={{ left: "50%" }} /><span className="mark" style={{ left: "80%" }} /></>}
          </div>
          <div className="nw-legend">
            {([["Needs", s.needs, a.splitLast.needs, "#3B8BF6", "Rent, bills, groceries, transport, health"], ["Wants", s.wants, a.splitLast.wants, "#E8508A", "Eating out, shopping, fun, subscriptions"], ["Fees", s.avoidable, a.splitLast.avoidable, "#EF4444", "Interest, GST and card charges"], ["Invested", s.savings, a.splitLast.savings, "#3DDC97", "SIPs, stocks, deposits"]] as const).map(([k, v, last, c, d]) => (
              <div key={k} title={d}>
                <span className="eyebrow"><span className="dot" style={{ background: c }} /> {k}</span>
                <b className="num">{inr(v)}</b>
                <small>{s.income ? `${pct(v / s.income)} of income` : d}{last > 0 ? ` · last month ${inrCompact(last)}` : ""}</small>
              </div>
            ))}
          </div>
        </section>

        {/* categories with subcategories */}
        <section className="card ins-break o5">
          <div className="section-h"><h2>Where it went</h2><span className="hint num">{inr(spent)} this month</span></div>
          <div className="breakdown">
            {a.breakdown.map((b) => <BreakdownRow key={b.id} b={b} spent={spent} open={open === b.id} onToggle={() => setOpen(open === b.id ? null : b.id)} onMerchant={setMerchant} />)}
          </div>
        </section>

        {/* rhythm */}
        <section className="card ins-rhythm o8">
          <div className="section-h"><h2>Your spending rhythm</h2><span className="hint">everyday spends, 90 days</span></div>
          <div className="week">
            {a.weekday.avg.map((v, i) => (
              <div key={i} className={`wk${i === a.weekday.peak ? " peak" : ""}`} title={`${WEEKDAY_SHORT[i]}: ${inr(v)} on an average day`}>
                <span className="num">{inrCompact(v)}</span>
                <i className="m-grow" style={{ height: `${Math.max(4, (v / weekMax) * 100)}%`, animationDelay: `${i * 50}ms` }} />
                <small>{WEEKDAY_SHORT[i]}</small>
              </div>
            ))}
          </div>
          <div className="rhythm-stats">
            <div><span className="eyebrow">Weekend vs weekday</span><b className="num">{a.weekday.weekendRatio ? `${a.weekday.weekendRatio.toFixed(1)}×` : "—"}</b></div>
            <div><span className="eyebrow">No-spend streak</span><b className="num">{a.streaks.current} day{a.streaks.current === 1 ? "" : "s"}</b><small>best {a.streaks.longest} this month</small></div>
            <div><span className="eyebrow">No-spend days</span><b className="num">{a.streaks.days}</b></div>
          </div>
          {a.thirds && (
            <>
              <div className="eyebrow" style={{ marginTop: 16 }}>When in the month</div>
              <div className="thirds">
                {["1–10", "11–20", "21–31"].map((l, i) => (
                  <div key={l} style={{ flex: a.thirds![i] }}><i className="m-fill" style={{ opacity: 0.45 + a.thirds![i] }} /><small>{l} · {pct(a.thirds![i])}</small></div>
                ))}
              </div>
            </>
          )}
        </section>

        </div>
        <div className="ins-col">
        {/* story */}
        <section className="card ins-story o2">
          <div className="section-h"><h2>Your month in words</h2><Link className="link" href={`/ask?q=${encodeURIComponent("Explain my month so far and the 3 most useful things I could change")}`}>✦ Ask AI</Link></div>
          {a.story.length ? (
            <ol className="story">
              {a.story.map((line, i) => <li key={i} className="m-rise" style={{ animationDelay: `${120 + i * 80}ms` }}>{line}</li>)}
            </ol>
          ) : <p className="empty">Spend a little and Expensly will tell the story.</p>}
          <div className="forecast">
            <div className="row"><span className="eyebrow">Month-end forecast</span><b className="num"><CountUp value={a.forecast.total} /></b></div>
            <div className="fc-bar" role="img" aria-label={`Spent ${inr(a.forecast.spent)}, everyday spend ahead ${inr(a.forecast.everyday)}, bills due ${inr(a.forecast.dueTotal)}`}>
              {[["spent", a.forecast.spent, "var(--accent)"], ["ahead", a.forecast.everyday, "color-mix(in srgb, var(--accent) 45%, transparent)"], ["due", a.forecast.dueTotal, "var(--accent-2)"]].map(([k, v, c]) => (
                <i key={k as string} className="m-fill" style={{ width: pct((v as number) / Math.max(a.forecast.total, budgetTotal, 1)), background: c as string }} />
              ))}
              {budgetTotal > 0 && <span className="pm" style={{ left: pct(Math.min(1, budgetTotal / Math.max(a.forecast.total, budgetTotal))) }} title="Budget" />}
            </div>
            <div className="legend-row hint">
              <span><span className="dot" style={{ background: "var(--accent)" }} /> Spent {inrCompact(a.forecast.spent)}</span>
              <span><span className="dot" style={{ background: "color-mix(in srgb, var(--accent) 45%, transparent)" }} /> Everyday ahead {inrCompact(a.forecast.everyday)}</span>
              <span><span className="dot" style={{ background: "var(--accent-2)" }} /> Bills due {inrCompact(a.forecast.dueTotal)}</span>
              {budgetTotal > 0 && <span>│ Budget {inrCompact(budgetTotal)}</span>}
            </div>
          </div>
        </section>

        {/* alerts */}
        <section className="card ins-alerts o4">
          <div className="section-h"><h2>Worth a look</h2><span className="hint">{a.alerts.length || "Nothing"} flagged</span></div>
          {a.alerts.length ? (
            <div className="alerts">
              {a.alerts.slice(0, 6).map((x) => {
                const [g, c] = ALERT_GLYPH[x.kind];
                const inner = (
                  <>
                    <span className="glyph" style={{ background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }}>{g}</span>
                    <span><b>{x.title}</b><p>{x.body}</p></span>
                  </>
                );
                return x.tx ? <button key={x.id} className="alert" onClick={() => setMerchant(x.tx!.merchant_name)}>{inner}</button> : <div key={x.id} className="alert">{inner}</div>;
              })}
            </div>
          ) : <p className="empty">No odd charges, double payments or price rises. Expensly keeps watching.</p>}
        </section>

        {/* recurring */}
        <section className="card ins-recur o6" id="recurring">
          <div className="section-h"><h2>Subscriptions & bills</h2><span className="hint num">{inr(recurMonthly)}/mo · {inrCompact(recurMonthly * 12)}/yr</span></div>
          {a.recurring.length ? (
            <div>
              {a.recurring.map((r) => {
                const c = cat(r.category_id);
                const days = Math.round((Date.parse(r.next) - Date.parse(today)) / 86400000);
                return (
                  <button key={r.key} className="list-row as-btn" onClick={() => setMerchant(r.name)}>
                    <span className="dot" style={{ background: c?.color }} />
                    <span className="grow">
                      <b className="ellipsis">{r.name}</b>
                      <span className="hint">{CADENCE[r.cadence]}{subName(r.category_id, r.subcategory_id) ? ` · ${subName(r.category_id, r.subcategory_id)}` : ""} · next {days <= 0 ? "today" : days === 1 ? "tomorrow" : days <= 7 ? `in ${days} days` : shortDate(r.next)}</span>
                    </span>
                    {r.priceChange && r.priceChange.to > r.priceChange.from && <span className="chip bad">▲ {inr(r.priceChange.to - r.priceChange.from)}</span>}
                    {r.dueSoon && !r.priceChange && <span className="chip warn">Soon</span>}
                    <span className="num">{r.variable ? "~" : ""}{inr(r.amount)}</span>
                  </button>
                );
              })}
            </div>
          ) : <p className="empty">Expensly spots subscriptions after two charges.</p>}
        </section>

        {/* merchants */}
        <section className="card ins-merch o7">
          <div className="section-h"><h2>Top merchants</h2><span className="hint">last 6 months</span></div>
          {a.merchants.slice(0, 10).map((m, i) => {
            const c = cat(m.category_id);
            return (
              <button key={m.key} className="list-row as-btn m-rise" style={{ animationDelay: `${i * 40}ms` }} onClick={() => setMerchant(m.name)}>
                <span className="rank num">{i + 1}</span>
                <span className="grow">
                  <b className="ellipsis">{m.name}</b>
                  <span className="hint">{subName(m.category_id, m.subcategory_id) ?? c?.name} · {m.count}× · avg {inrCompact(m.avg)}</span>
                </span>
                <Spark values={m.byMonth} color={c?.color ?? "var(--accent)"} />
                <span className="num merch-total">{inrCompact(m.total)}</span>
              </button>
            );
          })}
        </section>

        {/* fees */}
        <section className="card ins-fees o9">
          <div className="section-h"><h2>Fees & interest</h2><span className="hint">6 months</span></div>
          {a.fees.total > 0 ? (
            <>
              <div className="fees-big"><b className="num bad"><CountUp value={a.fees.total} /></b><span className="hint">paid for nothing in return{a.fees.thisMonth ? ` · ${inr(a.fees.thisMonth)} this month` : ""}</span></div>
              {a.fees.bySub.map((f) => (
                <div key={f.id} className="list-row"><span className="grow">{f.name}</span><span className="num">{inr(f.total)}</span></div>
              ))}
              <p className="hint" style={{ marginTop: 10 }}>Card interest is usually 3.5–3.75% a month. Paying the full bill, not the minimum, stops it, and the GST charged on it.</p>
            </>
          ) : <p className="empty">No interest, late fees or forex charges in six months. 👏</p>}
        </section>

        {/* biggest */}
        <section className="card ins-big o10">
          <div className="section-h"><h2>Biggest this month</h2><Link className="link" href="/activity">Activity</Link></div>
          {a.biggest.map((t) => (
            <button key={t.id} className="list-row as-btn" onClick={() => setMerchant(t.merchant_name)}>
              <span className="dot" style={{ background: cat(t.category_id)?.color }} />
              <span className="grow"><b className="ellipsis">{t.merchant_name}</b><span className="hint">{shortDate(t.date)} · {subName(t.category_id, t.subcategory_id) ?? cat(t.category_id)?.name}</span></span>
              <span className="num">{inr(-t.amount_paise)}</span>
            </button>
          ))}
          {!a.biggest.length && <p className="empty">Nothing yet.</p>}
        </section>
        </div>
      </div>

      {editIncome && (
        <Sheet title="Your monthly income" onClose={() => setEditIncome(false)}>
          <IncomeForm plan={plan ?? null} seenSalary={tx.find((t) => t.category_id === "income" && t.subcategory_id === "salary")?.amount_paise ?? null} onSaved={() => setEditIncome(false)} />
        </Sheet>
      )}
      {merchant && <MerchantSheet name={merchant} tx={tx} onClose={() => setMerchant(null)} />}
    </>
  );
}

function BreakdownRow({ b, spent, open, onToggle, onMerchant }: { b: CategoryBreakdown; spent: number; open: boolean; onToggle: () => void; onMerchant: (n: string) => void }) {
  const def = TAXONOMY_BY_ID[b.id];
  const shades = (i: number) => `color-mix(in srgb, ${b.color} ${100 - i * 18}%, var(--surface-2))`;
  return (
    <div className={`brk${open ? " open" : ""}`}>
      <button className="brk-head" aria-expanded={open} onClick={onToggle}>
        <span className="dot" style={{ background: b.color }} />
        <span className="grow">
          <b>{b.name}</b>
          <span className="hint">{b.count} payment{b.count === 1 ? "" : "s"}{spent ? ` · ${pct(b.total / spent)}` : ""}{b.avg3 ? ` · 3-mo avg ${inrCompact(b.avg3)}` : ""}</span>
        </span>
        <Delta now={b.total} before={b.lastMonthToDate} />
        <span className="num">{inr(b.total)}</span>
        <svg className="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <div className="sub-bar" aria-hidden="true">
        {b.subs.map((s, i) => <i key={s.id ?? "x"} style={{ flex: s.total, background: shades(i) }} />)}
      </div>
      {open && (
        <div className="brk-body">
          {b.subs.map((s, i) => (
            <Link key={s.id ?? "x"} className="list-row" href={`/activity?cat=${b.id}${s.id ? `&sub=${s.id}` : ""}`}>
              <span className="dot" style={{ background: shades(i) }} />
              <span className="grow">{s.name}<span className="hint"> · {s.count}×</span></span>
              <span className="num">{inr(s.total)}</span>
            </Link>
          ))}
          {b.topMerchants.length > 0 && (
            <div className="chips">
              {b.topMerchants.map((m) => (
                <button key={m.name} className="mchip" onClick={() => onMerchant(m.name)}>{m.name} <span className="num">{inrCompact(m.total)}</span></button>
              ))}
            </div>
          )}
          {def?.group && <p className="hint">Counted as a {def.group === "avoidable" ? "fee" : def.group.replace(/s$/, "")}.</p>}
        </div>
      )}
    </div>
  );
}
