import { test, expect, loginViaUi } from "../fixtures/test";

// The Help page is reached from the TopBar's help button only (no sidebar or
// ⌘K entry). The seeded QA user is an admin, so every topic — including the
// permission-gated Executive and Admin ones — renders.

test("the TopBar help button opens the Help page", async ({ page }, testInfo) => {
  await loginViaUi(page);
  if (testInfo.project.name === "mobile") {
    // Below md the Help link lives in the account menu.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Help" }).click();
  } else {
    await page.getByRole("link", { name: "Help" }).click();
  }
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Getting started" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Admin" })).toBeVisible();
});

test("help search narrows the topics and shows an empty state", async ({ page }) => {
  await loginViaUi(page);
  await page.goto("/help");
  const search = page.getByRole("searchbox", { name: "Search help" });

  await search.fill("personal token");
  await expect(page.getByRole("heading", { level: 2, name: "iTop tickets" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Weekly Sync" })).toHaveCount(0);

  await search.fill("zzz-no-match");
  await expect(page.getByText('No help topics match "zzz-no-match".')).toBeVisible();
});

test("a /help#<topic> link scrolls to that topic", async ({ page }) => {
  await loginViaUi(page);
  await page.goto("/help#itop");
  await expect(page.getByRole("heading", { level: 2, name: "iTop tickets" })).toBeInViewport();
  await expect(page.getByRole("heading", { level: 2, name: "Getting started" })).not.toBeInViewport();
});

test("the topic list shows on desktop and hides on a phone", async ({ page }, testInfo) => {
  await loginViaUi(page);
  await page.goto("/help");
  const toc = page.getByRole("navigation", { name: "Help topics" });
  if (testInfo.project.name === "mobile") {
    await expect(toc).toBeHidden();
  } else {
    await toc.getByRole("link", { name: "Weekly Sync" }).click();
    await expect(page).toHaveURL(/\/help#weekly-sync$/);
    await expect(page.getByRole("heading", { level: 2, name: "Weekly Sync" })).toBeInViewport();
  }
});
