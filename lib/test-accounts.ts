/**
 * Accounts made by the automated end-to-end tests: e2e-<anything>@expensly.test.
 * They never use AI (no cost, no flaky answers), are left out of usage numbers and reminders,
 * and the daily job deletes any older than two hours that a failed run left behind.
 */
export const TEST_EMAIL_RE = /^e2e-[a-z0-9-]{1,60}@expensly\.test$/i;
export const isTestAccount = (email?: string | null) => TEST_EMAIL_RE.test((email ?? "").trim());
