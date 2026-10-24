import { afterEach, describe, expect, it, vi } from "vitest";
import { aiProviderFor, parseJson } from "../gate";
import type { User } from "@supabase/supabase-js";

const user = (email: string) => ({ id: "u1", email }) as User;
afterEach(() => vi.unstubAllEnvs());

describe("parseJson", () => {
  it("reads plain JSON, fenced JSON and JSON surrounded by chatter", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('```json\n[{"n":0,"c":"food"}]\n```')).toEqual([{ n: 0, c: "food" }]);
    expect(parseJson('Sure! Here you go: {"headline":"ok"} Hope that helps.')).toEqual({ headline: "ok" });
  });

  it("throws a friendly error on garbage", () => {
    expect(() => parseJson("no json here")).toThrow("didn't return a usable answer");
    expect(() => parseJson("{broken")).toThrow("garbled");
  });
});

describe("who gets AI", () => {
  it("gives everyone AI when no allowlist is set", () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    vi.stubEnv("AI_ALLOWED_EMAILS", "");
    expect(aiProviderFor(user("anyone@example.com"))?.id).toBe("gemini");
  });

  it("limits AI to the allowlist, case-insensitively", () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    vi.stubEnv("AI_ALLOWED_EMAILS", "Me@Example.com, friend@example.com");
    expect(aiProviderFor(user("me@example.com"))).not.toBeNull();
    expect(aiProviderFor(user("stranger@example.com"))).toBeNull();
  });

  it("has no AI without a key", () => {
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"]) vi.stubEnv(k, "");
    expect(aiProviderFor(user("me@example.com"))).toBeNull();
  });
});
