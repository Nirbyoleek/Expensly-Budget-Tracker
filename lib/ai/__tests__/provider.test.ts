import { afterEach, describe, expect, it, vi } from "vitest";
import { CHEAP_MODELS, runProvider, serverProvider } from "../provider";
import type { StreamEvent } from "../claude";
import { jsonError, sse, textChunks, toolCall } from "../../../tests/sse";

const collect = async (gen: AsyncGenerator<StreamEvent>) => { const out: StreamEvent[] = []; for await (const e of gen) out.push(e); return out; };
type RunTool = (name: string, input: Record<string, unknown>) => unknown;
const args = (runTool: RunTool = vi.fn(() => ({ ok: true }))) => ({ system: "s", tools: [] as object[], messages: [{ role: "user" as const, content: "hi" }], runTool });
const hostOf = (u: unknown) => new URL(String(u)).host;
/** The JSON body of the i-th fetch call. */
const bodyOf = (f: { mock: { calls: unknown[][] } }, i: number) => JSON.parse(String((f.mock.calls[i][1] as RequestInit).body));

afterEach(() => vi.unstubAllGlobals());

describe("choosing the provider", () => {
  it("returns null without any key", () => {
    expect(serverProvider({})).toBeNull();
  });

  it("uses the first key in priority order and the next one as backup", () => {
    const p = serverProvider({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" })!;
    expect(p).toMatchObject({ id: "gemini", model: CHEAP_MODELS.gemini[0], own: false });
    expect(p.backup).toMatchObject({ id: "groq", model: CHEAP_MODELS.groq[0] });
    expect(serverProvider({ GEMINI_API_KEY: "g" })!.backup).toBeUndefined();
    expect(serverProvider({ ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g" })!.id).toBe("anthropic");
  });

  it("only ever uses the cheapest models, whatever AI_MODEL asks for", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(serverProvider({ GEMINI_API_KEY: "g", AI_MODEL: "gemini-3-pro" })!.model).toBe(CHEAP_MODELS.gemini[0]);
    expect(serverProvider({ GEMINI_API_KEY: "g", AI_MODEL: "gemini-2.5-flash-lite" })!.model).toBe("gemini-2.5-flash-lite");
    for (const list of Object.values(CHEAP_MODELS)) for (const m of list) expect(m).toMatch(/lite|nano|mini|haiku|20b|8b|free/);
  });

  it("keeps the other cheap models as fallbacks", () => {
    const p = serverProvider({ GEMINI_API_KEY: "g" })!;
    expect(p.fallbacks).toEqual(CHEAP_MODELS.gemini.slice(1));
  });
});

describe("running a request", () => {
  it("streams text and reports token usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse(textChunks("Hello ", "there"))));
    const ev = await collect(runProvider(serverProvider({ GEMINI_API_KEY: "g" })!, args()));
    expect(ev.filter((e) => e.t === "text").map((e) => (e as { v: string }).v).join("")).toBe("Hello there");
    expect(ev.at(-1)).toEqual({ t: "done", usage: { input: 10, output: 4 } });
  });

  it("runs tool calls and sends the result back", async () => {
    const runTool = vi.fn(() => ({ spent: 1234 }));
    const fetch = vi.fn().mockResolvedValueOnce(sse(toolCall("get_overview", {}))).mockResolvedValueOnce(sse(textChunks("You spent ₹1,234.")));
    vi.stubGlobal("fetch", fetch);
    const ev = await collect(runProvider(serverProvider({ GEMINI_API_KEY: "g" })!, { ...args(runTool), tools: [{ name: "get_overview", description: "d", input_schema: { type: "object", properties: {} } }] }));
    expect(runTool).toHaveBeenCalledWith("get_overview", expect.objectContaining({}));
    expect(ev).toContainEqual({ t: "tool", name: "get_overview" });
    const second = bodyOf(fetch, 1);
    expect(second.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_1", content: JSON.stringify({ spent: 1234 }) });
    expect(ev.at(-1)).toMatchObject({ t: "done", usage: { input: 30, output: 9 } });
  });

  it("sends tools in a schema Gemini accepts", async () => {
    const fetch = vi.fn(async () => sse(textChunks("ok")));
    vi.stubGlobal("fetch", fetch);
    await collect(runProvider(serverProvider({ GEMINI_API_KEY: "g" })!, { ...args(), tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {}, additionalProperties: false } }] }));
    const params = bodyOf(fetch, 0).tools[0].function.parameters;
    expect(params.additionalProperties).toBeUndefined();
    expect(Object.keys(params.properties).length).toBeGreaterThan(0); // never an empty object
  });

  it("omits tools entirely when there are none", async () => {
    const fetch = vi.fn(async () => sse(textChunks("ok")));
    vi.stubGlobal("fetch", fetch);
    await collect(runProvider(serverProvider({ GEMINI_API_KEY: "g" })!, args()));
    const body = bodyOf(fetch, 0);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.max_tokens).toBe(900);
  });

  it("moves to the next cheap model when one is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetch = vi.fn().mockResolvedValueOnce(jsonError(404, "model not found")).mockResolvedValueOnce(sse(textChunks("ok")));
    vi.stubGlobal("fetch", fetch);
    const ev = await collect(runProvider(serverProvider({ GEMINI_API_KEY: "g" })!, args()));
    expect(bodyOf(fetch, 1).model).toBe(CHEAP_MODELS.gemini[1]);
    expect(ev.at(-1)?.t).toBe("done");
  });
});

describe("backup provider", () => {
  it("switches to the backup straight away when the main one is out of quota", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetch = vi.fn(async (url: unknown) => (hostOf(url).includes("googleapis") ? jsonError(429, "Resource exhausted") : sse(textChunks("from groq"))));
    vi.stubGlobal("fetch", fetch);
    const t0 = Date.now();
    const ev = await collect(runProvider(serverProvider({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" })!, args()));
    expect(Date.now() - t0).toBeLessThan(2000); // no waiting out the rate limit
    expect(fetch.mock.calls.map((c) => hostOf(c[0]))).toEqual(["generativelanguage.googleapis.com", "api.groq.com"]);
    expect(ev.find((e) => e.t === "text")).toEqual({ t: "text", v: "from groq" });
    expect(ev.some((e) => e.t === "error")).toBe(false);
  });

  it("switches when the main one can't be reached at all", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => { if (hostOf(url).includes("googleapis")) throw new TypeError("fetch failed"); return sse(textChunks("ok")); }));
    const ev = await collect(runProvider(serverProvider({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" })!, args()));
    expect(ev.at(-1)?.t).toBe("done");
  });

  it("does not switch on a bad request, and explains the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetch = vi.fn(async () => jsonError(400, "Invalid JSON payload received"));
    vi.stubGlobal("fetch", fetch);
    const ev = await collect(runProvider(serverProvider({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" })!, args()));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ev.at(-1)).toMatchObject({ t: "error", status: 400, v: expect.stringContaining("Invalid JSON payload") });
  });

  it("shows a clear message when there's no backup and the limit is used up", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => jsonError(429, "quota")));
    vi.stubGlobal("setTimeout", ((fn: () => void) => { fn(); return 0; }) as unknown as typeof setTimeout); // skip the retry wait
    const ev = await collect(runProvider(serverProvider({ GEMINI_API_KEY: "g" })!, args()));
    expect(ev.at(-1)).toMatchObject({ t: "error", v: expect.stringContaining("limit is used up") });
  });

  it("explains a bad key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => jsonError(401, "API key not valid")));
    const ev = await collect(runProvider(serverProvider({ GEMINI_API_KEY: "g" })!, args()));
    expect(ev.at(-1)).toMatchObject({ t: "error", v: expect.stringContaining("API key isn't valid") });
  });
});
