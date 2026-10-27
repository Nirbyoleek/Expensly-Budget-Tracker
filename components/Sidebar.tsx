"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "./app";
import { PaletteButton } from "./AddButton";
import { NavIcon } from "./TabBar";
import { NAV, isActive } from "@/lib/nav";


const SETTINGS_ICON = (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" strokeLinecap="round" strokeLinejoin="round" />
  </>
);

/** Desktop navigation. Hidden below 1024px, where the bottom tab bar takes over. */
export default function Sidebar() {
  const path = usePathname();
  const { openAdd } = useApp();
  const item = (href: string, label: string, icon: React.ReactNode) => {
    const active = path === href || path.startsWith(href + "/");
    return (
      <Link key={href} href={href} className="side-link" aria-current={active ? "page" : undefined}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{icon}</svg>
        {label}
      </Link>
    );
  };
  return (
    <aside className="sidebar" aria-label="Main">
      <Link href="/home" className="side-brand">
        <span className="logo" aria-hidden="true">E</span>
        <span>
          <b>Expensly</b>
          <small>Safe to spend, every day</small>
        </span>
      </Link>
      <PaletteButton variant="pill" />
      <button className="btn side-add" onClick={() => openAdd("quick")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Add spending
      </button>
      <nav className="side-nav">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="side-link" aria-current={isActive(path, n) ? "page" : undefined}>
            <NavIcon name={n.icon} />
            {n.label}
          </Link>
        ))}
        {item("/ask", "Ask Expensly", <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" strokeLinejoin="round" />)}
      </nav>
      <div className="side-section">
        <span className="eyebrow">Bring data in</span>
        <button className="side-link" onClick={() => openAdd("statement")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
          Import statement
        </button>
        <button className="side-link" onClick={() => openAdd("sms")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z" /></svg>
          Paste bank SMS
        </button>
      </div>
      <div className="side-foot">
        {item("/settings", "Settings", SETTINGS_ICON)}
        <p className="hint">Press <kbd>N</kbd> to add spending</p>
      </div>
    </aside>
  );
}
