import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import { requireUser } from "@/lib/data";
import { ownerEmail } from "@/lib/errors";
import { createServiceClient } from "@/lib/supabase/server";

export const metadata = { title: "Usage · Expensly" };
export const dynamic = "force-dynamic";

type Stats = {
  users: number; new_7d: number; active_1d: number; active_7d: number; active_30d: number; deleted_30d: number;
  funnel: { step: string; n: number }[];
  features: { name: string; n: number; people: number }[];
  pages: { path: string; n: number; people: number }[];
  daily: { day: string; n: number }[];
};

const LABEL: Record<string, string> = {
  signup: "Signed up", sign_in: "Signed in", tx_added: "Added spends (quick add / SMS)", statement_imported: "Imported a statement",
  tx_edited: "Edited a transaction", reviewed: "Approved transactions", merchant_rule: "Re-filed a merchant",
  category_created: "Made a category", category_deleted: "Deleted a category", budget_set: "Set a budget", ai_budget_plan: "AI budget plan",
  goal_created: "Made a goal", goal_autofill: "Turned on goal auto-fill", income_set: "Set income", account_saved: "Saved an account",
  recategorised: "Re-categorised everything", ai_question: "Asked AI", ai_sort: "AI sorted an import", capture_key: "Made an iPhone capture key",
  sms_captured: "SMS captured automatically", push_enabled: "Turned on notifications", export: "Exported data", sample_loaded: "Loaded sample data",
  account_deleted: "Deleted their account", offline_synced: "Synced offline entries",
};

/** The owner's view of how Expensly is used. Everyone else gets a 404. */
export default async function AdminPage() {
  const { user } = await requireUser();
  if (!ownerEmail() || (user.email ?? "").toLowerCase() !== ownerEmail()) notFound();
  const db = createServiceClient();
  const { data, error } = db ? await db.rpc("owner_stats") : { data: null, error: { message: "SUPABASE_SERVICE_ROLE_KEY isn't set" } };
  const s = data as Stats | null;

  return (
    <>
      <Header title="Usage" subtitle="Only you can see this" />
      <div className="stack admin" style={{ maxWidth: 900 }}>
        <Link className="link" href="/settings">← Settings</Link>
        {!s ? <section className="card"><p className="error">Couldn&apos;t load the numbers: {error?.message ?? "unknown error"}</p></section> : (
          <>
            <section className="admin-kpis">
              {([["People", s.users, `${s.new_7d} new this week`], ["Active today", s.active_1d, "did anything in 24 h"], ["Active this week", s.active_7d, `of ${s.users}`], ["Active this month", s.active_30d, `${s.deleted_30d} deleted an account`]] as const).map(([k, v, sub]) => (
                <div key={k} className="card"><span className="eyebrow">{k}</span><b className="num">{v}</b><small className="muted">{sub}</small></div>
              ))}
            </section>

            <section className="card">
              <div className="section-h"><h2>Daily active people</h2><span className="hint">last 30 days</span></div>
              <div className="admin-bars" role="img" aria-label="Daily active people over the last 30 days">
                {s.daily.map((d) => {
                  const max = Math.max(1, ...s.daily.map((x) => x.n));
                  return <span key={d.day} title={`${d.day}: ${d.n}`} style={{ height: `${Math.max(3, (d.n / max) * 100)}%` }} className={d.n ? "" : "zero"} />;
                })}
              </div>
            </section>

            <section className="card">
              <div className="section-h"><h2>Where new people stop</h2><span className="hint">everyone, all time</span></div>
              {s.funnel.map((f, i) => {
                const top = Math.max(1, s.funnel[0].n), prev = i ? s.funnel[i - 1].n : f.n;
                const drop = i && prev ? Math.round((1 - f.n / prev) * 100) : 0;
                return (
                  <div key={f.step} className="admin-funnel">
                    <div className="row"><span>{f.step}</span><span className="num"><b>{f.n}</b>{i > 0 && drop > 0 && <small className="bad"> −{drop}%</small>}</span></div>
                    <div className="bar thin"><i style={{ width: `${(f.n / top) * 100}%`, background: "var(--accent)" }} /></div>
                  </div>
                );
              })}
              <p className="hint">The biggest drop shows where to focus: that&apos;s the step new people find hardest.</p>
            </section>

            <div className="admin-two">
              <section className="card">
                <div className="section-h"><h2>What people do</h2><span className="hint">last 30 days</span></div>
                {s.features.length ? s.features.map((f) => (
                  <div key={f.name} className="list-row"><span className="grow">{LABEL[f.name] ?? f.name}</span><span className="num hint">{f.people} {f.people === 1 ? "person" : "people"}</span><b className="num" style={{ minWidth: 40, textAlign: "right" }}>{f.n}</b></div>
                )) : <p className="empty">Nothing recorded yet. Counts start from now.</p>}
              </section>
              <section className="card">
                <div className="section-h"><h2>Most opened pages</h2><span className="hint">last 7 days</span></div>
                {s.pages.length ? s.pages.map((p) => (
                  <div key={p.path} className="list-row"><span className="grow"><code className="inline">{p.path}</code></span><span className="num hint">{p.people} {p.people === 1 ? "person" : "people"}</span><b className="num" style={{ minWidth: 40, textAlign: "right" }}>{p.n}</b></div>
                )) : <p className="empty">No page views yet.</p>}
              </section>
            </div>
            <p className="hint">Test accounts from the automated checks are left out. Events hold no amounts, names or anything people typed.</p>
          </>
        )}
      </div>
    </>
  );
}
