import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAccounts, getBudgetRows, getCategories, getGoals, getIncomePlans, getProfile, getRecentTransactions } from "@/lib/data";
import { todayISO, longDate } from "@/lib/dates";
import type { Message } from "@/lib/ai/claude";
import { runProvider } from "@/lib/ai/provider";
import { aiProviderFor, recordTokens, takeAi } from "@/lib/ai/gate";
import { runTool, TOOL_LABEL, TOOLS, type AiContext, type ToolName } from "@/lib/ai/tools";
import { answerQuestion } from "@/lib/ask";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_QUESTION = 1000;


const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(24)
    .refine((m) => m[m.length - 1].role === "user", "The last message must be a question.")
    .refine((m) => m[m.length - 1].text.length <= MAX_QUESTION, `Keep questions under ${MAX_QUESTION} characters.`),
});

function system(name: string, today: string) {
  return `You are Expensly, a personal finance assistant inside ${name ? `${name}'s` : "the user's"} budgeting app in India. Today is ${longDate(today)} (${today}). Money is in Indian rupees.

How to work:
- Answer from the user's real data. Call tools to get numbers; never guess or invent a figure, merchant or date. If the data doesn't cover something (it holds about the last 6 months), say so.
- Prefer one or two well-chosen tool calls. For comparisons, call spending_summary for each period.
- Card bill payments and transfers between accounts are not spending. Investments (SIPs etc.) are savings, not spending. Refunds reduce spending.

How to answer:
- Lead with the direct answer in the first sentence, with the key number in **bold**.
- Then at most 3–5 short bullets or sentences of supporting detail, and one concrete, specific suggestion when it's useful (e.g. "Swiggy averages ₹410 an order, 11 orders this month; cutting to 6 would save about ₹2,000").
- Format amounts the Indian way: ₹1,23,456 (no decimals unless under ₹100), and ₹1.2L / ₹45k for rough figures.
- Plain, warm, direct. No preamble like "Great question", no restating the question, no headings, no tables.
- You can't change anything in the app. If the user wants to change data, tell them where: Activity (edit or re-categorise), Budgets, Wealth (accounts, goals), Settings (income).
- For investing, tax or loan decisions, give the factual picture from their data and general considerations; don't tell them what to buy.

Charts:
- When a small chart makes the answer clearer (a trend over months, a split across 3–8 categories or merchants, this vs last month), include ONE chart block on its own lines, after the first sentence:
\`\`\`chart
{"type":"bar","title":"Food delivery by month","data":[{"label":"Jul","value":4200},{"label":"Aug","value":5100}]}
\`\`\`
- "type" is "bar" (comparisons, splits) or "line" (trends over time). Values are rupees as plain numbers. Use only numbers from tools. Skip the chart for simple one-number answers.

Follow-ups:
- End every answer with one final line exactly like: FOLLOWUPS: <question> | <question> | <question>
- Three short questions (under 8 words each) the user would naturally ask next, specific to their data.`;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in first.", { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return new Response(e instanceof z.ZodError ? e.issues[0]?.message ?? "That question couldn't be read." : "That question couldn't be read.", { status: 400 });
  }

  const today = todayISO();
  const [tx, cats, budgetRows, accounts, goals, incomePlans, profile] = await Promise.all([
    getRecentTransactions(), getCategories(), getBudgetRows(), getAccounts(), getGoals(), getIncomePlans(), getProfile(),
  ]);
  const ctx: AiContext = { today, tx, cats, budgetRows, accounts, goals, incomePlans };
  const question = body.messages[body.messages.length - 1].text;

  const enc = new TextEncoder();
  const line = (o: object) => enc.encode(JSON.stringify(o) + "\n");
  const headers = { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" };

  // No central key configured (or this person isn't allowed): answer with the built-in rules.
  if (!aiProviderFor(user)) {
    const answer = answerQuestion(question, { today, tx, cats, budgetRows, accounts, incomePlans });
    return new Response(new ReadableStream({ start(c) { c.enqueue(line({ t: "meta", mode: "basic" })); c.enqueue(line({ t: "text", v: answer })); c.enqueue(line({ t: "done" })); c.close(); } }), { headers });
  }

  const gate = await takeAi(supabase, user, today, "ask");
  if (!gate.ok) return new Response(new ReadableStream({ start(c) { c.enqueue(line({ t: "error", v: gate.error })); c.close(); } }), { headers });
  const provider = gate.provider;

  const messages: Message[] = body.messages.slice(-12).map((m) => ({ role: m.role, content: m.text }));
  if (messages[0].role !== "user") messages.shift();

  const stream = new ReadableStream({
    async start(c) {
      c.enqueue(line({ t: "meta", mode: "ai", provider: provider.label, left: gate.leftToday }));
      let tokens = { input: 0, output: 0 };
      try {
        for await (const ev of runProvider(provider, {
          system: system(profile.name, today),
          tools: TOOLS,
          messages,
          runTool: (name, input) => runTool(name, input, ctx),
          maxTokens: 1100,
        })) {
          if (ev.t === "tool") c.enqueue(line({ t: "tool", name: ev.name, v: ev.name === "__wait" ? "Waiting for the AI's rate limit" : TOOL_LABEL[ev.name as ToolName] ?? "Working" }));
          else if (ev.t === "done") tokens = ev.usage;
          else c.enqueue(line(ev));
        }
      } catch (e) {
        console.error("ask failed", e);
        c.enqueue(line({ t: "error", v: "Something went wrong. Try again." }));
      }
      // Record tokens before closing, so the serverless function doesn't stop first.
      await recordTokens(supabase, today, tokens);
      c.enqueue(line({ t: "done" }));
      c.close();
    },
  });
  return new Response(stream, { headers });
}
