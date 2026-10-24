import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/** Acts as the signed-in user, so row-level security applies to every query. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a server component: middleware refreshes the session instead.
        }
      },
    },
  });
}

/** Bypasses row-level security. Only for the SMS ingest route and account deletion. */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createAdmin(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
