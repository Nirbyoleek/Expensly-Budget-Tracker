"use client";

import { useState, useTransition } from "react";
import { setPassword } from "@/app/actions";
import { useApp } from "@/components/app";

/** Set or change the password, so signing in is email + password instead of an email link. */
export default function PasswordCard({ email }: { email: string }) {
  const { toast } = useApp();
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    start(async () => {
      const r = await setPassword(pw);
      if (!r.ok) return setError(r.error);
      setPw("");
      toast("Password saved. Next time, sign in with email and password.");
    });
  };
  return (
    <section className="card stack" id="password">
      <h2>Password</h2>
      <p className="muted" style={{ fontSize: 14 }}>Set a password to sign in instantly, including from the iPhone home-screen app. No more waiting for email links.</p>
      <form className="stack" onSubmit={save}>
        <input type="email" name="email" autoComplete="username" value={email} hidden readOnly />
        <label className="lbl" htmlFor="new-password">NEW PASSWORD
          <span className="pw">
            <input id="new-password" className="field" type={show ? "text" : "password"} autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" />
            <button type="button" className="link pw-toggle" onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</button>
          </span>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn ghost" disabled={pending || pw.length < 8}>{pending ? "Saving…" : "Save password"}</button>
      </form>
    </section>
  );
}
