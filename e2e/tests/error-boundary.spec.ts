import type { Page } from "@playwright/test";
import { expect, loginViaUi, test } from "../fixtures/test";

// The page error boundary (frontend/src/components/AppErrorBoundary.tsx, wired
// in layout/Shell.tsx). A real API answer with one field set to null makes a
// page throw while rendering; the boundary must show its fallback in place of
// the page, keep the app shell usable, clear on navigation, and make Try again
// render from freshly fetched data instead of the cached bad value.
//
// The pages break today because they read these fields without a guard:
//   - Overview: `data.workCounts` (pages/Overview.tsx, OverviewBody)
//   - project header: `project.tam.username` (components/ProjectHeaderFacts.tsx)
// If either page becomes defensive about its field, point that case at another
// field that still throws.

// Serve the real answer with `field` set to null.
async function nullField(page: Page, match: (url: URL) => boolean, field: string) {
  await page.route(match, async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as Record<string, unknown>;
    await route.fulfill({ response: res, json: { ...json, [field]: null } });
  });
}

const isOverview = (url: URL) => url.pathname === "/api/overview";

// Client-side navigation through the sidebar (a drawer behind the hamburger
// on a phone) so the boundary sees a pathname change, not a document reload.
async function openFromSidebar(page: Page, name: RegExp) {
  const hamburger = page.getByRole("button", { name: "Open navigation" });
  if (await hamburger.isVisible()) await hamburger.click();
  await page.getByRole("link", { name }).first().click();
}

test.describe("page error boundary", () => {
  // The built app (CI's :8080 stack) registers a PWA service worker, and
  // Playwright's page.route cannot intercept fetches the worker handles, so
  // the null-field answers below would never reach the page there (the dev
  // server registers no worker). Same fix as search.spec.ts.
  test.use({ serviceWorkers: "block" });

  test("a page that throws shows the fallback inside the app shell", async ({ page }) => {
    await loginViaUi(page);
    await nullField(page, isOverview, "workCounts");
    await page.goto("/overview");

    const fallback = page.getByTestId("page-error");
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText("This page could not be shown");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
    // The shell around the page still renders.
    await expect(page.getByRole("banner")).toBeVisible();
  });

  test("navigating to another page clears the fallback", async ({ page }) => {
    await loginViaUi(page);
    await nullField(page, isOverview, "workCounts");
    await page.goto("/overview");
    await expect(page.getByTestId("page-error")).toBeVisible();

    await openFromSidebar(page, /^Customers$/);
    await expect(page).toHaveURL(/\/customers$/);
    await expect(page.getByTestId("page-error")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
  });

  test("Try again refetches: the page renders once the server answers correctly", async ({ page }) => {
    await loginViaUi(page);
    await nullField(page, isOverview, "workCounts");
    await page.goto("/overview");
    await expect(page.getByTestId("page-error")).toBeVisible();

    await page.unroute(isOverview);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("page-error")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  });

  test("Try again refetches a query the top bar shares with the page", async ({ page, seededProject }) => {
    // The top bar reads the same project query as the project page, so that
    // query stays in use while the page shows its fallback.
    const isProject = (url: URL) => url.pathname === `/api/projects/${seededProject.projectId}`;
    await loginViaUi(page);
    await nullField(page, isProject, "tam");
    await page.goto(`/projects/${seededProject.projectId}/overview`);
    await expect(page.getByTestId("page-error")).toBeVisible();

    await page.unroute(isProject);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("page-error")).toHaveCount(0);
    // The project page itself is back: its own tab strip (not in the sidebar).
    await expect(page.getByRole("link", { name: "Kanban", exact: true })).toBeVisible();
  });
  test("a page chunk that fails to load reloads once, then shows the fallback", async ({ page, seededProject }) => {
    // A tab left open across a deploy asks for a chunk the deploy removed
    // (App.tsx loads pages lazily; lib/chunkReload.ts reloads once). In the
    // built app the failure reloads the tab one time; the reload asks for the
    // chunk again, and the second failure shows the fallback instead of
    // looping. The dev server reports no failed preload, so it shows the
    // fallback without the reload.
    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}/overview`);
    await expect(page.getByRole("link", { name: "Kanban", exact: true })).toBeVisible();

    await page.route((url) => url.pathname.includes("ProjectKanban"), (route) => route.fulfill({ status: 404 }));
    let documentLoads = 0;
    page.on("request", (r) => {
      if (r.resourceType() === "document") documentLoads += 1;
    });

    await page.getByRole("link", { name: "Kanban", exact: true }).click();
    await expect(page.getByTestId("page-error")).toBeVisible();
    await expect(page).toHaveURL(/\/kanban$/);
    await page.waitForTimeout(1000);
    const devServer = await page.evaluate(() => !!document.querySelector('script[src*="/@vite/client"]'));
    expect(documentLoads).toBe(devServer ? 0 : 1);
    // The shell is still usable around the fallback.
    await openFromSidebar(page, /^Overview$/);
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByTestId("page-error")).toHaveCount(0);
  });
});
