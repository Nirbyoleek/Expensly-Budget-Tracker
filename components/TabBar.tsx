"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sheet, useApp } from "./app";

const I = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" strokeLinejoin="round" />,
  activity: <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />,
  ask: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" strokeLinejoin="round" />,
  more: <><rect x="4" y="4" width="6.5" height="6.5" rx="2" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="2" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="2" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" /></>,
  insights: <><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" strokeLinejoin="round" /><path d="M9.5 20h5" strokeLinecap="round" /></>,
  budgets: <><circle cx="12" cy="12" r="9" /><path d="M12 3v9l6.5 6.5" /></>,
  wealth: <><path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" /><path d="M15 7h6v6" strokeLinecap="round" strokeLinejoin="round" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" strokeLinecap="round" /></>,
};

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{children}</svg>
);

/** Everything that doesn't fit in the bar, each with a line saying what it's for so nothing gets missed. */
const MORE = [
  { href: "/insights", label: "Insights", desc: "Health score, trends, where to cut", icon: I.insights, c: "#E8A00B" },
  { href: "/budgets", label: "Budgets", desc: "Limits per category, plan with AI", icon: I.budgets, c: "#3B8BF6" },
  { href: "/wealth", label: "Wealth", desc: "Net worth, accounts, goals, recurring", icon: I.wealth, c: "#3DDC97" },
  { href: "/settings", label: "Settings", desc: "Income, password, data", icon: I.settings, c: "#94A3B8" },
];

const isOn = (path: string, href: string) => path === href || path.startsWith(href + "/");

function Tab({ href, label, icon, className = "" }: { href: string; label: string; icon: React.ReactNode; className?: string }) {
  const path = usePathname();
  return (
    <Link href={href} className={`tab ${className}`} aria-current={isOn(path, href) ? "page" : undefined}>
      <Svg>{icon}</Svg>
      {label}
    </Link>
  );
}

export default function TabBar() {
  const { openAdd, addMode, closeAdd } = useApp();
  const path = usePathname();
  const [more, setMore] = useState(false);
  const inMore = MORE.some((m) => isOn(path, m.href));
  useEffect(() => setMore(false), [path]);
  useEffect(() => {
    // The service worker shows reminders; registering early means push works once it's switched on.
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    // Links from reminders like /home?add=statement open the right add sheet.
    const add = new URLSearchParams(window.location.search).get("add");
    if (add === "statement" || add === "quick" || add === "sms") {
      openAdd(add);
      window.history.replaceState(null, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="tabs">
        <nav aria-label="Main">
          <Tab href="/home" label="Home" icon={I.home} />
          <Tab href="/activity" label="Activity" icon={I.activity} />
          <button className={`fab${addMode ? " open" : ""}`} aria-label={addMode ? "Close" : "Add spending"} onClick={() => (addMode ? closeAdd() : openAdd("quick"))}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <Tab href="/ask" label="Ask AI" icon={I.ask} className="tab-ai" />
          <button type="button" className="tab" aria-current={inMore ? "page" : undefined} aria-expanded={more} aria-haspopup="dialog" onClick={() => setMore(true)}>
            <Svg>{I.more}</Svg>
            {inMore ? MORE.find((m) => isOn(path, m.href))!.label : "More"}
          </button>
        </nav>
      </div>
      {more && (
        <Sheet title="More" onClose={() => setMore(false)}>
          <div className="more-grid">
            {MORE.map((m) => (
              <Link key={m.href} href={m.href} className="more-tile" aria-current={isOn(path, m.href) ? "page" : undefined} onClick={() => setMore(false)} style={{ ["--c" as string]: m.c }}>
                <span className="more-ic"><Svg>{m.icon}</Svg></span>
                <b>{m.label}</b>
                <small>{m.desc}</small>
              </Link>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
