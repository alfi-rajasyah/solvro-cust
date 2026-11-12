import { expect, loginViaUi, test } from "../fixtures/test";

// Overview (pages/Overview.tsx): three work tiles that link to the lists they
// count. Each tile is a real link whose accessible name carries the count.

test.describe("Overview work tiles", () => {
  test("shows Overdue, Due this week and Open risks tiles", async ({ page }) => {
    await loginViaUi(page);
    await page.goto("/overview", { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /^\d+ overdue tasks?$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^\d+ tasks? due this week$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^\d+ open risks?$/ })).toBeVisible();
  });

  test("the Overdue tile opens the overdue Tasks view", async ({ page }) => {
    await loginViaUi(page);
    await page.goto("/overview", { waitUntil: "networkidle" });

    const tile = page.getByRole("link", { name: /^\d+ overdue tasks?$/ });
    await expect(tile).toHaveAttribute("href", "/tasks?view=overdue");
    await tile.click();
    await expect(page).toHaveURL(/\/tasks\?view=overdue/);
  });
});
