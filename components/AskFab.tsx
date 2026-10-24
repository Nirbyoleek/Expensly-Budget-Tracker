"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** On phones: a small floating button to reach Ask Expensly from any screen. */
export default function AskFab() {
  const path = usePathname();
  if (path.startsWith("/ask") || path.startsWith("/settings")) return null;
  return (
    <Link href="/ask" className="ask-fab only-mobile" aria-label="Ask Expensly AI">
      <span aria-hidden="true">✦</span>
    </Link>
  );
}
