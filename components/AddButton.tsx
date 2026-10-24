"use client";

import { useEffect, useState } from "react";
import { useApp } from "./app";

/** Desktop header button, plus the N shortcut. */
export default function AddButton() {
  const { openAdd, addMode } = useApp();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (addMode || e.metaKey || e.ctrlKey || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) || t?.isContentEditable) return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); openAdd("quick"); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openAdd, addMode]);
  return (
    <button className="btn head-add only-desktop" onClick={() => openAdd("quick")}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      Add spending
    </button>
  );
}

/** Opens the command palette. Shows as a search pill on desktop and an icon on phones. */
export function PaletteButton({ variant }: { variant: "pill" | "icon" }) {
  const { setPaletteOpen } = useApp();
  const [mac, setMac] = useState(true);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);
  if (variant === "icon")
    return (
      <button className="icon-btn only-mobile" aria-label="Search and commands" onClick={() => setPaletteOpen(true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      </button>
    );
  return (
    <button className="palette-pill" onClick={() => setPaletteOpen(true)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <span>Search or jump</span>
      <kbd>{mac ? "⌘" : "Ctrl"}</kbd><kbd>K</kbd>
    </button>
  );
}
