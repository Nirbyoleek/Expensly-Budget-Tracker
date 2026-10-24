import "server-only";
import { runAgent, type Message, type StreamEvent } from "./claude";
import { runAgentOpenAI } from "./openai";
import { PROVIDER_BY_ID, type ProviderId } from "./catalog";
import { logError } from "@/lib/errors";

export type Provider = { id: ProviderId; label: string; key: string; model: string; fallbacks?: string[]; discover?: RegExp; baseUrl?: string; headers?: Record<string, string>; own: boolean; backup?: Provider };

const BASE: Record<ProviderId, string | undefined> = {
  anthropic: undefined,
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

/**
 * Only the cheapest model tier of each service is ever used, cheapest first; later ones are
 * fallbacks if the first isn't available. AI_MODEL can pick one of these, nothing else.
 */
/** If none of the listed models exist on the account, ask the service and pick one whose name matches. */
const CHEAP_PATTERN: Partial<Record<ProviderId, RegExp>> = {
  gemini: /^gemini-[\d.]+-flash-lite$/,
  openai: /^gpt-[\d.]+-nano$/,
  groq: /^openai\/gpt-oss-20b$|8b-instant$/,
};

export const CHEAP_MODELS: Record<ProviderId, string[]> = {
  gemini: ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"],
  openai: ["gpt-4.1-nano", "gpt-4o-mini"],
  anthropic: ["claude-haiku-5-5"],
  // llama-3.1-8b is cheaper still, but too small to use Expensly's data tools reliably.
  groq: ["openai/gpt-oss-20b", "llama-3.1-8b-instant"],
  openrouter: ["openai/gpt-oss-20b:free", "meta-llama/llama-3.3-70b-instruct:free"],
};
const PREFERRED = CHEAP_MODELS;

export function makeProvider(id: ProviderId, key: string, model: string, own: boolean): Provider {
  return { id, label: PROVIDER_BY_ID[id].name, key, model, baseUrl: BASE[id], own, headers: id === "openrouter" ? { "X-Title": "Expensly" } : undefined };
}

/** The app owner's server-side key, if one is configured (used when someone hasn't connected their own). */
export function serverProvider(env = process.env): Provider | null {
  const asked = env.AI_MODEL?.trim();
  const order: [ProviderId, string | undefined][] = [["anthropic", env.ANTHROPIC_API_KEY], ["openai", env.OPENAI_API_KEY], ["gemini", env.GEMINI_API_KEY], ["groq", env.GROQ_API_KEY], ["openrouter", env.OPENROUTER_API_KEY]];
  const build = (id: ProviderId, key: string): Provider => {
    // Ignore any request for a bigger (pricier) model.
    if (asked && !CHEAP_MODELS[id].includes(asked) && id === available[0][0]) console.warn(`AI_MODEL "${asked}" ignored: only ${CHEAP_MODELS[id].join(", ")} are allowed for ${id}.`);
    const model = asked && CHEAP_MODELS[id].includes(asked) ? asked : CHEAP_MODELS[id][0];
    return { ...makeProvider(id, key, model, false), fallbacks: CHEAP_MODELS[id].filter((x) => x !== model), discover: CHEAP_PATTERN[id] };
  };
  const available = order.filter((o): o is [ProviderId, string] => !!o[1]);
  if (!available.length) return null;
  const primary = build(...available[0]);
  // A second key (say Groq behind Gemini) takes over when the first is out of quota or down.
  if (available[1]) primary.backup = build(...available[1]);
  return primary;
}

/** Errors a different service could get past: limits, outages, a model missing. Not a malformed question. */
const switchable = (status?: number) => !status || status === 429 || status === 404 || status === 401 || status === 403 || status === 402 || status >= 500;

/** Checks a key works and picks the best model it can use. */
export async function verifyKey(id: ProviderId, key: string): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  try {
    const res = id === "anthropic"
      ? await fetch("https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } })
      : await fetch(`${BASE[id]}/models`, { headers: { authorization: `Bearer ${key}` } });
    if (res.status === 401 || res.status === 403 || res.status === 400) return { ok: false, error: `That ${PROVIDER_BY_ID[id].name} key didn't work. Check you copied all of it.` };
    if (!res.ok) return { ok: false, error: `${PROVIDER_BY_ID[id].name} didn't respond (${res.status}). Try again in a moment.` };
    const body = (await res.json()) as { data?: { id: string }[]; models?: { name?: string; id?: string }[] };
    const ids = new Set((body.data ?? body.models ?? []).map((m) => ("id" in m && m.id ? m.id : (m as { name?: string }).name ?? "").replace(/^models\//, "")));
    const model = PREFERRED[id].find((m) => ids.has(m)) ?? PREFERRED[id][0];
    return { ok: true, model };
  } catch {
    return { ok: false, error: `Couldn't reach ${PROVIDER_BY_ID[id].name}. Check your connection and try again.` };
  }
}

type RunArgs = { system: string; tools: readonly object[]; messages: Message[]; runTool: (name: string, input: Record<string, unknown>) => unknown; maxTokens?: number };

function runOne(p: Provider, args: RunArgs, noWait: boolean): AsyncGenerator<StreamEvent> {
  // Short, focused answers keep the cost down too.
  if (p.id === "anthropic") return runAgent({ apiKey: p.key, model: p.model, maxTokens: 900, ...args });
  return runAgentOpenAI({ apiKey: p.key, model: p.model, fallbacks: p.fallbacks, discover: p.discover, baseUrl: p.baseUrl!, provider: p.label, extraHeaders: p.headers, maxTokens: 900, noWait, ...args });
}

/**
 * Run on the main service; if it fails before writing any answer (out of quota, down, model gone),
 * quietly start again on the backup. Once text has streamed, an error is shown as is.
 */
export async function* runProvider(p: Provider, args: RunArgs): AsyncGenerator<StreamEvent> {
  let wrote = false;
  // Final failures go in the owner's daily report; so does each switch to the backup (usually quota).
  const viaBackup = async function* (b: Provider, why: string): AsyncGenerator<StreamEvent> {
    void logError("ai", `${p.label} ${why}: answered by ${b.label} instead`);
    for await (const ev of runOne(b, args, false)) {
      if (ev.t === "error") void logError("ai", `${b.label} (backup) failed too: ${ev.v}`);
      yield ev;
    }
  };
  try {
    for await (const ev of runOne(p, args, !!p.backup)) {
      if (ev.t === "error" && !wrote && p.backup && switchable(ev.status)) {
        console.warn(`${p.label} failed (${ev.status ?? "?"}): switching to ${p.backup.label}`);
        yield* viaBackup(p.backup, `failed (${ev.status ?? "?"})`);
        return;
      }
      if (ev.t === "error") void logError("ai", `${p.label}: ${ev.v}`);
      if (ev.t === "text") wrote = true;
      yield ev;
    }
  } catch (e) {
    // couldn't connect at all
    if (wrote || !p.backup) { void logError("ai", `${p.label} unreachable: ${e instanceof Error ? e.message : e}`); throw e; }
    console.warn(`${p.label} unreachable: switching to ${p.backup.label}`, e);
    yield* viaBackup(p.backup, "unreachable");
  }
}
