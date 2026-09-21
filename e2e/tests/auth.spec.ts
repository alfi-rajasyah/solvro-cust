import { test, expect, loginViaUi, ADMIN_EMAIL, ADMIN_PASSWORD } from "../fixtures/test";

// The seeded QA stack has Google sign-in NOT configured (no clientId, no
// allowed domains — see backend/prisma/seed.ts). Login renders no Google
// section at all in that case: just the password form, expanded by default
// with no "Admin sign-in" accordion to click through (see frontend's
// pages/Login.tsx). These specs assert that reality.

test.describe("auth", () => {
  test("Google not configured: password form renders directly, no accordion", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByText(/Admin sign-in/i)).toHaveCount(0);
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test("password sign-in logs in", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();

    await emailInput.fill(ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForURL(/overview|projects|\/$/i, { timeout: 10_000 });
    // Login page should no longer be showing the sign-in form.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test("invalid credentials show an error and keep the user on the login form", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', "definitely-wrong-password");
    await page.click('button[type="submit"]');

    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("logged-in session can reach an authenticated page", async ({ page }) => {
    await loginViaUi(page);
    await page.goto("/overview", { waitUntil: "networkidle" });
    await expect(page).not.toHaveURL(/login/i);
  });
});
