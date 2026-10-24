import Link from "next/link";

export const metadata = { title: "Your data · Expensly" };

/** Plain-language data notice. Public, linked from sign-in and Settings. */
export default function Privacy() {
  const contact = process.env.CONTACT_EMAIL;
  return (
    <main className="auth" style={{ placeItems: "start center" }}>
      <article className="panel prose" style={{ maxWidth: 640 }}>
        <div className="brand"><div className="logo">E</div><h1>How Expensly handles your data</h1></div>
        <p className="muted">Last updated 24 October 2026. Written to be read, not to impress lawyers.</p>

        <h2>What we keep</h2>
        <ul>
          <li>Your email and a password (stored hashed by Supabase, our database provider).</li>
          <li>The transactions you add or import: date, amount, merchant text, category and any note.</li>
          <li>Things you set up: budgets, income, accounts, goals, rules and reminder preferences.</li>
          <li>A count of your AI questions, to apply daily limits.</li>
        </ul>

        <h2>What we don&apos;t keep</h2>
        <ul>
          <li><b>Statement files.</b> PDFs and CSVs are read in your browser; only the transactions you choose to add are saved. PDF passwords never leave your device.</li>
          <li>Bank logins, card numbers or UPI PINs. Expensly never asks for them.</li>
        </ul>

        <h2>Where it lives and who sees it</h2>
        <ul>
          <li>Your data is stored with <b>Supabase</b> in its Mumbai (India) region and protected so only your login can read it.</li>
          <li>The app runs on <b>Vercel</b>.</li>
          <li><b>AI features</b> send your question and the figures needed to answer it to Google (Gemini) or Groq to answer it. Their own terms cover what they do with requests; on Google&apos;s free tier that can include using them to improve its products. When the AI sorts unfamiliar merchants, only the merchant name is sent, never amounts or your identity, and the answer is saved in a shared list of business names so it isn&apos;t looked up twice.</li>
          <li>Reminders pass through Apple&apos;s or Google&apos;s push service as an empty signal; the message itself is fetched from Expensly after you&apos;re signed in.</li>
          <li>We don&apos;t sell your data, show ads or share it with anyone else.</li>
        </ul>

        <h2>Your choices</h2>
        <ul>
          <li><b>Download a copy</b> of everything any time: Settings → Your data.</li>
          <li><b>Delete your account</b> in Settings → Your data. Your login and all your data are removed immediately.</li>
          <li>Turn reminders off, or any kind of reminder, in Settings → Reminders.</li>
        </ul>
        {contact && <p>Questions or requests: <a className="link" href={`mailto:${contact}`}>{contact}</a></p>}
        <p><Link className="link" href="/home">← Back to Expensly</Link></p>
      </article>
    </main>
  );
}
