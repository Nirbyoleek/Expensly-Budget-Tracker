import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function Setup() {
  if (isConfigured) redirect("/login");
  return (
    <main className="auth">
      <div className="panel">
        <div className="brand">
          <div className="logo">E</div>
          <h1>Connect Expensly to Supabase</h1>
        </div>
        <p className="muted">Expensly stores your data in your own Supabase project. Setup takes about five minutes and the free plan is enough.</p>
        <ol className="steps">
          <li><b>Create a project</b> at supabase.com. Pick the Mumbai region.</li>
          <li><b>Run the schema.</b> Open SQL Editor, paste <code className="inline">supabase/migrations/0001_init.sql</code>, and run it.</li>
          <li><b>Show the login code in emails.</b> In Authentication → Emails → Magic Link, add <code className="inline">{"{{ .Token }}"}</code> to the template.</li>
          <li><b>Add your keys.</b> Copy <code className="inline">.env.example</code> to <code className="inline">.env.local</code> and paste the Project URL and anon key from Project Settings → API.</li>
          <li><b>Restart</b> <code className="inline">npm run dev</code> and reload this page.</li>
        </ol>
        <div className="note"><b>Your keys stay on your computer.</b>Never share the service role key, and never put it in a variable that starts with NEXT_PUBLIC_.</div>
      </div>
    </main>
  );
}
