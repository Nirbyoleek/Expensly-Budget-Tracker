import Link from "next/link";
import { CashFlow } from "@/components/charts/interactive";
import SafeHero from "./SafeHero";
import DailySpending, { type DailyMonth } from "./DailySpending";
import Header from "@/components/Header";
import AskKosh from "./AskKosh";
import DailyBrief from "./DailyBrief";
import MoneyInOut from "./MoneyInOut";
import SetupChecklist from "./SetupChecklist";
import type { Brief } from "@/app/ai-actions";
import { inr } from "@/lib/money";
import { monthLong } from "@/lib/dates";
import type { Insight, MonthView, Recurring } from "@/lib/finance";

const TONE: Record<Insight["tone"], string> = { good: "var(--good)", bad: "var(--bad)", warn: "var(--accent-2)", info: "var(--accent)" };

export default function HomeView(props: {
  v: MonthView & { recurring: Recurring[] };
  cashflow: { month: string; label: string; income: number; spent: number }[];
  daily: DailyMonth[];
  setup?: { hasData: boolean; hasIncome: boolean; hasBudgets: boolean; hasReminders: boolean } | null;
  insights: Insight[];
  sample: boolean;
  brief?: Brief | null;
  aiOn?: boolean;
}) {
  const { v } = props;

  const insightsBlock = (
    <section className="o2">
      <div className="section-h"><h2>Insights</h2><span className="hint">{props.insights.length} for you</span></div>
      <div className="rail insights-rail">
        {props.insights.map((x, i) => {
          const body = (
            <>
              <span className="glyph" style={{ background: `color-mix(in srgb, ${TONE[x.tone]} 16%, transparent)`, color: TONE[x.tone] }}>{x.glyph}</span>
              <span><b>{x.title}</b><p>{x.body}</p></span>
            </>
          );
          const st = { animationDelay: `${160 + i * 70}ms` };
          return x.href ? <Link key={x.id} href={x.href} className="insight m-rise" style={st}>{body}</Link> : <div key={x.id} className="insight m-rise" style={st}>{body}</div>;
        })}
      </div>
    </section>
  );

  return (
    <>
      <Header title="Overview" subtitle={monthLong(v.month)} sample={props.sample} />

      <div className="dash home-dash">
        <div className="col">
          <SafeHero
            safePerDay={v.safePerDay}
            daysLeft={v.daysLeft}
            budgetTotal={v.budgetTotal}
            spent={v.spent}
            upcomingTotal={v.upcomingTotal}
            projected={v.projected}
            pace={v.pace}
            paceDiff={v.paceDiff}
          />
          {props.setup && <SetupChecklist {...props.setup} />}

          <DailySpending months={props.daily} current={v.month} today={v.day} />
        </div>

        <div className="col">
          {props.aiOn && <div className="o2"><DailyBrief initial={props.brief ?? null} aiOn /></div>}
          {insightsBlock}

          <MoneyInOut className="o3" inflow={v.moneyIn} gross={v.grossSpent} net={v.spent} />


          <section className="card o5">
            <div className="section-h">
              <h2>Cash flow</h2>
              <span className="hint"><span className="dot" style={{ background: "var(--good)" }} /> In &nbsp; <span className="dot" style={{ background: "var(--accent)" }} /> Out</span>
            </div>
            <CashFlow data={props.cashflow} />
          </section>
        </div>

        <div className="col-full">
          {v.upcomingBills.length > 0 && (
            <section className="o6">
              <div className="section-h"><h2>Coming up</h2><Link className="link" href="/insights#recurring">All recurring</Link></div>
              <div className="rail bills-rail">
                {v.upcomingBills.map((r, i) => {
                  const inDays = r.day - v.day;
                  return (
                    <div key={r.key} className="bill m-rise" style={{ animationDelay: `${i * 60}ms` }}>
                      <div className="d">{inDays === 0 ? "Today" : inDays === 1 ? "Tomorrow" : `In ${inDays} days`}</div>
                      <div className="n ellipsis">{r.name}</div>
                      <div className="num">{inr(r.amount)}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          <div className={`o7${v.upcomingBills.length ? "" : " span-all"}`}><AskKosh /></div>
        </div>
      </div>
    </>
  );
}
