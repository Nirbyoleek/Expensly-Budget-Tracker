/** Browser side of reminders: is push possible here, and turning it on or off for this device. */

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** iPhone only allows web push for apps added to the Home Screen and opened from there. */
export const isIos = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isInstalled = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

function keyBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function subscribePush(): Promise<{ ok: true; sub: PushSubscriptionJSON } | { ok: false; error: string }> {
  if (!pushSupported()) return { ok: false, error: isIos() && !isInstalled() ? "On iPhone, add Expensly to your Home Screen first (Share → Add to Home Screen), then open it from there." : "This browser can't show notifications." };
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return { ok: false, error: "Notifications aren't set up on the server yet." };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, error: "Notifications are blocked. Allow them for Expensly in your phone or browser settings." };
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  return { ok: true, sub: sub.toJSON() };
}

export async function unsubscribePush(): Promise<string | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => undefined);
  return endpoint;
}
