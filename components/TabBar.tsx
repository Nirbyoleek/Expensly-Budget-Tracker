"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "./app";
import { ICONS, NAV, isActive, type NavItem } from "@/lib/nav";

export const NavIcon = ({ name }: { name: keyof typeof ICONS }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>
);

function Tab({ item }: { item: NavItem }) {
  const path = usePathname();
  return (
    <Link href={item.href} className="tab" aria-current={isActive(path, item) ? "page" : undefined}>
      <NavIcon name={item.icon} />
      {item.label}
    </Link>
  );
}

/** Phone navigation: the same four places as the sidebar, with Add in the middle. */
export default function TabBar() {
  const { openAdd, addMode, closeAdd } = useApp();
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
    <div className="tabs">
      <nav aria-label="Main">
        <Tab item={NAV[0]} />
        <Tab item={NAV[1]} />
        <button className={`fab${addMode ? " open" : ""}`} aria-label={addMode ? "Close" : "Add spending"} onClick={() => (addMode ? closeAdd() : openAdd("quick"))}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <Tab item={NAV[2]} />
        <Tab item={NAV[3]} />
      </nav>
    </div>
  );
}
