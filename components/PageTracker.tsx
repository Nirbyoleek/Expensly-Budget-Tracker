"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackClient } from "@/app/track-actions";

/** Counts a page view when you open a tab (once per page per minute, so refreshes don't inflate it). */
export default function PageTracker() {
  const path = usePathname();
  useEffect(() => {
    if (!path || typeof navigator !== "undefined" && navigator.onLine === false) return;
    const key = `ev:${path}`;
    try {
      const last = Number(sessionStorage.getItem(key) ?? 0);
      if (Date.now() - last < 60000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch { /* storage blocked: still count it */ }
    trackClient("page_view", { path }).catch(() => undefined);
  }, [path]);
  return null;
}
