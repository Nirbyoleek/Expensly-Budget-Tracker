"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addTransactions } from "@/app/actions";
import { useApp } from "@/components/app";
import { flush, pendingCount } from "@/lib/offline-queue";

/** Shows when you're offline and sends quick-adds saved meanwhile once the connection is back. */
export default function OfflineSync() {
  const { toast } = useApp();
  const router = useRouter();
  const [offline, setOffline] = useState(false);
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    let running = false;
    const sync = async () => {
      setWaiting(pendingCount());
      if (running || !navigator.onLine || !pendingCount()) return;
      running = true;
      const r = await flush((rows) => addTransactions({ rows: rows as Parameters<typeof addTransactions>[0]["rows"] }));
      running = false;
      setWaiting(r.left);
      if (r.added) { router.refresh(); toast(`Synced ${r.added} entr${r.added === 1 ? "y" : "ies"} you added offline`); }
      else if (r.failed) toast(`${r.failed} offline entr${r.failed === 1 ? "y" : "ies"} couldn't be saved`);
    };
    const update = () => { setOffline(!navigator.onLine); if (navigator.onLine) void sync(); };
    const onQueued = () => setWaiting(pendingCount());
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("expensly:queued", onQueued);
    const t = setInterval(() => void sync(), 60000);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); window.removeEventListener("expensly:queued", onQueued); clearInterval(t); };
  }, [router, toast]);

  if (!offline && !waiting) return null;
  return (
    <div className="offline-pill" role="status">
      {offline ? "You're offline" : "Syncing"}{waiting ? ` · ${waiting} waiting to sync` : offline ? " · quick-adds will sync later" : ""}
    </div>
  );
}
