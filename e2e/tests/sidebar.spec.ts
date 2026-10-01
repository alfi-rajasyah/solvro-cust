import type { Page } from "@playwright/test";
import { test, expect, loginViaUi } from "../fixtures/test";

// Other <aside>s exist (task panel, epic panel); the rail is the one holding
// the sidebar collapse/expand button.
const sidebarRail = (page: Page) =>
  page.locator("aside").filter({ has: page.getByRole("button", { name: /(Collapse|Expand) sidebar/ }) });

// The grouped sidebar rail: expanded with group labels at >= 1280px, and the
// user's collapse choice persists across a reload (localStorage). Desktop only
// — below md the sidebar is an overlay drawer.

test.describe("sidebar", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop sidebar rail only");
  });

  test("is expanded with group labels at 1440px and stays collapsed after a reload", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaUi(page);
    await page.goto("/overview", { waitUntil: "networkidle" });

    const rail = sidebarRail(page);
    for (const label of ["Workspace", "Cadence", "Insights", "System"]) {
      await expect(rail.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(rail.getByRole("link", { name: "Overview" })).toBeVisible();
    // /tasks is intentionally not in the rail.
    await expect(rail.locator('a[href="/tasks"]')).toHaveCount(0);

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(rail.getByText("Workspace", { exact: true })).toHaveCount(0);

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await expect(sidebarRail(page).getByText("Workspace", { exact: true })).toHaveCount(0);

    // Navigating on desktop must not collapse or expand the rail on its own.
    await sidebarRail(page).getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();

    // Restore the expanded default so the persisted choice can't leak into
    // other specs sharing this browser context.
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(sidebarRail(page).getByText("Workspace", { exact: true })).toBeVisible();
  });
});
