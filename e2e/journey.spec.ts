import { expect, test, type Page } from "@playwright/test";

/**
 * One person's whole journey through Expensly, on a fresh throwaway account:
 * sign up → quick add → sort an uncategorised spend → import a statement → make a category with a
 * budget → Insights, Month in review, Wealth, export, capture setup → delete the account.
 *
 * Accounts are e2e-…@expensly.test: the app never spends AI on them, leaves them out of usage
 * numbers, and the daily job deletes any a failed run leaves behind.
 */
test.describe.configure({ mode: "serial" });

const email = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@expensly.test`;
const password = `E2e!${Math.random().toString(36).slice(2)}${Date.now()}`;
const UNKNOWN = "Zxqvw"; // a word no rule knows, so it lands in Uncategorised

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page?.close();
});

const toast = (text: RegExp | string) => expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();

test("sign up with email and password", async () => {
  await page.goto("/login");
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("form").getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/home/, { timeout: 45_000 });
});

test("quick add three spends", async () => {
  await page.goto("/home?add=quick");
  const box = page.getByLabel("Spends to add");
  await expect(box).toBeVisible();
  await box.fill(`chai 20, auto 60, ${UNKNOWN.toLowerCase()} 99`);
  await page.getByRole("button", { name: /^Add 3 transactions$/ }).click();
  await toast(/Added 3 transactions/);
});

test("uncategorised spend waits in To review until it gets a category", async () => {
  await page.goto("/activity?filter=review");
  const row = page.locator(".tx").filter({ hasText: new RegExp(UNKNOWN, "i") });
  await expect(row).toHaveCount(1);
  // the other two were typed by hand, so they're already reviewed
  await expect(page.locator(".tx")).toHaveCount(1);
  await row.click();
  await expect(page.getByText(/Pick a category to take this out/)).toBeVisible();
  await page.getByRole("radio", { name: "Food & dining" }).click();
  await page.getByRole("button", { name: /^Save( & approve)?$/ }).click();
  await page.goto("/activity?filter=review");
  await expect(page.locator(".tx").filter({ hasText: new RegExp(UNKNOWN, "i") })).toHaveCount(0);
});

test("import the sample card statement", async () => {
  await page.goto("/home?add=statement");
  await page.getByRole("button", { name: "Try a sample card statement" }).click();
  const add = page.getByRole("button", { name: /^Add \d+ transactions?$/ });
  await expect(add).toBeEnabled();
  await add.click();
  await toast(/Added \d+ transaction/);
  await page.goto("/activity");
  await expect(page.locator(".tx").filter({ hasText: /Netflix/i }).first()).toBeVisible();
});

test("make a category of your own with a budget", async () => {
  await page.goto("/budgets");
  await page.getByRole("button", { name: /New category/ }).click();
  await page.locator("#cat-name").fill("E2E Pets");
  await page.locator("#cat-budget").fill("1500");
  await page.getByRole("button", { name: "Create category" }).click();
  await toast(/E2E Pets added/);
  await page.reload();
  await expect(page.getByText("E2E Pets").first()).toBeVisible();
  await expect(page.getByText("Yours").first()).toBeVisible();
});

test("insights: money health opens to show how to improve", async () => {
  await page.goto("/insights");
  await expect(page.getByRole("heading", { name: "Money health" })).toBeVisible();
  const first = page.locator(".health-row").first();
  await first.click();
  await expect(page.locator(".health-detail").first()).toBeVisible();
  await expect(page.getByText("Full marks").first()).toBeVisible();
});

test("month in review, wealth and capture setup load", async () => {
  await page.goto("/review");
  await expect(page).toHaveURL(/\/review\/\d{4}-\d{2}$/);
  await expect(page.getByText("Month in review").first()).toBeVisible();

  await page.goto("/wealth");
  await expect(page.getByText("Net worth").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Subscriptions/ })).toBeVisible();

  await page.goto("/settings/capture");
  await expect(page.getByRole("heading", { name: /Create your key/ })).toBeVisible();
});

test("export has the transactions as CSV", async () => {
  const res = await page.request.get("/api/export");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/csv/);
  const body = await res.text();
  expect(body).toMatch(/Chai/);
  expect(body).toMatch(/Netflix/i);
});

test("delete the account from Settings", async () => {
  await page.goto("/settings");
  await page.getByRole("button", { name: /Delete my account…/ }).click();
  await page.locator("#confirm-delete").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account", exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 45_000 });
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login/);
});
