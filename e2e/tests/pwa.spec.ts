import { test, expect, loginViaUi } from "../fixtures/test";

// PWA support (manifest, service worker registration, theme-color) landed
// via feat/pwa-mobile and is now merged — these assertions are real.

test.describe("pwa", () => {
  test("manifest link is present", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const manifestHref = await page
      .locator('link[rel="manifest"]')
      .first()
      .getAttribute("href");
    expect(manifestHref).toBeTruthy();
  });

  test("service worker registers", async ({ page, baseURL }) => {
    // Service worker registration requires a secure context (HTTPS, or
    // localhost/127.0.0.1 which browsers treat as secure). CI runs the stack
    // at http://localhost:8080, which qualifies — only assert registration
    // when the configured baseURL is actually a context the browser
    // considers secure; skip otherwise rather than false-failing against a
    // non-local HTTP target.
    const url = new URL(baseURL ?? "http://localhost:8080");
    const isSecureContext =
      url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
    test.skip(!isSecureContext, "service worker requires a secure context (https or localhost)");

    await loginViaUi(page);
    await page.waitForFunction(
      async () => {
        if (!("serviceWorker" in navigator)) return false;
        const regs = await navigator.serviceWorker.getRegistrations();
        return regs.length > 0;
      },
      { timeout: 10_000 },
    );

    const registrations = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.length;
    });
    expect(registrations).toBeGreaterThan(0);
  });

  test("theme-color meta tag is set", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const themeColor = await page
      .locator('meta[name="theme-color"]')
      .first()
      .getAttribute("content");
    expect(themeColor).toBe("#3aae51");
  });
});
