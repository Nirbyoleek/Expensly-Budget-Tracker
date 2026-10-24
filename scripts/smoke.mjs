#!/usr/bin/env node
// Smoke tests against a running Expensly (production by default). No dependencies; Node 20+.
//   npm run smoke                       → https://expensly-tracker.vercel.app
//   npm run smoke -- http://localhost:3000
// Checks the public pages load, private pages and APIs refuse signed-out visitors, and the PWA
// files are served. Exits non-zero if anything fails, so it can gate a deploy.

const BASE = (process.argv[2] || process.env.SMOKE_URL || "https://expensly-tracker.vercel.app").replace(/\/$/, "");

const get = (path, init = {}) => fetch(BASE + path, { redirect: "manual", ...init });
const toLogin = (res) => res.status >= 300 && res.status < 400 && /\/login/.test(res.headers.get("location") || "");
const refused = (res) => res.status === 401 || res.status === 403 || toLogin(res);

const checks = [
  ["sign-in page loads", async () => { const r = await get("/login"); const t = await r.text(); return r.status === 200 && /Expensly/.test(t) && /password/i.test(t); }],
  ["privacy page is public", async () => { const r = await get("/privacy"); return r.status === 200 && /How Expensly handles your data/.test(await r.text()); }],
  ["home sends signed-out visitors to sign in", async () => toLogin(await get("/home"))],
  ["settings sends signed-out visitors to sign in", async () => toLogin(await get("/settings"))],
  ["month in review sends signed-out visitors to sign in", async () => toLogin(await get("/review/2026-09"))],
  ["iPhone capture setup sends signed-out visitors to sign in", async () => toLogin(await get("/settings/capture"))],
  ["offline page is public", async () => { const r = await get("/offline"); return r.status === 200 && /offline/i.test(await r.text()); }],
  ["data export refuses signed-out visitors", async () => refused(await get("/api/export"))],
  ["full JSON export refuses signed-out visitors", async () => refused(await get("/api/export?format=json"))],
  ["notifications API refuses signed-out visitors", async () => refused(await get("/api/notifications/pending"))],
  ["AI chat refuses signed-out visitors", async () => refused(await get("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) }))],
  ["daily job refuses calls without the cron secret", async () => (await get("/api/cron/notify")).status === 401],
  ["daily job refuses a wrong cron secret", async () => (await get("/api/cron/notify", { headers: { authorization: "Bearer wrong" } })).status === 401],
  ["SMS ingest refuses a missing token", async () => { const r = await get("/api/ingest/sms", { method: "POST", body: "Rs.10 debited" }); return r.status === 401 || r.status === 503; }],
  ["SMS ingest refuses a made-up token", async () => { const r = await get("/api/ingest/sms", { method: "POST", headers: { authorization: "Bearer kosh_fake" }, body: "Rs.10 debited" }); return r.status === 401 || r.status === 503; }],
  ["service worker is served as JavaScript", async () => { const r = await get("/sw.js"); return r.status === 200 && /javascript/.test(r.headers.get("content-type") || "") && /showNotification/.test(await r.text()); }],
  ["service worker can serve pages offline", async () => /addEventListener\("fetch"/.test(await (await get("/sw.js")).text())],
  ["app manifest is valid for installing", async () => { const r = await get("/manifest.webmanifest"); const m = await r.json(); return r.status === 200 && m.name === "Expensly" && m.display === "standalone" && m.icons?.length >= 2; }],
  ["app icon is served", async () => (await get("/icons/icon-192.png")).status === 200],
  ["PDF reader worker is served (statement import)", async () => (await get("/pdf.worker.min.mjs")).status === 200],
  ["pages don't leak secrets", async () => { const t = await (await get("/login")).text(); return !/service_role|SUPABASE_SERVICE_ROLE_KEY|VAPID_PRIVATE_KEY|gsk_|AIza|sk-ant-/.test(t); }],
];

let failed = 0;
console.log(`Smoke testing ${BASE}\n`);
for (const [name, run] of checks) {
  let ok = false, note = "";
  try { ok = await run(); } catch (e) { note = ` (${e.message})`; }
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${note}`);
}
console.log(`\n${checks.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
