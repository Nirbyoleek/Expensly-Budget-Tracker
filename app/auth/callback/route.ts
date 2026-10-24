import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Where Google sign-in lands. Swaps the one-time code for a session cookie. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const supabase = await createClient();
  const { error } = code ? await supabase.auth.exchangeCodeForSession(code) : { error: new Error("missing code") };
  // Only same-site paths are allowed as the destination.
  const next = url.searchParams.get("next");
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";
  return NextResponse.redirect(new URL(error ? "/login?error=oauth" : dest, url.origin));
}
