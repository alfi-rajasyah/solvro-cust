import type { Page } from "@playwright/test";
import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { isoDateOffset } from "../fixtures/seed";

// The Weekly Sync table, the Utilization matrix and the portfolio timeline
// are wide on desktop; below md (768px) each reflows into stacked cards /
// a full-width track instead of scrolling sideways. This spec runs on both
// projects: on mobile it is the regression guard (nothing wider than the
// viewport), on desktop it checks the table layout is still in place.

/** True when neither the page nor any table container scrolls sideways. */
async function expectNoHorizontalScroll(page: Page, containerTestId?: string) {
  const metrics = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  if (containerTestId) {
    const wide = await page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return null;
      // Walk to the nearest overflow container and compare its content width.
      let node: HTMLElement | null = el as HTMLElement;
      while (node && getComputedStyle(node).overflowX !== "auto") node = node.parentElement;
      return node ? node.scrollWidth - node.clientWidth : 0;
    }, containerTestId);
    if (wide !== null) expect(wide).toBeLessThanOrEqual(0);
  }
}

// The built stack registers a service worker, which would answer requests
// before page.route sees them (the Utilization test mocks its API response).
test.use({ serviceWorkers: "block" });

test.describe("Wide tables on a phone", () => {
  test("Weekly Sync shows customer cards without sideways scroll", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const H = { Authorization: `Bearer ${seededProject.token}`, "Content-Type": "application/json" };
    const name = `Cards Co ${Date.now().toString(36)}`;
    const customer = (await (
      await fetch(`${base}/api/customers`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ name, description: "e2e cards", tamId: seededProject.userId }),
      })
    ).json()) as { id: number };
    // A project of its own: the shared fixture project is worker-scoped and
    // later specs rely on it staying put.
    const created = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: `Cards ${name}`, customerId: customer.id, tamId: seededProject.userId }),
    });
    expect(created.ok, `create project: ${created.status}`).toBeTruthy();
    const own = (await created.json()) as { id: number };
    const activated = await fetch(`${base}/api/projects/${own.id}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ status: "ACTIVE" }),
    });
    expect(activated.ok).toBeTruthy();

    await loginViaUi(page);
    await page.goto("/weekly-sync?tab=midweek", { waitUntil: "networkidle" });
    await page.getByTestId("weekly-sync-hidden-toggle").click();

    const row = page.getByTestId(`weekly-sync-row-${customer.id}`);
    await expect(row).toBeVisible();
    await expect(row.getByText(name)).toBeVisible();
    await expect(row.getByText("Not filled")).toBeVisible();

    const isPhone = (page.viewportSize()?.width ?? 1440) < 768;
    // Phone: each field names itself (data-label drives a ::before); desktop keeps the header row.
    if (isPhone) await expect(row.locator('[data-label="Highlight"]')).toBeVisible();
    else await expect(page.getByText("Highlight", { exact: true }).first()).toBeVisible();
    await expectNoHorizontalScroll(page, `weekly-sync-row-${customer.id}`);
  });

  test("Utilization matrix does not scroll sideways", async ({ page }) => {
    // iTop is not connected on the QA stack, so the matrix is fed a canned
    // /utilization response (the API contract is unit-tested elsewhere).
    const days = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
    await page.route("**/api/utilization*", (route) =>
      route.fulfill({
        json: {
          configured: true,
          week: { key: "2026-W44", start: days[0], days },
          scope: "me",
          capacityHoursPerWeek: 40,
          syncedAt: new Date().toISOString(),
          tiles: { hoursLogged: 13, capacityHours: 40, customersTouched: 1, customersAssigned: 1, unassignedHours: 0 },
          rows: [
            {
              key: "c1",
              label: "Mobile Layout Customer",
              kind: "customer",
              hours: [2.5, 1, 0, 3, 4.5, 0, 2],
              total: 13,
              ticketRefs: ["R-004512", "R-004530", "R-004544"],
            },
          ],
          totals: { hours: [2.5, 1, 0, 3, 4.5, 0, 2], total: 13 },
          utcOffsetMinutes: 0,
          truncated: false,
        },
      }),
    );
    await loginViaUi(page);
    await page.goto("/utilization", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Utilization" })).toBeVisible();

    const row = page.getByTestId("utilization-row");
    await expect(row).toBeVisible();
    await expect(row.getByText("Mobile Layout Customer")).toBeVisible();
    await expect(row.getByText(/R-004512/)).toBeVisible();
    const isPhone = (page.viewportSize()?.width ?? 1440) < 768;
    // Each day cell names itself on a phone; desktop labels columns in the header row.
    if (isPhone) await expect(row.getByText("Mon 26")).toBeVisible();
    else await expect(page.getByText("Mon 26", { exact: true }).first()).toBeVisible();
    await expectNoHorizontalScroll(page, "utilization-row");

    if (!isPhone) {
      // The row must stay on the 10-track desktop grid: day cells on one
      // line, and Total/Tickets aligned under their header cells.
      const header = page.getByText("Total", { exact: true }).first();
      const cells = await row.locator(":scope > div").evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y) };
        }),
      );
      expect(cells).toHaveLength(10);
      expect(new Set(cells.map((c) => c.y)).size).toBe(1);
      const headerBox = await header.boundingBox();
      expect(Math.abs(headerBox!.x - cells[8].x)).toBeLessThanOrEqual(12);
    }
  });

  test("Portfolio timeline fits the viewport and lists the project", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const H = { Authorization: `Bearer ${seededProject.token}`, "Content-Type": "application/json" };
    const stamp = Date.now().toString(36);
    const created = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: `Timeline ${stamp}`, customerId: seededProject.customerId, tamId: seededProject.userId }),
    });
    expect(created.ok, `create project: ${created.status}`).toBeTruthy();
    const project = (await created.json()) as { id: number; name: string };
    const patched = await fetch(`${base}/api/projects/${project.id}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ status: "ACTIVE" }),
    });
    expect(patched.ok, `activate project: ${patched.status}`).toBeTruthy();
    // A project's schedule is derived from its tasks' dates.
    const task = await fetch(`${base}/api/projects/${project.id}/tasks`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ title: "Scheduled", status: "TODO", startDate: isoDateOffset(-10), dueDate: isoDateOffset(40) }),
    });
    expect(task.ok, `create task: ${task.status}`).toBeTruthy();

    await loginViaUi(page);
    await page.goto("/overview", { waitUntil: "networkidle" });
    // The project also appears in other Overview lists on a fresh database,
    // so scope to the portfolio timeline section.
    const timeline = page.locator("section", { has: page.getByRole("heading", { name: "Portfolio timeline" }) });
    const link = timeline.getByRole("link", { name: project.name });
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible();
    await expectNoHorizontalScroll(page);

    const isPhone = (page.viewportSize()?.width ?? 1440) < 768;
    if (isPhone) {
      // The date range line replaces the hover tooltip on a phone.
      await expect(link.locator("xpath=ancestor::div[contains(@class,'border-t')][1]").getByText(/·\s*\d+%/)).toBeVisible();
    }
  });
});
