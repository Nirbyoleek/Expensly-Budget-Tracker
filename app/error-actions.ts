"use server";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";

/** The in-app error screen reports what broke, so it shows up in the owner's daily report. */
export async function reportClientError(message: string, path: string, digest?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  await logError("client", String(message).slice(0, 500), { path: String(path).slice(0, 200), digest: digest ?? null, userId: user?.id ?? null });
}
