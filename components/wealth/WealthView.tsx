"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { contributeToGoal, createGoal, deleteAccount, deleteGoal, saveAccount, setGoalLink } from "@/app/actions";
import { CatIcon, CountUp, Sheet, useApp } from "@/components/app";
import { Ring } from "@/components/charts";
import { TrendScrubber } from "@/components/charts/interactive";
import Header from "@/components/Header";
import { inr, inrCompact, toPaise } from "@/lib/money";
import { monthShort, shortDate } from "@/lib/dates";
import type { RecurringItem } from "@/lib/analytics";
import type { Account, AccountType, Goal } from "@/lib/types";

const TYPE_LABEL: Record<AccountType, string> = { bank: "Bank", card: "Credit cards", investment: "Investments", cash: "Cash", loan: "Loans" };
const TYPE_COLOR: Record<AccountType, string> = { bank: "#3B8BF6", card: "#F2683C", investment: "#7D8EFF", cash: "#E8A00B", loan: "#E8508A" };
type GoalProg = { saved: number; auto: number; count: number; last: string | null };
const CADENCE: Record<RecurringItem["cadence"], string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Every 3 months", yearly: "Yearly" };
const PER_YEAR: Record<RecurringItem["cadence"], number> = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 };

const GOAL_COLORS = ["#E8A00B", "#2FB673", "#3B8BF6", "#E8508A", "#7D8EFF", "#12B5B0"];

export default function WealthView(props: {
  accounts: Account[];
  goals: Goal[];
  trend: { month: string; value: number }[];
  progress: Record<string, GoalProg>;
  subscriptions: RecurringItem[];
  todayIso: string;
  sample: boolean;
}) {
  const { cats } = useApp();
  const [sheet, setSheet] = useState<{ kind: "account"; account?: Account } | { kind: "goal"; goal?: Goal } | null>(null);
  const assets = props.accounts.filter((a) => a.balance_paise > 0).reduce((s, a) => s + a.balance_paise, 0);
  const liabilities = -props.accounts.filter((a) => a.balance_paise < 0).reduce((s, a) => s + a.balance_paise, 0);
  const total = assets - liabilities;
  const prev = props.trend.length > 1 ? props.trend[props.trend.length - 2].value : null;
  const change = prev !== null ? total - prev : null;
  const groups = (Object.keys(TYPE_LABEL) as AccountType[]).map((t) => [t, props.accounts.filter((a) => a.type === t)] as const).filter(([, l]) => l.length);
  const subs = props.subscriptions;
  const recurTotal = subs.reduce((s, r) => s + r.monthly, 0);
  const yearTotal = subs.reduce((s, r) => s + r.amount * PER_YEAR[r.cadence], 0);
  const rises = subs.filter((r) => r.priceChange && r.priceChange.to > r.priceChange.from);
  const prog = (g: Goal) => props.progress[g.id] ?? { saved: g.saved_paise, auto: 0, count: 0, last: null };
  const catById = Object.fromEntries(cats.map((c) => [c.id, c]));

  return (
    <>
      <Header title="Wealth" sample={props.sample} />

      <div className="dash wealth-dash">
      <div className="col">
      <section className="hero o1" style={{ padding: 20 }}>
        <div className="eyebrow">Net worth</div>
        <div className="num" style={{ font: "800 42px/1.1 var(--display)", letterSpacing: "-0.03em", margin: "6px 0" }}>{total < 0 ? "−" : ""}<CountUp value={Math.abs(total)} /></div>
        {change !== null && prev ? (
          <span className={`chip ${change >= 0 ? "good" : "bad"}`}>{change >= 0 ? "▲" : "▼"} {inr(change)} · {((Math.abs(change) / Math.abs(prev)) * 100).toFixed(1)}% this month</span>
        ) : (
          <span className="hint">Update balances each month to see the trend.</span>
        )}
        <div style={{ marginTop: 14 }}><TrendScrubber points={props.trend} /></div>
        <div className="hero-stats two">
          <div><b>{inrCompact(assets)}</b><span>Assets</span></div>
          <div><b className="bad">{inrCompact(liabilities)}</b><span>Owed</span></div>
        </div>
      </section>

      <section className="o3">
        <div className="section-h"><h2>Goals</h2><span className="hint">{props.goals.filter((g) => prog(g).saved < g.target_paise).length} in progress</span></div>
        <div className="goals">
          {props.goals.map((g, gi) => {
            const saved = prog(g).saved;
            const done = saved >= g.target_paise;
            return (
              <div key={g.id} className="goal m-rise" style={{ animationDelay: `${120 + gi * 70}ms` }}>
                <div style={{ position: "relative", width: 64 }}>
                  <Ring value={Math.min(1, saved / g.target_paise)} color={g.color} />
                  <span className="num" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }}>{done ? "✓" : `${Math.round((saved / g.target_paise) * 100)}%`}</span>
                </div>
                <b className="ellipsis">{g.name}</b>
                <small className="num muted">{inr(saved)} / {inr(g.target_paise)}</small>
                <small className="muted">{g.link_kind ? <span className="autofill" title="Fills itself">⟳ </span> : null}{done ? "Goal reached" : g.target_date ? `By ${monthShort(g.target_date)} ${g.target_date.slice(0, 4)}` : "No deadline"}</small>
                <button className="addm" onClick={() => setSheet({ kind: "goal", goal: g })}>{done ? "Details" : "Add money"}</button>
              </div>
            );
          })}
          <button className="goal new" onClick={() => setSheet({ kind: "goal" })}>+ New goal</button>
        </div>
      </section>

      </div>
      <div className="col">
      <section className="card o2">
        <div className="section-h"><h2>Accounts</h2><button className="link" onClick={() => setSheet({ kind: "account" })}>Add account</button></div>
        {groups.length ? groups.map(([t, list]) => (
          <div key={t}>
            <div className="eyebrow" style={{ marginTop: 6 }}>{TYPE_LABEL[t]}</div>
            {list.map((a) => (
              <button key={a.id} className="list-row" style={{ width: "100%", background: "none", border: 0, borderBottom: "1px solid var(--line)", textAlign: "left", cursor: "pointer" }} onClick={() => setSheet({ kind: "account", account: a })}>
                <CatIcon name={a.name} color={TYPE_COLOR[a.type]} size="sm" />
                <div className="grow"><b className="ellipsis">{a.name}{a.last4 ? ` ··${a.last4}` : ""}</b><small className="muted">Updated {new Date(a.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</small></div>
                <b className={`num${a.balance_paise < 0 ? " bad" : ""}`}>{a.balance_paise < 0 ? "−" : ""}{inr(a.balance_paise)}</b>
              </button>
            ))}
          </div>
        )) : <p className="empty">Add your bank accounts, cards and investments to see your net worth. Balances are entered by hand and stay private.</p>}
      </section>

      <section className="card o4" id="recurring">
        <div className="section-h"><h2>Subscriptions &amp; bills</h2><span className="hint num">{inr(recurTotal)}/mo · {inrCompact(yearTotal)}/yr</span></div>
        {rises.length > 0 && (
          <div className="note warn" style={{ marginBottom: 8 }}>
            <b>{rises.length === 1 ? `${rises[0].name} costs more now` : `${rises.length} prices went up`}</b>
            {rises.map((r) => `${r.name}: ${inr(r.priceChange!.from)} → ${inr(r.priceChange!.to)}`).join(" · ")}. That&apos;s {inr(rises.reduce((s, r) => s + (r.priceChange!.to - r.priceChange!.from) * PER_YEAR[r.cadence], 0))} more a year.
          </div>
        )}
        {subs.length ? subs.map((r) => {
          const until = Math.round((Date.parse(r.next) - Date.parse(props.todayIso)) / 86400000);
          const up = !!r.priceChange && r.priceChange.to > r.priceChange.from;
          return (
            <div key={r.key} className="list-row sub-row">
              <CatIcon name={r.name} color={catById[r.category_id]?.color ?? "var(--muted)"} size="sm" />
              <div className="grow">
                <b className="ellipsis">{r.name}</b>
                <small className="muted">{CADENCE[r.cadence]} · last {shortDate(r.last)} · {until < 0 ? `was due ${shortDate(r.next)}` : until === 0 ? "due today" : until === 1 ? "due tomorrow" : `next ${shortDate(r.next)}`}</small>
              </div>
              {up ? <span className="chip bad">▲ {inr(r.priceChange!.to - r.priceChange!.from)}</span> : r.dueSoon ? <span className="chip warn">Soon</span> : null}
              <span className="num sub-amt"><b>{r.variable ? "~" : ""}{inr(r.amount)}</b><small className="muted">{inrCompact(r.amount * PER_YEAR[r.cadence])}/yr</small></span>
            </div>
          );
        }) : <p className="empty">Subscriptions, SIPs and bills appear here once the same charge shows up twice on a regular schedule.</p>}
      </section>


      </div>
      </div>

      {sheet?.kind === "account" && <AccountSheet account={sheet.account} onClose={() => setSheet(null)} />}
      {sheet?.kind === "goal" && (sheet.goal ? <FundGoalSheet goal={sheet.goal} prog={prog(sheet.goal)} onClose={() => setSheet(null)} /> : <NewGoalSheet onClose={() => setSheet(null)} />)}
    </>
  );
}


function useSubmit(onClose: () => void) {
  const { toast } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string } & object>, msg: string | ((r: object) => string)) =>
    start(async () => {
      setError("");
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      onClose();
      router.refresh();
      toast(typeof msg === "string" ? msg : msg(r));
    });
  return { pending, error, run };
}

function AccountSheet({ account, onClose }: { account?: Account; onClose: () => void }) {
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "bank");
  const [balance, setBalance] = useState(account ? String(Math.abs(account.balance_paise) / 100) : "");
  const [last4, setLast4] = useState(account?.last4 ?? "");
  const [confirm, setConfirm] = useState(false);
  const { pending, error, run } = useSubmit(onClose);
  const owed = type === "card" || type === "loan";

  return (
    <Sheet title={account ? "Edit account" : "Add account"} onClose={onClose}>
      <label className="lbl" htmlFor="acc-name">NAME<input id="acc-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="HDFC Savings" maxLength={60} /></label>
      <div className="lbl">TYPE</div>
      <div className="catgrid">
        {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => (
          <button key={t} type="button" aria-pressed={t === type} onClick={() => setType(t)}><span className="dot" style={{ background: TYPE_COLOR[t] }} />{TYPE_LABEL[t].replace(/s$/, "")}</button>
        ))}
      </div>
      <div className="btns">
        <label className="lbl" htmlFor="acc-bal">{owed ? "AMOUNT OWED (₹)" : "BALANCE (₹)"}<input id="acc-bal" className="field num" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0" /></label>
        <label className="lbl" htmlFor="acc-last4">LAST 4 DIGITS<input id="acc-last4" className="field num" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} placeholder="Optional" /></label>
      </div>
      <p className="hint">Expensly never connects to your bank. Update balances when you like; net worth is saved once a month for the trend.</p>
      {confirm && account && (
        <div className="note danger"><b>Delete {account.name}?</b>Its balance leaves your net worth. Transactions stay.
          <div className="btns" style={{ marginTop: 10 }}>
            <button className="btn ghost" onClick={() => setConfirm(false)}>Keep it</button>
            <button className="btn danger" disabled={pending} onClick={() => run(() => deleteAccount(account.id), "Account deleted")}>Delete</button>
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className={account ? "btns" : ""}>
        {account && <button className="btn ghost" onClick={() => setConfirm(true)}>Delete</button>}
        <button
          className="btn"
          disabled={pending || !name.trim()}
          onClick={() => run(() => saveAccount({ id: account?.id, name, type, balance_paise: toPaise(parseFloat(balance.replace(/,/g, "")) || 0), last4: last4 || null }), account ? "Account updated" : "Account added")}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </Sheet>
  );
}

function NewGoalSheet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [date, setDate] = useState("");
  const [color, setColor] = useState(GOAL_COLORS[0]);
  const [fill, setFill] = useState<Fill>("none");
  const [payee, setPayee] = useState("");
  const { pending, error, run } = useSubmit(onClose);
  return (
    <Sheet title="New goal" onClose={onClose}>
      <label className="lbl" htmlFor="goal-name">WHAT ARE YOU SAVING FOR?<input id="goal-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Goa trip" maxLength={60} /></label>
      <div className="btns">
        <label className="lbl" htmlFor="goal-target">TARGET (₹)<input id="goal-target" className="field num" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="40000" /></label>
        <label className="lbl" htmlFor="goal-date">BY<input id="goal-date" className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div className="lbl">COLOUR</div>
      <div style={{ display: "flex", gap: 10 }}>
        {GOAL_COLORS.map((c) => (
          <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={c === color} onClick={() => setColor(c)} style={{ width: 34, height: 34, borderRadius: 11, border: c === color ? "2px solid var(--fg)" : "1px solid var(--line)", background: c, cursor: "pointer" }} />
        ))}
      </div>
      <AutoFill fill={fill} setFill={setFill} payee={payee} setPayee={setPayee} />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" disabled={pending || !name.trim() || !(parseFloat(target) > 0) || (fill === "payee" && payee.trim().length < 2)} onClick={() => run(() => createGoal({ name, target_paise: toPaise(parseFloat(target.replace(/,/g, ""))), target_date: date || null, color, link: fill === "none" ? null : { kind: fill, value: fill === "payee" ? payee : null } }), `${name} added`)}>
        {pending ? "Saving…" : "Create goal"}
      </button>
    </Sheet>
  );
}

type Fill = "none" | "invest" | "payee";

function AutoFill({ fill, setFill, payee, setPayee }: { fill: Fill; setFill: (f: Fill) => void; payee: string; setPayee: (v: string) => void }) {
  return (
    <>
      <div className="lbl">FILL IT AUTOMATICALLY</div>
      <div className="seg" aria-label="Fill automatically">
        {([["none", "Off"], ["invest", "From my SIPs"], ["payee", "From a payee"]] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={fill === k} onClick={() => setFill(k)}>{l}</button>
        ))}
      </div>
      {fill === "payee" && <input className="field" aria-label="Payee name or UPI ID" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="e.g. Zerodha, HDFC RD, or a UPI ID" maxLength={60} />}
      {fill !== "none" && <p className="hint">{fill === "invest" ? "Every SIP or investment from today counts towards this goal." : "Every payment from today whose name or UPI ID contains this counts towards the goal."} Money you add by hand still counts too.</p>}
    </>
  );
}

function FundGoalSheet({ goal, prog, onClose }: { goal: Goal; prog: GoalProg; onClose: () => void }) {
  const { celebrate, toast } = useApp();
  const router = useRouter();
  const left = goal.target_paise - prog.saved;
  const [fill, setFill] = useState<Fill>(goal.link_kind ?? "none");
  const [payee, setPayee] = useState(goal.link_value ?? "");
  const [linkBusy, startLink] = useTransition();
  const linkChanged = fill !== (goal.link_kind ?? "none") || (fill === "payee" && payee.trim().toLowerCase() !== (goal.link_value ?? ""));
  const saveLink = () => startLink(async () => {
    const r = await setGoalLink(goal.id, fill === "none" ? null : { kind: fill, value: fill === "payee" ? payee : null });
    if (!r.ok) return toast(r.error);
    router.refresh();
    toast(fill === "none" ? "Auto-fill turned off" : "This goal now fills itself");
  });
  const [amount, setAmount] = useState(left > 0 ? String(Math.min(1000, left / 100)) : "");
  const [confirm, setConfirm] = useState(false);
  const { pending, error, run } = useSubmit(onClose);
  return (
    <Sheet title={goal.name} onClose={onClose}>
      <div className="row">
        <div><div className="eyebrow">Saved</div><div className="num" style={{ fontSize: 26, fontWeight: 600 }}>{inr(prog.saved)}</div><div className="hint">{left > 0 ? `${inr(left)} to go` : "Goal reached"}</div></div>
        <div style={{ position: "relative" }}><Ring value={Math.min(1, prog.saved / goal.target_paise)} color={goal.color} size={72} width={8} /></div>
      </div>
      {goal.link_kind && <p className="hint">⟳ {inr(prog.auto)} came in automatically from {prog.count} payment{prog.count === 1 ? "" : "s"}{prog.last ? `, latest ${shortDate(prog.last)}` : ""}. {inr(goal.saved_paise)} added by hand.</p>}
      <AutoFill fill={fill} setFill={setFill} payee={payee} setPayee={setPayee} />
      {linkChanged && <button className="btn ghost sm" disabled={linkBusy || (fill === "payee" && payee.trim().length < 2)} onClick={saveLink}>{linkBusy ? "Saving…" : "Save auto-fill"}</button>}
      {left > 0 && (
        <>
          <label className="lbl" htmlFor="fund-amt">ADD (₹)<input id="fund-amt" className="field num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <div className="sugg" style={{ marginTop: 0 }}>
            {[500, 1000, 5000].filter((v) => v * 100 <= left).map((v) => <button key={v} type="button" onClick={() => setAmount(String(v))}>{inr(v * 100)}</button>)}
            <button type="button" onClick={() => setAmount(String(left / 100))}>The rest · {inr(left)}</button>
          </div>
        </>
      )}
      {confirm && (
        <div className="note danger"><b>Delete {goal.name}?</b>The goal and its history go. Your money doesn&apos;t move.
          <div className="btns" style={{ marginTop: 10 }}>
            <button className="btn ghost" onClick={() => setConfirm(false)}>Keep it</button>
            <button className="btn danger" disabled={pending} onClick={() => run(() => deleteGoal(goal.id), "Goal deleted")}>Delete</button>
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="btns">
        <button className="btn ghost" onClick={() => setConfirm(true)}>Delete goal</button>
        {left > 0 && (
          <button
            className="btn"
            disabled={pending || !(parseFloat(amount) > 0)}
            onClick={() =>
              run(
                async () => {
                  const r = await contributeToGoal(goal.id, toPaise(parseFloat(amount.replace(/,/g, ""))));
                  if (r.ok && r.reached) setTimeout(celebrate, 300);
                  return r;
                },
                (r) => ("reached" in r && r.reached ? `${goal.name} reached!` : `Added to ${goal.name}`),
              )
            }
          >
            {pending ? "Saving…" : "Add money"}
          </button>
        )}
      </div>
    </Sheet>
  );
}
