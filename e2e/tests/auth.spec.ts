import {
  test,
  expect,
  googleSignInEnabled,
  loginViaUi,
  submitLoginForm,
  ADMIN_EMAIL,
} from "../fixtures/test";

// Two stack shapes are supported. The seeded QA stack has Google sign-in NOT
// configured (no clientId, no allowed domains — see backend/prisma/seed.ts):
// Login shows only the password form, no "Admin sign-in" accordion. A dev
// stack with Google configured shows the Google button and collapses the
// password form behind that accordion. The shape is read from
// /auth/google/config, and each shape-specific case skips on the other one;
// every sign-in below goes through submitLoginForm, which handles both.

test.describe("auth", () => {
  test("Google not configured: password form renders directly, no accordion", async ({ page }, testInfo) => {
    test.skip(await googleSignInEnabled(testInfo), "this stack has Google sign-in configured");
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByText(/Admin sign-in/i)).toHaveCount(0);
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test("Google configured: password form sits behind the Admin sign-in accordion", async ({ page }, testInfo) => {
    test.skip(!(await googleSignInEnabled(testInfo)), "this stack has no Google sign-in");
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByText(/Admin sign-in/i)).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeHidden();
    await page.getByText(/Admin sign-in/i).click();
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test("password sign-in logs in", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await submitLoginForm(page);

    await page.waitForURL(/overview|projects|\/$/i, { timeout: 10_000 });
    // Login page should no longer be showing the sign-in form.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test("invalid credentials show an error and keep the user on the login form", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    await submitLoginForm(page, ADMIN_EMAIL, "definitely-wrong-password");

    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("logged-in session can reach an authenticated page", async ({ page }) => {
    await loginViaUi(page);
    await page.goto("/overview", { waitUntil: "networkidle" });
    await expect(page).not.toHaveURL(/login/i);
  });
});

// A full page load right after sign-in used to bounce admin pages to
// Overview: the guard read the localStorage user before /auth/me answered,
// and that cached copy could be missing or stale. The guard now waits for
// the server's answer before it denies access.
test.describe("auth: admin guard on a fresh page load", () => {
  // page.route below must not be bypassed by the PWA service worker.
  test.use({ serviceWorkers: "block" });

  test("an admin page opened with no cached user stays on the admin page", async ({ page }) => {
    await loginViaUi(page);
    // Simulate the race deterministically: no cached user, and a slow /auth/me.
    await page.evaluate(() => localStorage.removeItem("solvro.user"));
    await page.route("**/auth/me", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: /admin/i })).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/admin/);
  });

  test("an admin page opened right after sign-in stays on the admin page", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await submitLoginForm(page);
    await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 10_000 });
    // Sign-in stores the user next to the session token, so a full page load
    // from here already has both.
    const stored = await page.evaluate(() => ({
      token: localStorage.getItem("solvro.token"),
      user: localStorage.getItem("solvro.user"),
    }));
    expect(stored.token).not.toBeNull();
    expect(stored.user).not.toBeNull();
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: /admin/i })).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/admin/);
  });
});
