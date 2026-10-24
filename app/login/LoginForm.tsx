"use client";

import { useEffect, useState, useTransition } from "react";
import { signInWithPassword, signUpWithPassword, startGoogleSignIn } from "@/app/actions";

type Mode = "signin" | "signup";

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

/** Email + password (no emails are ever sent), plus Google once it's switched on. */
export default function LoginForm({ google }: { google: boolean }) {
  // Signed out: forget the pages this phone kept for offline use, and anything waiting to sync.
  useEffect(() => {
    try { navigator.serviceWorker?.controller?.postMessage("clear-pages"); localStorage.removeItem("expensly.offline-queue.v1"); } catch { /* not supported */ }
  }, []);
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [forgot, setForgot] = useState(false);
  const [pending, start] = useTransition();

  const go = (m: Mode) => { setMode(m); setError(""); setForgot(false); };

  const googleSignIn = () => {
    setError("");
    start(async () => {
      const r = await startGoogleSignIn();
      if (r.ok) window.location.href = r.url;
      else setError(r.error);
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    start(async () => {
      const r = mode === "signin" ? await signInWithPassword(email, password) : await signUpWithPassword(email, password);
      if (r && !r.ok) setError(r.error); // success redirects
    });
  };

  return (
    <div className="stack auth-form">
      {google && (
        <>
          <button className="btn google-btn" disabled={pending} onClick={googleSignIn}><GoogleIcon /> Continue with Google</button>
          <div className="or"><span>or</span></div>
        </>
      )}

      <div className="seg" role="tablist" aria-label="Sign in or create account">
        <button type="button" role="tab" aria-selected={mode === "signin"} aria-pressed={mode === "signin"} onClick={() => go("signin")}>Sign in</button>
        <button type="button" role="tab" aria-selected={mode === "signup"} aria-pressed={mode === "signup"} onClick={() => go("signup")}>Create account</button>
      </div>

      <form className="card stack" onSubmit={submit}>
        <label className="lbl" htmlFor="email">EMAIL
          <input id="email" className="field" type="email" name="email" autoComplete={mode === "signup" ? "email" : "username"} inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </label>
        <label className="lbl" htmlFor="password">PASSWORD
          <span className="pw">
            <input id="password" className="field" type={show ? "text" : "password"} name="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "signup" ? "At least 8 characters" : "Your password"} />
            <button type="button" className="link pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>{show ? "Hide" : "Show"}</button>
          </span>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" disabled={pending || !email || !password}>
          {pending ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
        {mode === "signup" && <p className="hint">You&apos;re signed in straight away; no email to confirm. Let your browser or iCloud Keychain save the password for one-tap sign-in next time. <a className="link" href="/privacy">How your data is handled</a></p>}
      </form>

      {mode === "signin" && (
        <div className="auth-links">
          <button className="link muted-link" onClick={() => setForgot((f) => !f)} aria-expanded={forgot}>Forgot your password?</button>
        </div>
      )}
      {forgot && (
        <p className="hint" style={{ padding: "0 4px" }}>
          If you&apos;re still signed in on another device, open <b>Settings → Password</b> there and set a new one. Otherwise, ask the app owner to reset it for you.
        </p>
      )}
    </div>
  );
}
