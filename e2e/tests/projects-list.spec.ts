import { test, expect, loginViaUi } from "../fixtures/test";

// Projects list (pages/Projects.tsx ProjectCard): every card carries a
// progress footer — "41% · 7 of 17", or "No tasks yet" for an empty project.

test.describe("Projects list", () => {
  test("cards show a progress figure", async ({ page, seededProject }) => {
    await loginViaUi(page);
    await page.goto(`/projects?customerId=${seededProject.customerId}`, {
      waitUntil: "networkidle",
    });

    const card = page.locator(`a[href="/projects/${seededProject.projectId}"]`);
    await expect(card).toBeVisible();
    await expect(card.getByText(/\d+% · \d+ of \d+|No tasks yet/)).toBeVisible();
  });
});
