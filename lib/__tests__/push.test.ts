import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { pushConfigured, sendPush } from "../push";

const keys = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" }), priv = privateKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x!, "base64url"), Buffer.from(pub.y!, "base64url")]).toString("base64url");
  return { pub: raw, priv: priv.d! };
};

describe("web push", () => {
  beforeEach(() => {
    const k = keys();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", k.pub);
    vi.stubEnv("VAPID_PRIVATE_KEY", k.priv);
    vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.com");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("knows when it's configured", () => {
    expect(pushConfigured()).toBe(true);
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(pushConfigured()).toBe(false);
  });

  it("sends an empty, VAPID-signed push the push service will accept", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    expect(await sendPush("https://fcm.googleapis.com/fcm/send/abc123")).toBe("ok");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://fcm.googleapis.com/fcm/send/abc123");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined(); // nothing personal goes through the push service
    expect(init.headers.TTL).toBe("86400");

    const [, jwt, k] = init.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/)!;
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "mailto:test@example.com" });
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
    const pub = Buffer.from(k, "base64url");
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))).toBe(true);
  });

  it.each([[404, "gone"], [410, "gone"], [500, "failed"], [429, "failed"]])("treats HTTP %s as %s", async (status, want) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status })));
    expect(await sendPush("https://web.push.apple.com/abc")).toBe(want);
  });

  it("never throws on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    expect(await sendPush("https://web.push.apple.com/abc")).toBe("failed");
  });
});
