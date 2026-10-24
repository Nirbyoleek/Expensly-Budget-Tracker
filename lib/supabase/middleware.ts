import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isConfigured } from "@/lib/env";

const PUBLIC = ["/login", "/setup", "/auth", "/api/ingest", "/api/cron", "/manifest.webmanifest", "/sw.js", "/privacy"];

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!isConfigured) {
    return path.startsWith("/setup") ? NextResponse.next() : NextResponse.redirect(new URL("/setup", request.url));
  }

  // Supabase falls back to the Site URL ("/") when the callback isn't on its allow list.
  const code = request.nextUrl.searchParams.get("code");
  if (code && path === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refreshes the session cookie. Must run before any redirect decision.
  const { data: { user } } = await supabase.auth.getUser();

  const isPublic = PUBLIC.some((p) => path.startsWith(p));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && (path === "/login" || path === "/" || path === "/setup")) {
    return NextResponse.redirect(new URL("/home", request.url));
  }
  return response;
}
