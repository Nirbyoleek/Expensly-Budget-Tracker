import "server-only";

/**
 * Limits per person. Enforced in the database (ai_take_quota), so they can't be bypassed from the browser.
 * The app owner can override them for one person in the ai_limits table (or switch AI off for them).
 */
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
export const LIMITS = {
  // Using the app owner's key: the owner pays, so keep it tight.
  server: { daily: num(process.env.AI_DAILY_LIMIT, 30), perMinute: num(process.env.AI_PER_MINUTE, 5), monthlyTokens: num(process.env.AI_MONTHLY_TOKENS, 1_500_000) },
  // Using their own key: their cost, so the caps only stop runaway use.
  own: { daily: num(process.env.AI_DAILY_LIMIT_OWN, 200), perMinute: num(process.env.AI_PER_MINUTE_OWN, 10), monthlyTokens: null as number | null },
};
