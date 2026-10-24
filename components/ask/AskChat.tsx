"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AnswerChart, { readChart } from "./AnswerChart";
import { useApp } from "@/components/app";

type Msg = { role: "user" | "assistant"; text: string; error?: boolean; tools?: string[] };
type Chat = { id: string; title: string; updated: number; msgs: Msg[] };

const STORE = "expensly-chats-v1";
const MAX_CHATS = 20;
const SUGGESTIONS = [
  "How's my month going?",
  "Where can I cut back?",
  "Why did I spend more than last month?",
  "Which subscriptions should I review?",
  "How much did I spend on food delivery?",
  "Will I hit my savings goal?",
  "Any unusual charges lately?",
  "Compare my weekday and weekend spending",
];
const TOOL_SHORT: Record<string, string> = {
  get_overview: "This month", query_transactions: "Transactions", spending_summary: "Spending totals",
  get_recurring: "Subscriptions", get_budgets: "Budgets", get_alerts_and_patterns: "Patterns", get_accounts_and_goals: "Accounts & goals",
};

/* ───────────── storage (per browser; wrapped because private mode can throw) ───────────── */
function loadChats(): Chat[] {
  try { return JSON.parse(localStorage.getItem(STORE) ?? "[]") as Chat[]; } catch { return []; }
}
function saveChats(chats: Chat[]) {
  try { localStorage.setItem(STORE, JSON.stringify(chats.slice(0, MAX_CHATS))); } catch { /* storage unavailable */ }
}
const newId = () => Math.random().toString(36).slice(2, 10);

/* ───────────── answer parsing: follow-ups line, chart blocks, light markdown ───────────── */
function splitAnswer(text: string, streaming: boolean) {
  let body = text, followups: string[] = [];
  const m = /\n?\s*FOLLOW-?UPS?:\s*(.*)$/is.exec(text);
  if (m) {
    body = text.slice(0, m.index);
    followups = m[1].split("|").map((s) => s.replace(/^[-•\d.)\s"]+|["\s]+$/g, "").trim()).filter((s) => s.length > 3 && s.length < 90).slice(0, 3);
  } else if (streaming) {
    // Hide a follow-up line that's still arriving ("FOLLO…").
    const tail = /\n\s*F[OLWUPS-]*:?[^\n]*$/i.exec(text);
    if (tail && "FOLLOWUPS:".startsWith(tail[0].trim().toUpperCase().slice(0, 10))) body = text.slice(0, tail.index);
  }
  return { body: body.trimEnd(), followups };
}

function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>))}</>;
}

function Rich({ text, streaming }: { text: string; streaming: boolean }) {
  const blocks: React.ReactNode[] = [];
  // Pull out ```chart blocks first; an unfinished one shows a placeholder while it streams in.
  const parts = text.split(/```chart\s*([\s\S]*?)(?:```|$)/);
  parts.forEach((part, pi) => {
    if (pi % 2 === 1) {
      const closed = text.includes("```", text.indexOf(part) + part.length);
      const spec = closed ? readChart(part.trim()) : null;
      if (spec) blocks.push(<AnswerChart key={`c${pi}`} spec={spec} />);
      else if (streaming && !closed) blocks.push(<div key={`c${pi}`} className="answer-chart pending"><span className="shimmer-text">Drawing a chart…</span></div>);
      return;
    }
    const lines = part.replace(/\r/g, "").split("\n");
    let list: { ordered: boolean; items: string[] } | null = null;
    const flush = () => {
      if (!list) return;
      const Tag = list.ordered ? "ol" : "ul";
      blocks.push(<Tag key={`l${pi}-${blocks.length}`}>{list.items.map((it, i) => <li key={i}><Inline text={it} /></li>)}</Tag>);
      list = null;
    };
    for (const raw of lines) {
      const l = raw.trim();
      if (l.startsWith("```")) continue;
      const bullet = /^[-•*]\s+(.*)$/.exec(l), num = /^\d+[.)]\s+(.*)$/.exec(l);
      if (bullet || num) {
        const ordered = !!num;
        if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
        list.items.push((bullet ?? num)![1]);
      } else if (!l) flush();
      else { flush(); blocks.push(<p key={`p${pi}-${blocks.length}`}><Inline text={l.replace(/^#+\s*/, "")} /></p>); }
    }
    flush();
  });
  return <>{blocks}</>;
}

/* ───────────── voice input (Web Speech API, where the browser has it) ───────────── */
type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void };
function getRecognition(): Recognition | null {
  if (typeof window === "undefined") return null;
  const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const C = W.SpeechRecognition ?? W.webkitSpeechRecognition;
  return C ? new C() : null;
}

export default function AskChat({ initial }: { initial?: string }) {
  const { toast } = useApp();
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState<string>(() => newId());
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState<"ai" | "basic" | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [listening, setListening] = useState(false);
  const [canVoice, setCanVoice] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => { setChats(loadChats()); setCanVoice(!!getRecognition()); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, status]);

  // Save the conversation once an answer finishes.
  const persist = useCallback((id: string, list: Msg[]) => {
    if (!list.length) return;
    setChats((cs) => {
      const title = list.find((m) => m.role === "user")?.text.slice(0, 60) ?? "Chat";
      const next = [{ id, title, updated: Date.now(), msgs: list.slice(-30) }, ...cs.filter((c) => c.id !== id)].slice(0, MAX_CHATS);
      saveChats(next);
      return next;
    });
  }, []);

  const send = useCallback(async (text: string, base?: Msg[]) => {
    const question = text.trim();
    if (!question || busy) return;
    setQ("");
    setShowHistory(false);
    const history: Msg[] = [...(base ?? msgs).filter((m) => !m.error), { role: "user", text: question }];
    setMsgs([...history, { role: "assistant", text: "", tools: [] }]);
    setBusy(true);
    setStatus("Thinking");
    const ctrl = new AbortController();
    abort.current = ctrl;
    // The answer is built here and mirrored into state, so it can be saved reliably at the end.
    let final: Msg = { role: "assistant", text: "", tools: [] };
    const update = (fn: (m: Msg) => Msg) => { final = fn(final); const snap = final; setMsgs((ms) => [...ms.slice(0, -1), snap]); };
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, text: m.role === "assistant" ? splitAnswer(m.text, false).body || "…" : m.text })) }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(res.status === 401 ? "Your session ended. Sign in again." : (await res.text()) || "Couldn't reach Expensly.");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const lineText = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!lineText) continue;
          const ev = JSON.parse(lineText);
          if (ev.t === "meta") { setMode(ev.mode); if (typeof ev.left === "number") setLeft(ev.left); }
          else if (ev.t === "tool") {
            setStatus(ev.v);
            if (ev.name && TOOL_SHORT[ev.name]) update((m) => ({ ...m, tools: [...new Set([...(m.tools ?? []), TOOL_SHORT[ev.name]])] }));
          } else if (ev.t === "text") { setStatus(""); update((m) => ({ ...m, text: m.text + ev.v })); }
          else if (ev.t === "error") update((m) => ({ ...m, text: m.text ? m.text + "\n\n" + ev.v : ev.v, error: true }));
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") update((m) => ({ ...m, text: m.text || (e instanceof Error ? e.message : "Something went wrong."), error: true }));
    } finally {
      setBusy(false);
      setStatus("");
      abort.current = null;
      persist(chatId, [...history, final]);
      input.current?.focus();
    }
  }, [busy, msgs, chatId, persist]);

  // A question passed in the URL (from Overview, Insights, a transaction or the command palette) is asked once.
  useEffect(() => {
    if (initial && !started.current) { started.current = true; send(initial); }
  }, [initial, send]);

  const reset = () => { abort.current?.abort(); setMsgs([]); setStatus(""); setChatId(newId()); setShowHistory(false); input.current?.focus(); };
  const openChat = (c: Chat) => { abort.current?.abort(); setChatId(c.id); setMsgs(c.msgs); setShowHistory(false); };
  const deleteChat = (id: string) => setChats((cs) => { const next = cs.filter((c) => c.id !== id); saveChats(next); if (id === chatId) { setMsgs([]); setChatId(newId()); } return next; });
  const retry = () => {
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const idx = msgs.lastIndexOf(lastUser);
    send(lastUser.text, msgs.slice(0, idx));
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text.replace(/```chart[\s\S]*?```/g, "").replace(/\*\*/g, "").trim()); toast("Copied"); } catch { toast("Couldn't copy"); }
  };
  const toggleVoice = () => {
    if (listening) { rec.current?.stop(); return; }
    const r = getRecognition();
    if (!r) return;
    rec.current = r;
    r.lang = "en-IN";
    r.interimResults = true;
    const before = q ? q.trim() + " " : "";
    r.onresult = (e) => setQ(before + Array.from(e.results).map((x) => x[0].transcript).join(""));
    r.onend = () => { setListening(false); input.current?.focus(); };
    r.onerror = () => { setListening(false); toast("Couldn't hear that. Check microphone permission."); };
    setListening(true);
    r.start();
  };

  const lastAssistant = msgs.length - 1;

  return (
    <div className="chat">
      <div className="chat-tools">
        <button className="link" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>{showHistory ? "Close history" : `History${chats.length ? ` · ${chats.length}` : ""}`}</button>
        {msgs.length > 0 && <button className="link" onClick={reset}>+ New chat</button>}
      </div>

      {showHistory && (
        <div className="chat-history m-rise">
          {chats.length ? chats.map((c) => (
            <div key={c.id} className={`hist-row${c.id === chatId ? " on" : ""}`}>
              <button className="grow" onClick={() => openChat(c)}>
                <b className="ellipsis">{c.title}</b>
                <span className="hint">{new Date(c.updated).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {c.msgs.filter((m) => m.role === "user").length} question{c.msgs.filter((m) => m.role === "user").length === 1 ? "" : "s"}</span>
              </button>
              <button className="icon-x" aria-label={`Delete “${c.title}”`} onClick={() => deleteChat(c.id)}>✕</button>
            </div>
          )) : <p className="empty">Past chats appear here. They're kept on this device only.</p>}
        </div>
      )}

      <div className="chat-log" aria-live="polite">
        {msgs.length === 0 && (
          <div className="chat-empty">
            <div className="chat-orb" aria-hidden="true">✦</div>
            <h2>Ask anything about your money</h2>
            <p className="muted">Expensly reads your transactions, budgets, income and accounts to answer, and can draw a quick chart when it helps.</p>
            <div className="chat-sugg">
              {SUGGESTIONS.map((s, i) => <button key={s} className="m-rise" style={{ animationDelay: `${i * 40}ms` }} onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => {
          if (m.role === "user") return <div key={i} className="bubble user">{m.text}</div>;
          const streaming = busy && i === lastAssistant;
          const { body, followups } = splitAnswer(m.text, streaming);
          return (
            <div key={i} className="answer-wrap">
              {!!m.tools?.length && <div className="checked">✓ Checked {m.tools.join(" · ")}</div>}
              <div className={`bubble assistant${m.error ? " err" : ""}`}>
                {body ? <Rich text={body} streaming={streaming} /> : <span className="typing"><i /><i /><i /></span>}
              </div>
              {!streaming && body && (
                <div className="answer-actions">
                  <button onClick={() => copy(body)} aria-label="Copy answer">Copy</button>
                  {i === lastAssistant && <button onClick={retry} aria-label="Ask again">↻ Retry</button>}
                </div>
              )}
              {!streaming && i === lastAssistant && followups.length > 0 && (
                <div className="followups">
                  {followups.map((f, k) => <button key={f} className="m-rise" style={{ animationDelay: `${k * 60}ms` }} onClick={() => send(f)}>{f}</button>)}
                </div>
              )}
            </div>
          );
        })}
        {busy && status && <div className="chat-status"><span className="shimmer-text">{status}…</span></div>}
        <div ref={end} />
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(q); }}>
        <textarea
          ref={input}
          id="ask"
          rows={1}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(q); } }}
          placeholder={listening ? "Listening…" : "Ask about your money…"}
          aria-label="Ask Expensly"
          maxLength={1000}
        />
        {canVoice && !busy && (
          <button type="button" className={`chat-mic${listening ? " on" : ""}`} onClick={toggleVoice} aria-label={listening ? "Stop listening" : "Speak your question"} aria-pressed={listening}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </button>
        )}
        {busy ? (
          <button type="button" className="chat-send stop" onClick={() => abort.current?.abort()} aria-label="Stop">■</button>
        ) : (
          <button className="chat-send" disabled={!q.trim()} aria-label="Send">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        )}
      </form>
      <div className="chat-foot hint">
        {mode === "basic" ? <span>Basic answers for now.</span> : <span>AI can be wrong; numbers come from your data.{left !== null && left < 10 ? ` ${left} questions left today.` : ""}</span>}
      </div>
    </div>
  );
}
