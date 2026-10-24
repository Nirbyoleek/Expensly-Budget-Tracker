import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypts people's AI keys before they go into the database (AES-256-GCM).
 * The encryption key comes from AI_KEY_SECRET, or is derived from the Supabase service key,
 * so it only ever exists on the server.
 */
function secret() {
  const s = process.env.AI_KEY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Connecting your own AI needs SUPABASE_SERVICE_ROLE_KEY (or AI_KEY_SECRET) on the server.");
  return createHash("sha256").update("expensly-ai-key:" + s).digest();
}

export function encryptKey(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secret(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decryptKey(stored: string): string {
  const [v, iv, tag, body] = stored.split(".");
  if (v !== "v1") throw new Error("Unknown key format");
  const d = createDecipheriv("aes-256-gcm", secret(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}
