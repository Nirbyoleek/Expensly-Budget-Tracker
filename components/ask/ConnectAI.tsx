"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { connectAi, disconnectAi } from "@/app/actions";
import { useApp } from "@/components/app";
import { PROVIDERS, PROVIDER_BY_ID, type ProviderId } from "@/lib/ai/catalog";

const LOGO: Record<ProviderId, { bg: string; fg: string; ch: string }> = {
  gemini: { bg: "linear-gradient(135deg,#4285F4,#9B72CB 55%,#D96570)", fg: "#fff", ch: "✦" },
  openai: { bg: "#10A37F", fg: "#fff", ch: "◎" },
  groq: { bg: "#F55036", fg: "#fff", ch: "g" },
  anthropic: { bg: "#D97757", fg: "#fff", ch: "✳" },
  openrouter: { bg: "#6467F2", fg: "#fff", ch: "⇄" },
};

export function ProviderMark({ id, size = 40 }: { id: ProviderId; size?: number }) {
  const l = LOGO[id];
  return <span className="pmark" style={{ width: size, height: size, background: l.bg, color: l.fg, fontSize: size * 0.45 }} aria-hidden="true">{l.ch}</span>;
}

/** Pick an AI service, follow three steps, paste a key. The key is checked before it's saved. */
export default function ConnectAI({ current, onDone, onCancel }: { current?: { provider: string; key_hint: string; model: string } | null; onDone?: () => void; onCancel?: () => void }) {
  const { toast } = useApp();
  const router = useRouter();
  const [pick, setPick] = useState<ProviderId | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const p = pick ? PROVIDER_BY_ID[pick] : null;

  const save = () => {
    if (!pick) return;
    setError("");
    start(async () => {
      const r = await connectAi(pick, key);
      if (!r.ok) return setError(r.error);
      setKey("");
      router.refresh();
      toast(`Connected to ${PROVIDER_BY_ID[pick].name}. Ask away.`);
      onDone?.();
    });
  };

  const disconnect = () =>
    start(async () => {
      const r = await disconnectAi();
      if (!r.ok) return setError(r.error);
      router.refresh();
      toast("AI disconnected. Your key was deleted.");
      onDone?.();
    });

  if (!p) {
    return (
      <div className="connect">
        <div className="connect-head">
          <div className="chat-orb" aria-hidden="true">✦</div>
          <h2>Connect your AI</h2>
          <p className="muted">Use your own Gemini, ChatGPT or other AI account to power Ask Expensly. It answers from your real transactions, budgets and income. You stay in control of the account and its cost.</p>
        </div>
        <div className="pgrid">
          {PROVIDERS.map((x, i) => (
            <button key={x.id} className={`pcard m-rise${current?.provider === x.id ? " on" : ""}`} style={{ animationDelay: `${i * 50}ms` }} onClick={() => { setPick(x.id); setError(""); }}>
              <ProviderMark id={x.id} />
              <span className="grow">
                <b>{x.name} <small>{x.brand}</small></b>
                <span>{x.blurb}</span>
              </span>
              <span className={`chip ${x.free ? "good" : ""}`}>{current?.provider === x.id ? "Connected" : x.price}</span>
            </button>
          ))}
        </div>
        {current && (
          <div className="btns">
            {onCancel && <button className="btn ghost" onClick={onCancel}>Keep {PROVIDER_BY_ID[current.provider as ProviderId]?.name}</button>}
            <button className="btn ghost danger-text" disabled={pending} onClick={disconnect}>Disconnect</button>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <p className="hint center">Your key is checked, then stored encrypted on the server. It's never shown again or sent to your browser, and you can disconnect any time.</p>
      </div>
    );
  }

  return (
    <div className="connect">
      <button className="link" onClick={() => { setPick(null); setError(""); }}>← All options</button>
      <div className="row" style={{ justifyContent: "flex-start", gap: 14 }}>
        <ProviderMark id={p.id} size={48} />
        <div><h2>Connect {p.name}</h2><span className="hint">{p.brand} · {p.price}</span></div>
      </div>
      <ol className="steps">
        {p.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <a className="btn ghost" href={p.keyUrl} target="_blank" rel="noopener noreferrer">{p.keyLabel} ↗</a>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="lbl" htmlFor="ai-key">YOUR {p.name.toUpperCase()} API KEY
          <input id="ai-key" className="field num" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder={p.placeholder} autoFocus />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" disabled={pending || key.trim().length < 10}>{pending ? "Checking the key…" : `Connect ${p.name}`}</button>
      </form>
      <p className="hint">{p.privacy}</p>
    </div>
  );
}
