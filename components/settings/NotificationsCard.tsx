"use client";

import { useEffect, useState, useTransition } from "react";
import { removePushSubscription, savePushSubscription, sendTestNotification, setNotifyPrefs } from "@/app/notify-actions";
import { currentSubscription, isInstalled, isIos, pushSupported, subscribePush, unsubscribePush } from "@/lib/push-client";
import { useApp } from "@/components/app";

type Prefs = { budget: boolean; bills: boolean; weekly: boolean };

/** Reminders: which ones, and whether this device gets them as notifications. */
export default function NotificationsCard({ prefs: initial }: { prefs: Prefs }) {
  const { toast } = useApp();
  const [prefs, setPrefs] = useState(initial);
  const [on, setOn] = useState<boolean | null>(null);
  const [support, setSupport] = useState<"yes" | "ios-install" | "no">("yes");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!pushSupported()) { setSupport(isIos() && !isInstalled() ? "ios-install" : "no"); setOn(false); return; }
    currentSubscription().then((s) => setOn(!!s)).catch(() => setOn(false));
  }, []);

  const toggle = () => {
    setError("");
    start(async () => {
      if (on) {
        const endpoint = await unsubscribePush();
        if (endpoint) await removePushSubscription(endpoint);
        setOn(false);
        toast("Notifications off on this device");
        return;
      }
      const r = await subscribePush();
      if (!r.ok) return setError(r.error);
      const { endpoint, keys } = r.sub;
      const saved = await savePushSubscription({ endpoint: endpoint!, p256dh: keys!.p256dh, auth: keys!.auth, ua: navigator.userAgent.slice(0, 300) });
      if (!saved.ok) return setError(saved.error);
      setOn(true);
      const t = await sendTestNotification();
      toast(t.ok && t.devices ? "Notifications on. A test one is on its way." : "Notifications on.");
    });
  };

  const change = (k: keyof Prefs) => {
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    start(async () => {
      const r = await setNotifyPrefs(next);
      if (!r.ok) { setPrefs(prefs); toast(r.error); }
    });
  };

  return (
    <section className="card stack" id="notifications">
      <div className="section-h"><h2>Reminders</h2>{on && <span className="chip good">On for this device</span>}</div>
      <p className="muted" style={{ fontSize: 14 }}>A nudge when a budget is nearly used up, the day before a regular bill, and a short summary every Monday morning. They also collect under the bell at the top.</p>

      {support === "ios-install" ? (
        <div className="note">
          <b>On iPhone, install Expensly first</b>
          Tap <b>Share</b> in Safari, then <b>Add to Home Screen</b>. Open Expensly from the new icon and come back here to turn notifications on.
        </div>
      ) : support === "no" ? (
        <p className="hint">This browser can&apos;t show notifications. You&apos;ll still see reminders under the bell.</p>
      ) : (
        <button className={`btn${on ? " ghost" : ""}`} disabled={pending || on === null} onClick={toggle}>
          {pending ? "One moment…" : on ? "Turn off notifications on this device" : "Turn on notifications"}
        </button>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="stack" style={{ gap: 6 }}>
        {([["budget", "Budget warnings", "At 80% and when a category goes over"], ["bills", "Bills due tomorrow", "Rent, EMIs, subscriptions Expensly has spotted"], ["weekly", "Monday summary", "Last week's spending vs the week before"]] as const).map(([k, label, hint]) => (
          <label key={k} className="check" htmlFor={`n-${k}`} style={{ alignItems: "flex-start" }}>
            <input id={`n-${k}`} type="checkbox" checked={prefs[k]} onChange={() => change(k)} />
            <span><b style={{ fontWeight: 700 }}>{label}</b><span className="hint" style={{ display: "block" }}>{hint}</span></span>
          </label>
        ))}
      </div>
    </section>
  );
}
