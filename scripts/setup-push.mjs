// Creates the keys for reminders (web push) and the cron secret, and adds them to .env.local.
// Safe to re-run: existing values are kept.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, appendFileSync } from "node:fs";

const file = ".env.local";
const env = existsSync(file) ? readFileSync(file, "utf8") : "";
const has = (k) => new RegExp(`^\\s*${k}\\s*=\\s*\\S`, "m").test(env);
const lines = [];
if (!has("NEXT_PUBLIC_VAPID_PUBLIC_KEY") || !has("VAPID_PRIVATE_KEY")) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" }), priv = privateKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]).toString("base64url");
  lines.push(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${raw}`, `VAPID_PRIVATE_KEY=${priv.d}`);
}
if (!has("VAPID_SUBJECT")) lines.push("VAPID_SUBJECT=mailto:hello@expensly.app");
if (!has("CRON_SECRET")) lines.push(`CRON_SECRET=${randomBytes(24).toString("base64url")}`);
if (!lines.length) console.log("Reminder keys are already in .env.local.");
else {
  appendFileSync(file, (env.endsWith("\n") || !env ? "" : "\n") + "\n# Reminders (added by npm run setup-push)\n" + lines.join("\n") + "\n");
  console.log(`Added ${lines.length} value(s) to .env.local. Run npm run deploy to send them to Vercel.`);
}
