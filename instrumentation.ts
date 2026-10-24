/** Next.js calls this for every unhandled server error (pages, server actions, API routes). */
export async function onRequestError(err: unknown, request: { path: string; method: string }, context: { routePath?: string; routeType?: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logError } = await import("@/lib/errors");
  const e = err as Error & { digest?: string };
  await logError("server", `${e?.name ?? "Error"}: ${e?.message ?? String(err)}`, { path: `${request.method} ${context.routePath ?? request.path}`, digest: e?.digest });
}
