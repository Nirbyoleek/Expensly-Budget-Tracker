"use client";

import { useApp } from "@/components/app";

/** Opens the add sheet on "Money in". */
export default function AddMoneyInButton({ className = "btn ghost sm", children = "＋ Add money in" }: { className?: string; children?: React.ReactNode }) {
  const { openAdd } = useApp();
  return <button type="button" className={className} onClick={() => openAdd("income")}>{children}</button>;
}
