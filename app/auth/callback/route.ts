import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/track";

/** Where Google sign-in lands. Swaps the one-time code for a session cookie. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const supabase = await createClient();
  const { data: session, error } = code ? await supabase.auth.exchangeCodeForSession(code) : { data: null, error: new Error("missing code") };
  // a Google account created in the last minute is a new sign-up
  if (!error && session?.user) track(supabase, Date.now() - new Date(session.user.created_at).getTime() < 60000 ? "signup" : "sign_in", { method: "google" });
  // Only same-site paths are allowed as the destination.
  const next = url.searchParams.get("next");
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";
  return NextResponse.redirect(new URL(error ? "/login?error=oauth" : dest, url.origin));
}
