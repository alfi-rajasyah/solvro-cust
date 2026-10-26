import { test, expect, loginViaUi, apiBase } from "../fixtures/test";

// Project header (pages/ProjectDetail.tsx + components/ProjectHeaderFacts.tsx):
// the facts row shows the customer and a progress figure, and Delete is
// reachable only through the ⋯ menu, where it opens a confirmation dialog.
// The dialog is cancelled — the seeded project is shared by the whole file.

test.describe("Project header", () => {
  test("facts row shows the customer and progress", async ({ page, seededProject }) => {
    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}`, { waitUntil: "networkidle" });

    const facts = page.getByRole("group", { name: "Project facts" });
    await expect(facts).toBeVisible();
    await expect(facts.getByText(seededProject.customerName, { exact: true })).toBeVisible();
    await expect(facts.getByText(/\d+% · \d+ of \d+/)).toBeVisible();
  });

  test("Delete project is reachable only through the more-actions menu", async ({
    page,
    seededProject,
  }) => {
    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}`, { waitUntil: "networkidle" });

    // Not a top-level button any more.
    await expect(page.getByRole("button", { name: "Delete project" })).toHaveCount(0);

    await page.getByRole("button", { name: "More project actions" }).click();
    await page.getByRole("menuitem", { name: "Delete project" }).click();

    const dialog = page.getByRole("dialog", { name: "Delete project" });
    await expect(dialog).toBeVisible();
    // The modal's close button is a primary touch target: at least 36px square.
    const closeBox = await dialog.getByRole("button", { name: "Close" }).boundingBox();
    expect(closeBox).not.toBeNull();
    expect(closeBox!.width).toBeGreaterThanOrEqual(36);
    expect(closeBox!.height).toBeGreaterThanOrEqual(36);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });

  // Below md the top bar keeps only the current crumb (the project name) and
  // the facts row collapses to status + customer + progress; every action
  // lives in the ⋯ menu.
  test("mobile: project name is visible and clear of the search button", async (
    { page, seededProject },
    testInfo,
  ) => {
    test.skip(testInfo.project.name !== "mobile", "375px layout check is mobile-only");
    const res = await fetch(`${apiBase(testInfo)}/api/projects/${seededProject.projectId}`, {
      headers: { Authorization: `Bearer ${seededProject.token}` },
    });
    const { name } = (await res.json()) as { name: string };

    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}`, { waitUntil: "networkidle" });

    const title = page.getByRole("banner").locator('[aria-current="page"]');
    await expect(title).toHaveText(name);
    await expect(title).toBeVisible();

    const titleBox = await title.boundingBox();
    const searchBox = await page
      .getByRole("banner")
      .getByRole("button", { name: "Open search" })
      .locator("visible=true")
      .first()
      .boundingBox();
    expect(titleBox).not.toBeNull();
    expect(searchBox).not.toBeNull();
    expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(searchBox!.x + 1);

    // Actions collapse into the ⋯ menu: no standalone Edit or Context button.
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /project context/i })).toHaveCount(0);
    await page.getByRole("button", { name: "More project actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Show project context" })).toBeVisible();
  });

  // The icon cluster must not squeeze the page title: at 375px every page
  // keeps at least 12 characters (or the whole title when it is shorter).
  test("mobile: top-bar title is not truncated on main pages", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "375px layout check is mobile-only");
    await loginViaUi(page);
    for (const path of ["/overview", "/projects", "/customers", "/tasks"]) {
      await page.goto(path, { waitUntil: "networkidle" });
      const title = page.getByRole("banner").locator('[aria-current="page"]');
      await expect(title).toBeVisible();
      const text = ((await title.textContent()) ?? "").trim();
      const shown = await title.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const full = range.getBoundingClientRect().width;
        const clipped = el.scrollWidth > el.clientWidth + 1;
        return { full, visible: el.clientWidth, clipped };
      });
      if (shown.clipped) {
        const visibleChars = Math.floor((shown.visible / shown.full) * text.length);
        expect(visibleChars, `${path} title "${text}" is cut to ~${visibleChars} chars`).toBeGreaterThanOrEqual(12);
      }
    }
  });
});
