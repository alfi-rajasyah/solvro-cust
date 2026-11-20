import type { Page } from "@playwright/test";
import { test, expect, loginViaUi } from "../fixtures/test";

// The Login screen and the sidebar rail pin `dark` on their own root so they
// stay dark when the user's theme is light. Guards that pin: with the theme
// forced to light, <html> has no `dark` class (so the pin is the only thing
// keeping these surfaces dark) and their painted background is dark, while
// the app canvas is light.

/** Relative luminance (0 dark, 1 light) of the computed background-color of `selector`'s first match, resolved to sRGB via a 1px canvas. */
async function backgroundLuminance(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no element for ${sel}`);
    const css = getComputedStyle(el).backgroundColor;
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    ctx.canvas.width = ctx.canvas.height = 1;
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) throw new Error(`transparent background for ${sel}: ${css}`);
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }, selector);
}

test.describe("always-dark surfaces with a light theme", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("solvro.theme", "light");
      } catch {
        /* storage blocked: the test would then fail on the html assertions */
      }
    });
  });

  test("Login stays dark", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
    await expect(page.locator("main.dark")).toBeVisible();
    expect(await backgroundLuminance(page, "main.dark")).toBeLessThan(0.1);
  });

  test("sidebar rail stays dark while the app is light", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop sidebar rail only");
    await loginViaUi(page);
    await page.goto("/overview", { waitUntil: "networkidle" });
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

    const rail = page
      .locator("aside")
      .filter({ has: page.getByRole("button", { name: /(Collapse|Expand) sidebar/ }) });
    await expect(rail).toBeVisible();
    // The rail's own background is a literal hex in both themes, so it cannot
    // show the pin. The active link's icon routes through `--primary`: the dark
    // value (58 174 81) only resolves inside the pinned `.dark` subtree, while
    // the light-theme value (31 117 51) applies everywhere else.
    const icon = rail
      .getByRole("link", { name: "Overview" })
      .locator("span.material-symbols-outlined.text-primary");
    await expect(icon).toBeVisible();
    await expect(icon).toHaveCSS("color", "rgb(58, 174, 81)");
    // Control: the same token resolves to the light value on the app canvas.
    const appPrimary = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.className = "text-primary";
      document.querySelector("main")!.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    expect(appPrimary).toBe("rgb(31, 117, 51)");
    expect(await backgroundLuminance(page, "aside.dark")).toBeLessThan(0.1);
    expect(await backgroundLuminance(page, "body")).toBeGreaterThan(0.5);
  });
});
