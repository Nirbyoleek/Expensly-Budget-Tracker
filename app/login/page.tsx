import LoginForm from "./LoginForm";
import { GaugeArc } from "@/components/charts";
import OrbLazy from "@/components/three/OrbLazy";

export const metadata = { title: "Sign in · Expensly" };

const FEATURES = [
  ["↧", "Import any card or bank statement", "CSV or PDF, read on your device. CRED card payments are left out so nothing counts twice."],
  ["✉", "Paste a UPI alert, done", "Amount, merchant and category come straight out of the SMS."],
  ["◎", "One number to live by", "What you can spend today, after the bills still to come."],
] as const;

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="auth">
      <section className="auth-showcase only-desktop" aria-hidden="true">
        <OrbLazy className="showcase-orb" />
        <div className="brand">
          <div className="logo">E</div>
          <b className="showcase-name">Expensly</b>
        </div>
        <h2 className="showcase-title">Know what&apos;s safe to spend today.</h2>
        <div className="showcase-card hero">
          <div className="gauge">
            <GaugeArc used={0.61} pace={0.71} />
            <div className="center">
              <div className="eyebrow">Safe to spend today</div>
              <div className="big">₹1,803</div>
              <div className="per">a day for the next 10 days</div>
            </div>
          </div>
        </div>
        <ul className="showcase-list">
          {FEATURES.map(([g, t, d]) => (
            <li key={t}>
              <span className="glyph-box" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{g}</span>
              <span><b>{t}</b><small>{d}</small></span>
            </li>
          ))}
        </ul>
      </section>

      <OrbLazy className="mobile-orb only-mobile" />
      <div className="panel">
        <div className="brand">
          <div className="logo">E</div>
          <div>
            <h1>
              <span className="only-mobile">Expensly</span>
              <span className="only-desktop">Sign in</span>
            </h1>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 17 }}>
          <span className="only-mobile">Know what&apos;s safe to spend today. Log spends in seconds, import card statements, and see where every rupee went.</span>
          <span className="only-desktop">Welcome back. New here? Create an account in seconds.</span>
        </p>
        {error === "oauth" && <p className="error" role="alert">Google sign-in didn&apos;t finish. Try again, or use your email and password.</p>}
        <LoginForm google={process.env.AUTH_GOOGLE === "on"} />
      </div>
    </main>
  );
}
