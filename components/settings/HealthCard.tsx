"use client";

import { useMemo, useState } from "react";

export type HealthItem = { at: string; source: string; path: string | null; message: string };

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Owner only: what went wrong in the app over the last 30 days, grouped so repeats don't drown the rest. */
export default function HealthCard({ items }: { items: HealthItem[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const day = Date.now() - 86400000;
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; source: string; message: string; count: number; last: string; paths: Set<string> }>();
    for (const e of items) {
      const key = `${e.source}|${e.message.slice(0, 120)}`;
      const g = m.get(key) ?? { key, source: e.source, message: e.message, count: 0, last: e.at, paths: new Set<string>() };
      g.count++;
      if (e.at > g.last) g.last = e.at;
      if (e.path) g.paths.add(e.path);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => b.last.localeCompare(a.last));
  }, [items]);
  const today = items.filter((e) => new Date(e.at).getTime() > day).length;

  return (
    <section className="card stack" id="health">
      <div className="section-h">
        <h2>App health</h2>
        <span className={`chip ${today ? "bad" : "good"}`}>{today ? `${today} in the last day` : "No problems today"}</span>
      </div>
      <p className="hint">Only you see this. Errors from the server, browsers, the AI (including switches to the backup) and the daily job. You also get a summary notification each morning when something went wrong.</p>
      {groups.length ? (
        <div className="note-list">
          {groups.slice(0, 20).map((g) => (
            <button key={g.key} type="button" className="note-item" style={{ textAlign: "left", font: "inherit", cursor: "pointer" }} onClick={() => setOpen(open === g.key ? null : g.key)}>
              <b>{g.count}× <span className="tag" style={{ marginRight: 6 }}>{g.source}</span>{g.message.slice(0, 110)}</b>
              <small>last {when(g.last)}</small>
              {open === g.key && <span style={{ wordBreak: "break-word" }}>{g.message}{g.paths.size ? ` · ${[...g.paths].slice(0, 4).join(", ")}` : ""}</span>}
            </button>
          ))}
        </div>
      ) : (
        <p className="empty">Nothing has gone wrong in the last 30 days.</p>
      )}
    </section>
  );
}
