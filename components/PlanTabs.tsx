"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PLAN_PAGES } from "@/lib/nav";

/** Switches between the two pages that make up Plan. */
export default function PlanTabs() {
  const path = usePathname();
  return (
    <nav className="seg plan-tabs" aria-label="Plan">
      {PLAN_PAGES.map((p) => (
        <Link key={p.href} href={p.href} aria-current={path === p.href ? "page" : undefined}>{p.label}</Link>
      ))}
    </nav>
  );
}
