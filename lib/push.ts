import "server-only";
import { createPrivateKey, sign } from "node:crypto";

/**
 * Web Push without a library. We send *empty* pushes, which need no payload encryption:
 * the service worker wakes up, fetches the waiting messages from /api/notifications/pending
 * (signed in with the user's cookie) and shows them. Only the VAPID signature is needed here.
 *
 * Env: NEXT_PUBLIC_VAPID_PUBLIC_KEY (base64url, 65-byte uncompressed P-256 point),
 *      VAPID_PRIVATE_KEY (base64url, 32-byte scalar), VAPID_SUBJECT (mailto: or https: URL).
 */

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export const pushConfigured = () => !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

function vapidJwt(audience: string): string {
  const pub = fromB64url(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!);
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: process.env.VAPID_PRIVATE_KEY!, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) },
    format: "jwk",
  });
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.VAPID_SUBJECT || "mailto:hello@expensly.app" })));
  const sig = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${b64url(sig)}`;
}

/** Wake one device. Returns "gone" when the browser has dropped the subscription, so it can be deleted. */
export async function sendPush(endpoint: string): Promise<"ok" | "gone" | "failed"> {
  try {
    const aud = new URL(endpoint).origin;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        TTL: String(24 * 3600),
        Urgency: "normal",
        "Content-Length": "0",
        Authorization: `vapid t=${vapidJwt(aud)}, k=${process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY}`,
      },
    });
    if (res.status === 404 || res.status === 410) return "gone";
    if (!res.ok) console.error("push failed", res.status, (await res.text().catch(() => "")).slice(0, 200));
    return res.ok ? "ok" : "failed";
  } catch (e) {
    console.error("push error", e);
    return "failed";
  }
}
