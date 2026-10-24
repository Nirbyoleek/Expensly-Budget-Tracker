"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { rotateIngestToken } from "@/app/actions";
import Header from "@/components/Header";
import { useApp } from "@/components/app";
import { parseSms } from "@/lib/ingest/parsers";
import { prepareRows } from "@/lib/ingest/core";
import { fullCategoryName } from "@/lib/taxonomy";
import { inr } from "@/lib/money";
import { todayISO } from "@/lib/dates";

const KEYWORDS = ["debited", "spent", "sent Rs", "credited", "withdrawn"];
const SAMPLE = "Rs.340.00 debited from A/c XX4417 on 22-10-26 to VPA swiggy@icici. UPI Ref 629184123456";

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)} days ago`;
};

/**
 * Guided setup for forwarding bank SMS from an iPhone with a Shortcuts automation, with a live
 * "is it working?" status, a test that checks the key without saving anything, and a preview.
 */
export default function CaptureSetup({ origin, hasToken, last, thisWeek }: { origin: string; hasToken: boolean; last: { name: string; amount: number; at: string } | null; thisWeek: number }) {
  const { toast } = useApp();
  const router = useRouter();
  const [token, setToken] = useState("");
  const [pending, start] = useTransition();
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [sample, setSample] = useState(SAMPLE);
  const url = `${origin}/api/ingest/sms`;

  // keep the status fresh while someone sets it up on the same phone
  useEffect(() => {
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast("Couldn't copy. Press and hold to copy instead."); }
  };

  const create = () => start(async () => {
    const r = await rotateIngestToken();
    if (r.ok) { setToken(r.token); setTest(null); } else toast(r.error);
  });

  const runTest = () => start(async () => {
    if (!token) return setTest({ ok: false, text: "Create a key first (step 1). For safety it's only shown once, so make a new one if you've lost it." });
    try {
      const res = await fetch(`${url}?dry=1`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ text: SAMPLE }) });
      const body = (await res.json()) as { message?: string; error?: string };
      setTest({ ok: res.ok, text: body.message ?? body.error ?? `Error ${res.status}` });
    } catch {
      setTest({ ok: false, text: "Couldn't reach Expensly. Check your connection." });
    }
  });

  const preview = useMemo(() => prepareRows(parseSms(sample, todayISO(), "shortcut"), [], { hash: false }), [sample]);
  const working = !!last && Date.now() - new Date(last.at).getTime() < 14 * 86400000;

  return (
    <>
      <Header title="Track automatically" />
      <div className="stack capture" style={{ maxWidth: 720 }}>
        <Link className="link" href="/settings">← Settings</Link>

        <section className={`card capture-status ${working ? "on" : ""}`}>
          <span className="glyph-box" aria-hidden="true">{working ? "✓" : "✉"}</span>
          <div>
            <b>{working ? "Bank SMS are arriving" : last ? "No messages for a while" : "Not set up yet"}</b>
            <small>
              {last ? `Last: ${last.name} ${inr(last.amount)} · ${ago(last.at)} · ${thisWeek} this week` : "Once it's set up, every UPI and card alert lands here within seconds, already sorted."}
            </small>
          </div>
          <button className="link" onClick={() => router.refresh()}>Refresh</button>
        </section>

        <section className="card stack">
          <div className="section-h"><h2><span className="stepn">1</span> Create your key</h2></div>
          <p className="muted" style={{ fontSize: 14 }}>The key lets your phone add transactions to your account, and nothing else. It can't read your data.</p>
          {token ? (
            <div className="note">
              <b>Your key (shown once, so copy it now)</b>
              <code className="inline" style={{ display: "block", margin: "6px 0", wordBreak: "break-all" }}>{token}</code>
              <div className="btns" style={{ justifyContent: "flex-start" }}>
                <button className="btn ghost sm" onClick={() => copy(`Bearer ${token}`, "Header value")}>Copy “Bearer …” for the header</button>
              </div>
            </div>
          ) : (
            <button className="btn" disabled={pending} onClick={create}>{hasToken ? "Make a new key (the old one stops working)" : "Create key"}</button>
          )}
        </section>

        <section className="card stack">
          <div className="section-h"><h2><span className="stepn">2</span> Make the iPhone automation</h2></div>
          <ol className="steps capture-steps">
            <li>Open the <b>Shortcuts</b> app → <b>Automation</b> tab → <b>+</b> (or <b>New Automation</b>).</li>
            <li>Choose <b>Message</b>. Under <b>Message Contains</b> type <code className="inline">debited</code>. Select <b>Run Immediately</b> and turn <b>Notify When Run</b> off. Tap <b>Next</b> → <b>New Blank Automation</b>.</li>
            <li>Add the action <b>Get Contents of URL</b>. Set the URL to
              <span className="copyrow"><code className="inline">{url}</code><button className="link" onClick={() => copy(url, "URL")}>Copy</button></span>
            </li>
            <li>Tap the arrow on that action to show more options:
              <ul>
                <li><b>Method</b>: POST</li>
                <li><b>Headers</b> → Add new header. Key <code className="inline">Authorization</code>, value <code className="inline">Bearer</code> followed by your key (use the copy button in step 1).</li>
                <li><b>Request Body</b>: JSON → Add new field → Text. Key <code className="inline">text</code>, value: tap and choose <b>Shortcut Input</b>, then set it to <b>Content</b>.</li>
              </ul>
            </li>
            <li>Tap <b>Done</b>. Repeat steps 1–4 for other words your bank uses, so every alert is caught:
              <span className="kw">{KEYWORDS.slice(1).map((k) => <code key={k} className="inline">{k}</code>)}</span>
            </li>
          </ol>
          <p className="hint">Tip: you only need to type the URL and key once. Long-press the first automation&apos;s action, copy it, and paste it into the others.</p>
        </section>

        <section className="card stack">
          <div className="section-h"><h2><span className="stepn">3</span> Check it works</h2></div>
          <button className="btn ghost" disabled={pending} onClick={runTest}>{pending ? "Checking…" : "Test my key (nothing is saved)"}</button>
          {test && <p className={test.ok ? "hint good" : "error"} role="status">{test.text}</p>}
          <p className="muted" style={{ fontSize: 14 }}>Then wait for your next UPI or card payment. The status at the top turns green when the first message arrives, and the transaction appears in Activity marked <b>Shortcut</b>.</p>
        </section>

        <section className="card stack">
          <div className="section-h"><h2>How will my bank&apos;s messages be read?</h2></div>
          <p className="muted" style={{ fontSize: 14 }}>Paste one of your bank alerts to see what Expensly would add. Nothing is saved.</p>
          <textarea value={sample} onChange={(e) => setSample(e.target.value)} aria-label="Bank message to try" />
          {preview.length ? preview.map((r, i) => (
            <div key={i} className="list-row">
              <span className="grow"><b>{r.merchant_name}</b><span className="hint">{fullCategoryName(r.category_id, r.subcategory_id)} · {r.date}</span></span>
              <span className={`num${r.amount_paise > 0 ? " good" : ""}`}>{r.amount_paise > 0 ? "+" : "−"}{inr(r.amount_paise)}</span>
            </div>
          )) : <p className="hint">No amount found in that message, so nothing would be added.</p>}
        </section>

        <p className="hint">Android isn&apos;t supported yet: Android doesn&apos;t let web apps read SMS. Import a statement or paste messages under ＋ → Bank SMS instead.</p>
      </div>
    </>
  );
}
