import "server-only";

/**
 * A minimal Claude Messages API client: streams text, collects tool calls, runs them, repeats.
 * Plain fetch, no SDK, so there's nothing extra to install.
 */

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type Message = { role: "user" | "assistant"; content: string | (TextBlock | ToolUseBlock | ToolResultBlock)[] };

export type StreamEvent =
  | { t: "text"; v: string }
  | { t: "tool"; name: string }
  | { t: "done"; usage: { input: number; output: number } }
  | { t: "error"; v: string; status?: number };

const API = "https://api.anthropic.com/v1/messages";

async function* sse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (data) yield JSON.parse(data);
    }
  }
}

export async function* runAgent(opts: {
  apiKey: string;
  model: string;
  system: string;
  tools: readonly object[];
  messages: Message[];
  runTool: (name: string, input: Record<string, unknown>) => unknown;
  maxRounds?: number;
  maxTokens?: number;
}): AsyncGenerator<StreamEvent> {
  const messages = [...opts.messages];
  const usage = { input: 0, output: 0 };
  // Cache the long, unchanging part (system prompt + tool definitions) between rounds and questions.
  const tools = opts.tools.map((t, i) => (i === opts.tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t));

  for (let round = 0; round < (opts.maxRounds ?? 6); round++) {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 1500,
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        ...(tools.length ? { tools } : {}),
        messages,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      const msg = res.status === 401 ? "The Anthropic API key isn't valid." : res.status === 429 ? "Ask Expensly is busy right now. Try again in a minute." : res.status === 529 ? "Claude is overloaded right now. Try again shortly." : `Ask Expensly couldn't reach Claude (${res.status}).`;
      console.error("anthropic error", res.status, detail.slice(0, 300));
      yield { t: "error", v: msg };
      return;
    }

    const blocks: (TextBlock | (ToolUseBlock & { json: string }))[] = [];
    let stop = "";
    for await (const ev of sse(res.body)) {
      if (ev.type === "message_start") usage.input += ev.message?.usage?.input_tokens ?? 0;
      else if (ev.type === "content_block_start") {
        const b = ev.content_block;
        blocks[ev.index] = b.type === "tool_use" ? { type: "tool_use", id: b.id, name: b.name, input: {}, json: "" } : { type: "text", text: "" };
        if (b.type === "tool_use") yield { t: "tool", name: b.name };
      } else if (ev.type === "content_block_delta") {
        const b = blocks[ev.index];
        if (ev.delta.type === "text_delta" && b?.type === "text") {
          b.text += ev.delta.text;
          yield { t: "text", v: ev.delta.text };
        } else if (ev.delta.type === "input_json_delta" && b?.type === "tool_use") b.json += ev.delta.partial_json;
      } else if (ev.type === "message_delta") {
        stop = ev.delta?.stop_reason ?? stop;
        usage.output += ev.usage?.output_tokens ?? 0;
      } else if (ev.type === "error") {
        yield { t: "error", v: "Claude stopped unexpectedly. Try asking again." };
        return;
      }
    }

    const content = blocks.filter(Boolean).map((b) => {
      if (b.type !== "tool_use") return b;
      let input: Record<string, unknown> = {};
      try { input = b.json ? JSON.parse(b.json) : {}; } catch { /* leave empty */ }
      return { type: "tool_use" as const, id: b.id, name: b.name, input };
    });
    messages.push({ role: "assistant", content });

    if (stop !== "tool_use") {
      yield { t: "done", usage };
      return;
    }

    const results: ToolResultBlock[] = content
      .filter((b): b is ToolUseBlock => b.type === "tool_use")
      .map((b) => {
        try {
          return { type: "tool_result", tool_use_id: b.id, content: JSON.stringify(opts.runTool(b.name, b.input)) };
        } catch (e) {
          return { type: "tool_result", tool_use_id: b.id, content: `Tool failed: ${e instanceof Error ? e.message : "unknown error"}`, is_error: true };
        }
      });
    messages.push({ role: "user", content: results });
    // Separate the text of one round from the next.
    if (content.some((b) => b.type === "text" && b.text.trim())) yield { t: "text", v: "\n\n" };
  }
  yield { t: "error", v: "That question needed too many steps. Try asking something narrower." };
}
