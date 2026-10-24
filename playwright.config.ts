import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end checks of a deployed Expensly, signed in as a throwaway account.
 *   E2E_BASE_URL=https://… npx playwright test
 * CI runs them against each new production build before it goes live (see .github/workflows/ci.yml).
 * VERCEL_AUTOMATION_BYPASS_SECRET lets the browser past Vercel's deployment protection, if it's on.
 */
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" } : undefined,
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } }],
});
