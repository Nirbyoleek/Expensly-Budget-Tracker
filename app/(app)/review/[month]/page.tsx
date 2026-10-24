import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import { CatIcon } from "@/components/app";
import { getActiveMonths, getCategories, getTransactionsBetween } from "@/lib/data";
import { addMonths, daysInMonth, monthLong, monthStart, shortDate, todayISO } from "@/lib/dates";
import { inr, inrCompact } from "@/lib/money";
import { monthReview } from "@/lib/review";

export async function generateMetadata({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  return { title: /^\d{4}-\d{2}$/.test(month) ? `${monthLong(`${month}-01`)} in review · Expensly` : "Month in review · Expensly" };
}

export default async function ReviewPage({ params }: { params: Promise<{ month: string }> }) {
  const { month: raw } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) notFound();
  const month = `${raw}-01`;
  const thisMonth = monthStart(todayISO());
  if (month > thisMonth) notFound();
  const prev = addMonths(month, -1);
  const end = `${raw}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const [tx, cats, months] = await Promise.all([getTransactionsBetween(prev, end), getCategories(), getActiveMonths()]);
  const r = monthReview(tx, cats, month);
  const name = monthLong(month).split(" ")[0], prevName = monthLong(prev).split(" ")[0];
  const older = months.find((m) => m < month), newer = [...months].reverse().find((m) => m > month);
  const partial = month === thisMonth;
  const delta = r.prevSpent ? r.spent - r.prevSpent : null;
  const maxCat = Math.max(1, ...r.categories.map((c) => Math.max(c.total, c.prev)));

  return (
    <>
      <Header title="Month in review" subtitle={monthLong(month)} />
      <div className="stack review" style={{ maxWidth: 760 }}>
        <nav className="review-nav" aria-label="Choose month">
          {older ? <Link className="link" href={`/review/${older.slice(0, 7)}`}>‹ {monthLong(older)}</Link> : <span />}
          {newer ? <Link className="link" href={`/review/${newer.slice(0, 7)}`}>{monthLong(newer)} ›</Link> : <span />}
        </nav>

        {!r.count ? (
          <section className="card"><p className="empty">Nothing recorded in {monthLong(month)}. Import that month&apos;s statement to see its review.</p></section>
        ) : (
          <>
            <section className="hero review-hero o1">
              <div className="eyebrow">{partial ? `${name} so far` : `Your ${name}`}</div>
              <div className="num review-big">{inr(r.spent)}</div>
              <div className="hint">spent{delta !== null ? ` · ${delta > 0 ? "▲" : "▼"} ${inr(Math.abs(delta))} vs ${prevName}` : ""}</div>
              <div className="hero-stats">
                <div><b>{inrCompact(r.income)}</b><span>Earned</span></div>
                <div><b className={r.saved !== null && r.saved < 0 ? "bad" : ""}>{r.saved === null ? "—" : `${r.saved < 0 ? "−" : ""}${inrCompact(Math.abs(r.saved))}`}</b><span>{r.saved !== null && r.saved < 0 ? "Overspent" : "Kept"}</span></div>
                <div><b>{inrCompact(r.invested)}</b><span>Invested</span></div>
              </div>
            </section>

            {r.lines.length > 0 && (
              <section className="card o2">
                <h2>The short version</h2>
                <ul className="review-lines">{r.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </section>
            )}

            <section className="card o3">
              <div className="section-h"><h2>Where it went</h2><span className="hint">bars: {name} vs {prevName}</span></div>
              {r.categories.slice(0, 8).map((c) => (
                <Link key={c.id} href={`/activity?cat=${c.id}`} className="review-cat">
                  <CatIcon name={c.name} color={c.color} size="sm" />
                  <div className="grow">
                    <div className="row"><b>{c.name}</b><b className="num">{inr(c.total)}</b></div>
                    <div className="review-bar"><span style={{ width: `${(c.total / maxCat) * 100}%`, background: c.color }} /></div>
                    <div className="review-bar prev"><span style={{ width: `${(c.prev / maxCat) * 100}%` }} /></div>
                    <small className="muted">{Math.round(c.share * 100)}% of spending{c.prev ? ` · ${c.total >= c.prev ? "+" : "−"}${inr(Math.abs(c.total - c.prev))} vs ${prevName}` : ""}</small>
                  </div>
                </Link>
              ))}
            </section>

            <div className="review-two">
              <section className="card o4">
                <h2>Top places</h2>
                {r.topMerchants.map((m) => (
                  <div key={m.name} className="list-row"><span className="grow"><b className="ellipsis">{m.name}</b><small className="muted">{m.count} time{m.count === 1 ? "" : "s"}</small></span><b className="num">{inr(m.total)}</b></div>
                ))}
              </section>
              <section className="card o4">
                <h2>Biggest spends</h2>
                {r.biggest.map((t) => (
                  <div key={t.id} className="list-row"><span className="grow"><b className="ellipsis">{t.merchant_name}</b><small className="muted">{shortDate(t.date)}</small></span><b className="num">{inr(-t.amount_paise)}</b></div>
                ))}
                <p className="hint" style={{ marginTop: 8 }}>{r.noSpendDays} of {r.days} days had no everyday spending{r.fees ? ` · ${inr(r.fees)} in fees` : ""}.</p>
              </section>
            </div>

            <Link className="btn ghost" href={`/activity?month=${raw}`}>See every {name} transaction</Link>
          </>
        )}
      </div>
    </>
  );
}
