import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../cron/notify/route";

afterEach(() => vi.unstubAllEnvs());

/** The daily job can message every user, so only Vercel's cron (holding CRON_SECRET) may run it. */
describe("daily reminder job access", () => {
  it("refuses requests without the secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(new Request("https://x/api/cron/notify"));
    expect(res.status).toBe(401);
  });

  it("refuses a wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(new Request("https://x/api/cron/notify", { headers: { authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
  });

  it("refuses everything when no secret is configured, rather than running open", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(new Request("https://x/api/cron/notify", { headers: { authorization: "Bearer " } }));
    expect(res.status).toBe(401);
  });

  it("gets past the check with the right secret (then needs the service key)", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const res = await GET(new Request("https://x/api/cron/notify", { headers: { authorization: "Bearer s3cret" } }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" });
  });
});
