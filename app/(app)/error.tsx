"use client";

import { useEffect } from "react";
import { reportClientError } from "@/app/error-actions";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error.message || "Unknown error", window.location.pathname, error.digest).catch(() => undefined);
  }, [error]);
  return (
    <section className="card stack" role="alert">
      <h2>That didn&apos;t load</h2>
      <p className="muted">{error.message || "Something went wrong while loading your data."} Check your connection, then try again. The problem has been reported.</p>
      <button className="btn" onClick={reset}>Try again</button>
    </section>
  );
}
