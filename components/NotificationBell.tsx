"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { listNotifications, markAllRead, type Note } from "@/app/notify-actions";
import { Sheet } from "./app";

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return m <= 1 ? "just now" : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
};

/** The bell in the header: every reminder lands here too, so nothing depends on push working. */
export default function NotificationBell() {
  const [items, setItems] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    listNotifications().then((r) => { if (r.ok) { setItems(r.items); setUnread(r.unread); } }).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  const show = () => {
    setOpen(true);
    if (unread) { setUnread(0); markAllRead().catch(() => undefined); }
  };

  return (
    <>
      <button className="icon-btn bell" onClick={show} aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="bell-dot">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <Sheet title="Notifications" onClose={() => setOpen(false)}>
          {items.length ? (
            <div className="note-list">
              {items.map((n) => (
                <Link key={n.id} href={n.url} className={`note-item${n.read_at ? "" : " new"}`} onClick={() => setOpen(false)}>
                  <b>{n.title}</b>
                  <span>{n.body}</span>
                  <small>{ago(n.created_at)}</small>
                </Link>
              ))}
            </div>
          ) : (
            <p className="empty">Nothing yet. Budget warnings, bills due tomorrow and your Monday summary will show up here.</p>
          )}
          <Link href="/settings#notifications" className="link" onClick={() => setOpen(false)} style={{ display: "block", marginTop: 12 }}>Reminder settings →</Link>
        </Sheet>
      )}
    </>
  );
}
