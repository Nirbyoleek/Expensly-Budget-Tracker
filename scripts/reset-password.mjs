#!/usr/bin/env node
// Resets someone's Expensly password without any email. For the app owner only.
// Run from the project folder:  npm run reset-password
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, "")]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, hidden = false) =>
  new Promise((resolve) => {
    if (hidden) {
      // Don't echo the password as it's typed.
      const write = rl._writeToOutput.bind(rl);
      rl._writeToOutput = (s) => write(s.startsWith(q) ? s : "");
      rl.question(q, (a) => { rl._writeToOutput = write; process.stdout.write("\n"); resolve(a); });
    } else rl.question(q, resolve);
  });

const email = (await ask("Email of the account: ")).trim().toLowerCase();
const password = await ask("New password (8+ characters, hidden): ", true);
rl.close();
if (password.length < 8) { console.error("Use at least 8 characters."); process.exit(1); }

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
let page = 1, user = null;
while (!user) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) { console.error(error.message); process.exit(1); }
  user = data.users.find((u) => u.email?.toLowerCase() === email) ?? null;
  if (data.users.length < 200) break;
  page++;
}
if (!user) { console.error(`No account found for ${email}.`); process.exit(1); }
const { error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
if (error) { console.error(error.message); process.exit(1); }
console.log(`✓ Password updated for ${email}. They can sign in with it now.`);
