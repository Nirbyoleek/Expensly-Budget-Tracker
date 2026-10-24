import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

type Source = "server" | "client" | "ai" | "cron";

/** Record an error for the owner's daily report. Never throws: logging must not cause more errors. */
export async function logError(source: Source, message: string, extra: { path?: string | null; digest?: string | null; userId?: string | null } = {}) {
  try {
    const db = createServiceClient();
    if (!db) return;
    await db.from("app_errors").insert({
      source,
      message: message.replace(/\s+/g, " ").slice(0, 500),
      path: extra.path?.slice(0, 200) ?? null,
      digest: extra.digest?.slice(0, 80) ?? null,
      user_id: extra.userId ?? null,
    });
  } catch {
    /* ignore */
  }
}

export const ownerEmail = () => (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
