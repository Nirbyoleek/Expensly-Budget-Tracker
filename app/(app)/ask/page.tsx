import Header from "@/components/Header";
import AskView from "@/components/ask/AskView";
import { requireUser } from "@/lib/data";
import { serverProvider } from "@/lib/ai/provider";
import { LIMITS } from "@/lib/ai/limits";
import { todayISO } from "@/lib/dates";

export const metadata = { title: "Ask · Expensly" };

export default async function AskPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ q }, { user, supabase }] = await Promise.all([searchParams, requireUser()]);
  const [{ data: used }, { data: override }] = await Promise.all([
    supabase.from("ai_usage").select("questions").eq("day", todayISO()).maybeSingle(),
    supabase.from("ai_limits").select("daily_questions,enabled").maybeSingle(),
  ]);
  const allowed = (process.env.AI_ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const server = serverProvider();
  const ai = server && (!allowed.length || allowed.includes((user.email ?? "").toLowerCase())) ? server.label : null;
  return (
    <>
      <Header title="Ask Expensly" subtitle="Your money, answered" />
      <AskView
        ai={ai}
        initial={q?.slice(0, 500)}
        usage={{ today: (used?.questions as number | undefined) ?? 0, limit: (override?.daily_questions as number | null | undefined) ?? LIMITS.server.daily, enabled: override?.enabled !== false }}
      />
    </>
  );
}
