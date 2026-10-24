import "server-only";
import type { Message, StreamEvent } from "./claude";

/**
 * The same agent loop as claude.ts, for any OpenAI-compatible chat API:
 * OpenAI (ChatGPT models), Google Gemini, Groq, OpenRouter. Streams text, runs tool calls, repeats.
 */

type AnthropicTool = { name: string; description: string; input_schema: object };
type OAIMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string }; extra_content?: unknown }[] }
  | { role: "tool"; tool_call_id: string; content: string };

async function* sse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
      for (const l of chunk.split(/\r?\n/)) {
        if (!l.startsWith("data:")) continue;
        const d = l.slice(5).trim();
        if (d === "[DONE]") return;
        if (d) yield JSON.parse(d);
      }
    }
  }
}

type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; [k: string]: unknown };
function plainSchema(input: object): Schema {
  const clean = (sc: Schema): Schema => {
    const out: Schema = {};
    for (const k of ["type", "description", "enum", "items", "required"]) if (sc[k] !== undefined) out[k] = sc[k];
    if (sc.properties) out.properties = Object.fromEntries(Object.entries(sc.properties).map(([k, v]) => [k, clean(v)]));
    if (out.items && typeof out.items === "object") out.items = clean(out.items as Schema);
    return out;
  };
  const sc = clean(input as Schema);
  if (!sc.properties || !Object.keys(sc.properties).length) {
    sc.properties = { reason: { type: "string", description: "Optional: why you're calling this. Can be left out." } };
  }
  if (Array.isArray(sc.required) && !sc.required.length) delete sc.required;
  return sc;
}

/** Pulls the human-readable reason out of an API error body. */
function errorReason(body: string): string {
  try {
    const j = JSON.parse(body);
    const e = Array.isArray(j) ? j[0]?.error : j.error;
    const m = typeof e === "string" ? e : e?.message;
    if (m) return String(m).replace(/\s+/g, " ").slice(0, 180);
  } catch { /* not JSON */ }
  return body.replace(/\s+/g, " ").slice(0, 120);
}

/** Remembered per server instance, so the model list is only fetched once. */
const discoveredCache = new Map<string, string>();

async function discoverModel(baseUrl: string, key: string, pattern: RegExp, failed: string): Promise<string | null> {
  const cacheKey = baseUrl + pattern.source;
  const hit = discoveredCache.get(cacheKey);
  if (hit && hit !== failed) return hit;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, { headers: { authorization: `Bearer ${key}` } });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { id: string }[] };
    const ids = (body.data ?? []).map((m) => m.id.replace(/^models\//, "")).filter((id) => pattern.test(id) && id !== failed && !/preview|exp/i.test(id));
    // Newest version first (gemini-3.5 before gemini-3.1).
    ids.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (ids[0]) discoveredCache.set(cacheKey, ids[0]);
    return ids[0] ?? null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function* runAgentOpenAI(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Other cheap models to try if this one isn't available on the account. */
  fallbacks?: string[];
  /** Last resort: list the account's models and use the first match (newest first). */
  discover?: RegExp;
  provider: string;
  system: string;
  tools: readonly object[];
  messages: Message[];
  runTool: (name: string, input: Record<string, unknown>) => unknown;
  maxRounds?: number;
  maxTokens?: number;
  extraHeaders?: Record<string, string>;
  noWait?: boolean;
}): AsyncGenerator<StreamEvent> {
  // Gemini accepts only a small subset of JSON Schema, so send the plainest form that works everywhere:
  // no additionalProperties / minimum / maximum, and never an empty parameter list.
  const tools = (opts.tools as AnthropicTool[]).map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: plainSchema(t.input_schema) } }));
  const messages: OAIMessage[] = [
    { role: "system", content: opts.system },
    ...opts.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }) as OAIMessage),
  ];
  const usage = { input: 0, output: 0 };
  let model = opts.model;
  const fallbacks = [...(opts.fallbacks ?? [])];
  let discovered = false;

  for (let round = 0; round < (opts.maxRounds ?? 6); round++) {
    let res: Response | null = null;
    // Free tiers rate-limit per minute; wait once and retry rather than failing straight away.
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}`, ...opts.extraHeaders },
        body: JSON.stringify({ model, messages, ...(tools.length ? { tools, tool_choice: "auto" } : {}), stream: true, max_tokens: opts.maxTokens ?? 1500, temperature: 0.3 }),
      });
      // Model not on this account: move to the next cheap model and retry.
      if ((res.status === 404 || res.status === 400) && !fallbacks.length && opts.discover && !discovered) {
        discovered = true;
        const found = await discoverModel(opts.baseUrl, opts.apiKey, opts.discover, model);
        if (found) { console.warn(`${opts.provider}: using ${found} from the account's model list`); fallbacks.push(found); }
      }
      if ((res.status === 404 || res.status === 400) && fallbacks.length) {
        const detail = await res.text().catch(() => "");
        if (res.status === 404 || /model/i.test(detail)) { console.warn(`${opts.provider}: ${model} unavailable, trying ${fallbacks[0]}`); model = fallbacks.shift()!; attempt--; continue; }
        res = new Response(detail, { status: res.status });
        break;
      }
      // With a backup service ready, switch to it straight away instead of waiting out the limit.
      if (res.status !== 429 || attempt === 1 || opts.noWait) break;
      const wait = Math.min(20, Number(res.headers.get("retry-after")) || 8);
      await res.body?.cancel();
      yield { t: "tool", name: "__wait" };
      await sleep(wait * 1000);
    }
    if (!res || !res.ok || !res.body) {
      const status = res?.status ?? 0;
      const detail = (await res?.text().catch(() => "")) ?? "";
      const reason = errorReason(detail);
      console.error(`${opts.provider} error`, status, model, detail.slice(0, 500));
      const badKey = status === 401 || status === 403 || /api key not valid|invalid api key|api_key_invalid|permission/i.test(detail);
      yield {
        t: "error",
        status,
        v: badKey ? `The ${opts.provider} API key isn't valid or isn't allowed to use this model. Check the key on the server.`
          : status === 429 ? `The ${opts.provider} limit is used up for now. Try again in a minute.`
          : status === 404 ? `The AI model isn't available on this ${opts.provider} account.`
          : `${opts.provider} rejected the request (${status}): ${reason || "no details"}`,
      };
      return;
    }

    let text = "";
    let finish = "";
    // Gemini 3 attaches a "thought signature" to each tool call that must be sent back unchanged.
    const calls: { id: string; name: string; args: string; extra?: unknown }[] = [];
    for await (const ev of sse(res.body)) {
      if (ev.usage) { usage.input += ev.usage.prompt_tokens ?? 0; usage.output += ev.usage.completion_tokens ?? 0; }
      if (ev.x_groq?.usage) { usage.input += ev.x_groq.usage.prompt_tokens ?? 0; usage.output += ev.x_groq.usage.completion_tokens ?? 0; }
      const ch = ev.choices?.[0];
      if (!ch) continue;
      const d = ch.delta ?? {};
      if (typeof d.content === "string" && d.content) { text += d.content; yield { t: "text", v: d.content }; }
      for (const tc of d.tool_calls ?? []) {
        const i = tc.index ?? calls.length;
        calls[i] ??= { id: tc.id ?? `call_${round}_${i}`, name: "", args: "" };
        if (tc.id) calls[i].id = tc.id;
        if (tc.function?.name) calls[i].name += tc.function.name;
        if (tc.function?.arguments) calls[i].args += tc.function.arguments;
        if (tc.extra_content) calls[i].extra = tc.extra_content;
      }
      if (ch.finish_reason) finish = ch.finish_reason;
    }

    const live = calls.filter((c) => c && c.name);
    if (!live.length || (finish && finish !== "tool_calls" && finish !== "function_call" && !live.length)) {
      yield { t: "done", usage };
      return;
    }
    for (const c of live) yield { t: "tool", name: c.name };
    messages.push({ role: "assistant", content: text || "", tool_calls: live.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args || "{}" }, ...(c.extra ? { extra_content: c.extra } : {}) })) });
    for (const c of live) {
      let content: string;
      try {
        content = JSON.stringify(opts.runTool(c.name, c.args ? JSON.parse(c.args) : {}));
      } catch (e) {
        content = JSON.stringify({ error: e instanceof Error ? e.message : "Tool failed" });
      }
      messages.push({ role: "tool", tool_call_id: c.id, content });
    }
    if (text.trim()) yield { t: "text", v: "\n\n" };
  }
  yield { t: "error", v: "That question needed too many steps. Try asking something narrower." };
}
