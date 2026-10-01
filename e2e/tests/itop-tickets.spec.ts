import type { Page } from "@playwright/test";
import { expect, loginViaUi, test } from "../fixtures/test";

// Customer Tickets tab (docs/archive/plans/itop-integration.md Task 1.8):
// GET /itop/status and GET /itop/customers/:id/tickets are both intercepted
// via page.route, so this spec never needs a real iTop instance (or the
// dev stack's fake-itop fixture) — it only exercises the frontend's
// rendering/filtering/gating logic against a scripted response shape
// matching backend/src/routes/itop.ts. Runs on both Playwright projects
// (desktop + mobile) per playwright.config.ts; the Tickets tab collapses
// its table to a card list under `md:` (TicketsTable.tsx), which is why row
// counting below scopes to `:visible` rather than a raw DOM count — both
// layouts are always present in the DOM, only one is shown per viewport.

const ITOP_BASE_URL = "https://itop.example.test";

function isoOffsetHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

const TICKETS = [
  {
    id: 1,
    class: "Incident",
    ref: "R-100",
    title: "Branch 5 VPN tunnel flapping",
    status: "escalated_ttr",
    operationalStatus: "ongoing",
    priority: "1",
    agentPersonId: 1,
    agentName: "Rina S.",
    teamName: "NOC",
    serviceName: "Network",
    callerName: "Ops",
    startDate: isoOffsetHours(-48),
    lastUpdate: isoOffsetHours(-1),
    tto: null,
    ttr: null,
    slaTtoPassed: true,
    slaTtrPassed: true,
    resolutionDate: null,
    isMine: false,
  },
  {
    id: 2,
    class: "UserRequest",
    ref: "R-101",
    title: "Add 2 users to the Acronis console",
    status: "assigned",
    operationalStatus: "ongoing",
    priority: "3",
    agentPersonId: 7,
    agentName: "Rina S.",
    teamName: "Service Desk",
    serviceName: "Backup",
    callerName: "Jane",
    startDate: isoOffsetHours(-5),
    lastUpdate: isoOffsetHours(-1),
    tto: null,
    ttr: isoOffsetHours(3),
    slaTtoPassed: false,
    slaTtrPassed: false,
    resolutionDate: null,
    // The current fixture user — this is the row the "Mine" scope/count
    // should include.
    isMine: true,
  },
  {
    id: 3,
    class: "UserRequest",
    ref: "R-102",
    title: "Monthly backup report not received",
    status: "pending",
    operationalStatus: "ongoing",
    priority: "3",
    agentPersonId: 9,
    agentName: "Dedi P.",
    teamName: "Service Desk",
    serviceName: "Backup",
    callerName: "Mo",
    startDate: isoOffsetHours(-96),
    lastUpdate: isoOffsetHours(-2),
    tto: null,
    ttr: isoOffsetHours(24),
    slaTtoPassed: false,
    slaTtrPassed: false,
    resolutionDate: null,
    isMine: false,
  },
  {
    id: 4,
    class: "UserRequest",
    ref: "R-103",
    title: "Firewall rule for the new HR app",
    status: "new",
    operationalStatus: "ongoing",
    priority: "2",
    // Unassigned — no agent yet.
    agentPersonId: null,
    agentName: null,
    teamName: null,
    serviceName: "Network",
    callerName: "HR",
    startDate: isoOffsetHours(-0.67),
    lastUpdate: isoOffsetHours(-0.1),
    tto: isoOffsetHours(1),
    ttr: isoOffsetHours(1.3),
    slaTtoPassed: false,
    slaTtrPassed: false,
    resolutionDate: null,
    isMine: false,
  },
];

const COUNTS = { ongoing: 4, resolvedWeek: 0, mine: 1, incidents: 1, requests: 3 };

async function mockItopStatus(page: Page): Promise<void> {
  await page.route("**/api/itop/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        baseUrl: ITOP_BASE_URL,
        lastSyncAt: new Date().toISOString(),
        lastSyncOk: true,
        // `lastSyncError` is deliberately absent — GET /itop/status no
        // longer returns the raw iTop error text to non-admins (queries.ts's
        // `ItopStatus` type).
        refreshMinutes: 5,
      }),
    }),
  );
}

async function mockTickets(page: Page, mapped: boolean): Promise<void> {
  await page.route("**/api/itop/customers/*/tickets*", (route) => {
    const body = mapped
      ? {
          mapped: true,
          orgName: "Northwind Freight Sdn Bhd",
          tickets: TICKETS,
          counts: COUNTS,
          syncedAt: new Date().toISOString(),
        }
      : {
          mapped: false,
          tickets: [],
          counts: { ongoing: 0, resolvedWeek: 0, mine: 0, incidents: 0, requests: 0 },
          syncedAt: null,
        };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test.describe("Customer Tickets tab", () => {
  // The CI stack serves the built app, which registers a PWA service worker.
  // Playwright's page.route cannot intercept SW-handled fetches, so the iTop
  // mocks below would silently never fire there (they pass on the dev server,
  // which registers no SW). Blocking SW registration makes the mocks
  // authoritative on both stacks — same pattern as search.spec.ts.
  test.use({ serviceWorkers: "block" });

  test("lists ongoing tickets breached-first, filters by class, and links out to iTop", async ({
    page,
    seededProject,
  }) => {
    const { customerId } = seededProject;
    await mockItopStatus(page);
    await mockTickets(page, true);
    await loginViaUi(page);

    await page.goto(`/customers/${customerId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const ticketsTabButton = page.getByRole("button", { name: "Tickets" });
    await expect(ticketsTabButton).toBeVisible();
    await ticketsTabButton.click();
    await page.waitForTimeout(500);

    // 4 rows, in the layout the current viewport actually shows (desktop
    // table rows vs. mobile cards — both exist in the DOM, only one set is
    // `:visible` per viewport, see file header).
    const rows = page.locator('[data-testid="itop-ticket-row"]:visible');
    await expect(rows).toHaveCount(4);

    // SLA-breached ticket (slaTtrPassed) sorts first, matching the
    // backend's own `orderBy: [{ slaTtrPassed: "desc" }, ...]`.
    await expect(rows.first()).toHaveAttribute("data-ref", "R-100");

    // The "Mine" scope chip reflects the mocked counts.
    await expect(page.getByRole("button", { name: "Mine · 1" })).toBeVisible();

    // Clicking "Incidents" re-fetches the tickets query scoped to that class.
    const incidentsRequest = page.waitForRequest((req) => req.url().includes("class=Incident"));
    await page.getByRole("button", { name: "Incidents · 1" }).click();
    const request = await incidentsRequest;
    expect(request.url()).toContain("class=Incident");

    // "Open in iTop ↗" builds the details deep link off the mocked baseUrl.
    const openLink = page.locator('[data-testid="itop-open-link"]:visible').first();
    await expect(openLink).toBeVisible();
    const href = await openLink.getAttribute("href");
    expect(href).toContain(ITOP_BASE_URL);
    expect(href).toContain("operation=details&class=");
  });

  test("hides the Tickets tab for a customer that isn't mapped to an iTop organisation", async ({
    page,
    seededProject,
  }) => {
    const { customerId } = seededProject;
    await mockItopStatus(page);
    await mockTickets(page, false);
    await loginViaUi(page);

    await page.goto(`/customers/${customerId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tickets" })).toHaveCount(0);
  });
});
