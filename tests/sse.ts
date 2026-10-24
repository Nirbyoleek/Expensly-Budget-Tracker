/** Build fake streaming chat responses (Server-Sent Events), the way OpenAI-compatible APIs send them. */
export function sse(events: unknown[], status = 200): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}
export const textChunks = (...parts: string[]) => [
  ...parts.map((p) => ({ choices: [{ delta: { content: p } }] })),
  { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 4 } },
];
export const toolCall = (name: string, args: object, id = "call_1") => [
  { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }] },
  { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 20, completion_tokens: 5 } },
];
export const jsonError = (status: number, message: string) => new Response(JSON.stringify({ error: { message } }), { status });
