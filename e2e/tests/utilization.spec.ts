import type { Page } from "@playwright/test";
import { expect, loginViaUi, test } from "../fixtures/test";

// Utilization page (Task 3.3, docs/archive/plans/itop-integration.md —
// "Work Logs becomes Utilization" in docs/archive/plans/itop-integration-spec.md):
// GET /api/utilization and GET /api/itop/status are both intercepted via
// page.route, same rationale as the other itop-*.spec.ts specs — no real
// iTop instance needed, and `serviceWorkers: "block"` keeps the mocks
// authoritative against the built CI stack's PWA service worker. The
// response body reproduces the spec mockup's numbers exactly (32.0 of 40 h,
// 3 customers touched of 4 assigned, 3.0 h unassigned) so the assertions
// below double as a check that Utilization.tsx renders the contract
// faithfully, not just "some data".

const WEEK = "2026-W37";
const WEEK_DAYS = [
  "2026-09-07",
  "2026-09-08",
  "2026-09-09",
  "2026-09-10",
  "2026-09-11",
  "2026-09-12",
  "2026-09-13",
];

const ROWS_BY_SCOPE_KIND = {
  me: "customer",
  customer: "customer",
  tam: "tam",
} as const;

function utilizationBody(scope: "me" | "tam" | "customer") {
  const kind = ROWS_BY_SCOPE_KIND[scope];
  return {
    configured: true,
    week: { key: WEEK, start: WEEK_DAYS[0], days: WEEK_DAYS },
    scope,
    capacityHoursPerWeek: 40,
    syncedAt: new Date().toISOString(),
    tiles: {
      hoursLogged: 32.0,
      capacityHours: 40,
      customersTouched: 3,
      customersAssigned: 4,
      unassignedHours: 3.0,
    },
    rows: [
      {
        key: "northwind",
        label: "Northwind Freight",
        kind,
        hours: [2.5, 3.0, 1.5, 4.0, 2.0, 0, 0],
        total: 13.0,
        ticketRefs: ["R-004512", "R-004530", "R-004488", "R-004519"],
      },
      {
        key: "sinar",
        label: "PT Sinar Logistik",
        kind,
        hours: [1.0, 2.0, 3.5, 0.5, 1.5, 0, 0],
        total: 8.5,
        ticketRefs: ["R-004488", "R-004519"],
      },
      {
        key: "bumi",
        label: "Bumi Retail",
        kind,
        hours: [0, 1.5, 2.0, 1.0, 3.0, 0, 0],
        total: 7.5,
        ticketRefs: ["R-004501"],
      },
      {
        key: "none",
        label: "No customer",
        kind: "none",
        hours: [1.0, 0.5, 0.5, 0.5, 0.5, 0, 0],
        total: 3.0,
        ticketRefs: [],
      },
    ],
    totals: { hours: [4.5, 7.0, 7.5, 6.0, 7.0, 0, 0], total: 32.0 },
  };
}

async function mockItopStatus(page: Page): Promise<void> {
  await page.route("**/api/itop/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        baseUrl: "https://itop.example.test",
        lastSyncAt: new Date().toISOString(),
        lastSyncOk: true,
        refreshMinutes: 5,
      }),
    }),
  );
}

async function mockUtilization(page: Page): Promise<void> {
  await page.route("**/api/utilization*", (route) => {
    const url = new URL(route.request().url());
    const scope = (url.searchParams.get("scope") ?? "me") as "me" | "tam" | "customer";
    const utcOffsetMinutes = Number(url.searchParams.get("utcOffsetMinutes") ?? "0");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...utilizationBody(scope), utcOffsetMinutes }),
    });
  });
}

test.describe("Utilization page", () => {
  test.use({ serviceWorkers: "block" });

  test("shows the week, tiles, matrix rows, and lets an executive switch scope", async ({ page }) => {
    await mockItopStatus(page);
    await mockUtilization(page);

    await loginViaUi(page);

    // The hook sends `utcOffsetMinutes` (local minus UTC) alongside
    // `week`/`scope`, same contract as useItopDaily's `/itop/daily` call.
    const initialRequest = page.waitForRequest((req) => req.url().includes("/api/utilization"));
    await page.goto(`/utilization?week=${WEEK}`, { waitUntil: "networkidle" });
    expect((await initialRequest).url()).toContain("utcOffsetMinutes=");

    // Week switcher — same "Week NN" + date-range label as WeeklySync.tsx.
    await expect(page.getByText("Week 37")).toBeVisible();
    await expect(page.getByText("7 – 13 Sep")).toBeVisible();

    // "Hours logged" tile.
    const hoursTile = page.getByTestId("utilization-tile-hours");
    await expect(hoursTile).toContainText("32.0");
    await expect(hoursTile).toContainText("40");

    // 4 body rows (3 customers + "No customer") + a bold Total footer row.
    const rows = page.getByTestId("utilization-row");
    await expect(rows).toHaveCount(4);
    await expect(page.getByTestId("utilization-total-row")).toBeVisible();

    // "No customer" is the last row.
    await expect(rows.last()).toContainText("No customer");

    // Northwind Freight's 4 ticket refs fold to 2 visible + "+2" overflow.
    const northwindRow = rows.filter({ hasText: "Northwind Freight" });
    await expect(northwindRow).toContainText("R-004512");
    await expect(northwindRow).toContainText("R-004530");
    await expect(northwindRow).toContainText("+2");

    // The admin fixture user (ADMIN role → permissions ["*"]) has
    // report:executive via the wildcard, so both extra tabs render.
    const tamTab = page.getByTestId("utilization-tab-tam");
    const customerTab = page.getByTestId("utilization-tab-customer");
    await expect(tamTab).toBeVisible();
    await expect(customerTab).toBeVisible();

    const customerScopeRequest = page.waitForRequest((req) => req.url().includes("/api/utilization"));
    await customerTab.click();
    expect((await customerScopeRequest).url()).toContain("scope=customer");
    await expect(customerTab).toHaveClass(/text-primary/);
  });

  test("a direct deep link to ?scope=customer survives auth resolving after the page loads", async ({ page }) => {
    await mockItopStatus(page);
    await mockUtilization(page);

    // Fresh login, then a full navigation (not an in-app link click)
    // straight to a `?scope=customer` deep link — the repro for a bug where
    // the auth user was still resolving (`user` null even though AuthGuard
    // is already past "loading") when the scope clamp ran, permanently
    // rewriting the URL down to `?scope=me` before the caller's real
    // `report:executive` permission was known. Utilization.tsx must not
    // clamp or fire the query until the user is actually loaded.
    await loginViaUi(page);

    const customerScopeRequest = page.waitForRequest(
      (req) => req.url().includes("/api/utilization") && req.url().includes("scope=customer"),
    );
    await page.goto("/utilization?scope=customer", { waitUntil: "networkidle" });
    expect((await customerScopeRequest).url()).toContain("scope=customer");

    const customerTab = page.getByTestId("utilization-tab-customer");
    await expect(customerTab).toBeVisible();
    await expect(customerTab).toHaveClass(/text-primary/);
    await expect(page).toHaveURL(/scope=customer/);
  });

  test("/work-logs redirects to /utilization", async ({ page }) => {
    await mockItopStatus(page);
    await mockUtilization(page);

    await loginViaUi(page);

    await page.goto("/work-logs", { waitUntil: "networkidle" });
    // Utilization.tsx normalizes `?week=`/`?scope=` onto the URL once it
    // resolves its defaults (same pattern as WeeklySync.tsx), so the
    // redirect target picks up those query params rather than landing on
    // a bare "/utilization".
    await expect(page).toHaveURL(/\/utilization(\?|$)/);
  });
});
