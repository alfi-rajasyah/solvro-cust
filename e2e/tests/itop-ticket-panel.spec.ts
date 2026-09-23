import type { Page } from "@playwright/test";
import { expect, loginViaUi, test } from "../fixtures/test";

// Ticket panel + action sheet (docs/archive/plans/itop-integration.md Task
// 5.4): every iTop route is intercepted via page.route, so this spec never
// needs a real iTop instance — it only exercises the panel's rendering,
// action-sheet submission, and read-only gating against scripted responses
// matching the contract in backend/src/routes/itop.ts. `serviceWorkers:
// "block"` for the same reason as itop-tickets.spec.ts: the CI stack's PWA
// service worker would otherwise swallow these mocked fetches.

const ITOP_BASE_URL = "https://itop.example.test";
const TICKET_ID = 4530;

function isoOffsetHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

const ASSIGNED_TICKET = {
  id: TICKET_ID,
  class: "UserRequest",
  ref: "R-004530",
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
  isMine: true,
};

const NEW_TICKET = {
  id: 4535,
  class: "UserRequest",
  ref: "R-004535",
  title: "Firewall rule for the new HR app",
  status: "new",
  operationalStatus: "ongoing",
  priority: "2",
  agentPersonId: null,
  agentName: null,
  teamName: null,
  serviceName: "Network",
  callerName: "HR",
  startDate: isoOffsetHours(-0.5),
  lastUpdate: isoOffsetHours(-0.1),
  tto: isoOffsetHours(1),
  ttr: isoOffsetHours(1.3),
  slaTtoPassed: false,
  slaTtrPassed: false,
  resolutionDate: null,
  isMine: false,
};

const TICKETS = [ASSIGNED_TICKET, NEW_TICKET];
const COUNTS = { ongoing: 2, resolvedWeek: 0, mine: 1, incidents: 0, requests: 2 };

const PUBLIC_LOG_2 = [
  { date: isoOffsetHours(-5), author: "Jane", message: "Please add both new hires." },
  { date: isoOffsetHours(-1), author: "Rina S.", message: "Working on it now." },
];

async function mockStatus(page: Page, actionsEnabled: boolean): Promise<void> {
  await page.route("**/api/itop/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        baseUrl: ITOP_BASE_URL,
        lastSyncAt: new Date().toISOString(),
        lastSyncOk: true,
        refreshMinutes: 5,
        actionsEnabled,
      }),
    }),
  );
}

async function mockMyToken(page: Page, set: boolean): Promise<void> {
  await page.route("**/api/itop/me/token", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        set,
        personName: set ? "QA Admin" : null,
        checkedAt: set ? new Date().toISOString() : null,
        expiresAt: null,
        actionsEnabled: true,
        configured: true,
      }),
    }),
  );
}

async function mockCustomerTickets(page: Page): Promise<void> {
  await page.route("**/api/itop/customers/*/tickets*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mapped: true,
        orgName: "Northwind Freight Sdn Bhd",
        tickets: TICKETS,
        counts: COUNTS,
        syncedAt: new Date().toISOString(),
      }),
    }),
  );
}

interface TicketDetailOverrides {
  status?: string;
  publicLog?: typeof PUBLIC_LOG_2;
}

// 90 minutes = "1.5 h this week on this ticket" — only `GET
// /itop/tickets/:id` (routes/itop.ts) computes this figure at all; the
// action/log/create write routes' `core/get` echo never includes it (fix
// round, phase review). `ticketDetailBody` is the GET shape and carries it;
// `actionResponseBody` is the write-route shape and deliberately omits it,
// so specs below can assert the panel keeps showing the figure it already
// had rather than flashing to "0.0 h" after a write.
const MY_MINUTES_THIS_WEEK = 90;

function ticketDetailBody(overrides: TicketDetailOverrides = {}) {
  return {
    ...ASSIGNED_TICKET,
    status: overrides.status ?? ASSIGNED_TICKET.status,
    publicLog: overrides.publicLog ?? PUBLIC_LOG_2,
    privateLog: [],
    myMinutesThisWeek: MY_MINUTES_THIS_WEEK,
  };
}

function actionResponseBody(overrides: TicketDetailOverrides = {}) {
  const { myMinutesThisWeek: _myMinutesThisWeek, ...rest } = ticketDetailBody(overrides);
  return rest;
}

async function mockTicketDetail(page: Page, overrides: TicketDetailOverrides = {}): Promise<void> {
  // Trailing `*` (Task 7.1, docs/archive/plans/itop-integration.md):
  // `useItopTicket` (lib/queries.ts) now appends `?utcOffsetMinutes=` to
  // this GET so the backend can bucket `myMinutesThisWeek` by the caller's
  // local week — an exact-path route pattern with no wildcard for the query
  // string no longer matches the real request URL.
  await page.route(`**/api/itop/tickets/${TICKET_ID}*`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ticketDetailBody(overrides)),
    });
  });
}

test.describe("Ticket panel", () => {
  test.use({ serviceWorkers: "block" });

  test("Resolve opens the sheet and submits iTop's required fields", async ({
    page,
    seededProject,
  }) => {
    const { customerId } = seededProject;
    await mockStatus(page, true);
    await mockMyToken(page, true);
    await mockCustomerTickets(page);
    await mockTicketDetail(page);
    await page.route(`**/api/itop/tickets/${TICKET_ID}/actions`, (route) => {
      const body = route.request().postDataJSON() as {
        action: string;
        fields?: Record<string, unknown>;
      };
      if (body.action !== "resolve" || !body.fields?.resolution_code || !body.fields?.solution) {
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "Missing required fields." }),
        });
      }
      // `actionResponseBody`, not `ticketDetailBody` — the real
      // /actions route's `core/get` echo never carries `myMinutesThisWeek`
      // (only the plain GET does); this is what exercises the panel's merge
      // fix below rather than papering over it with a mock that's more
      // complete than the real backend.
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(actionResponseBody({ status: "resolved" })),
      });
    });

    await loginViaUi(page);
    await page.goto(`/customers/${customerId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Tickets" }).click();
    await page.waitForTimeout(500);

    const row = page.locator('[data-testid="itop-ticket-row"]:visible[data-ref="R-004530"]');
    await row.click();
    await page.waitForURL((url) => url.searchParams.get("ticket") === String(TICKET_ID));

    const panel = page.getByRole("dialog", { name: "Ticket details" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Please add both new hires.")).toBeVisible();
    await expect(panel.getByText("Working on it now.")).toBeVisible();
    // Fetched from the (complete) GET before any action fires.
    await expect(panel.getByText("1.5 h this week on this ticket")).toBeVisible();

    await panel.getByRole("button", { name: "Resolve" }).click();

    const sheet = page.getByRole("dialog", { name: /Resolve R-004530/ });
    await expect(sheet).toBeVisible();
    await sheet.locator("textarea").fill("Both users created in the Acronis console.");

    const actionRequest = page.waitForRequest(
      (req) => req.url().includes(`/itop/tickets/${TICKET_ID}/actions`) && req.method() === "POST",
    );
    await sheet.getByRole("button", { name: "Resolve in iTop" }).click();
    const request = await actionRequest;
    const requestBody = request.postDataJSON() as {
      action: string;
      fields: { resolution_code: string; solution: string };
    };
    expect(requestBody.action).toBe("resolve");
    expect(requestBody.fields.solution).toContain("Acronis console");
    expect(requestBody.fields.resolution_code).toBeTruthy();

    await expect(sheet).toBeHidden();
    await expect(panel.getByText("Resolved")).toBeVisible();
    // The figure survives the action (fix round, phase review) — merged
    // from the previous cache rather than overwritten with the write
    // route's response, which has no `myMinutesThisWeek` of its own.
    await expect(panel.getByText("1.5 h this week on this ticket")).toBeVisible();
  });

  test("shows a stale notice when iTop accepts a write but the follow-up read fails", async ({
    page,
    seededProject,
  }) => {
    const { customerId } = seededProject;
    await mockStatus(page, true);
    await mockMyToken(page, true);
    await mockCustomerTickets(page);
    await mockTicketDetail(page);
    await page.route(`**/api/itop/tickets/${TICKET_ID}/actions`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        // The row here is the PRE-write snapshot on purpose — staleAfterWrite
        // tells the panel iTop applied the action but the immediate
        // `core/get` failed, so this response must not be cached as current.
        body: JSON.stringify({ ...ticketDetailBody(), staleAfterWrite: true }),
      }),
    );

    await loginViaUi(page);
    await page.goto(`/customers/${customerId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Tickets" }).click();
    await page.waitForTimeout(500);

    await page.locator('[data-testid="itop-ticket-row"]:visible[data-ref="R-004530"]').click();
    const panel = page.getByRole("dialog", { name: "Ticket details" });
    await expect(panel).toBeVisible();

    await panel.getByRole("button", { name: "Pending" }).click();

    await expect(
      panel.getByText("Applied in iTop. The list refreshes on the next sync"),
    ).toBeVisible();
    // The chip never flips to a client guess — it stays whatever the (still
    // "assigned") GET mock says, since the stale response was invalidated,
    // not cached.
    await expect(panel.getByText("Assigned", { exact: true })).toBeVisible();
  });

  test("is read-only without a personal token", async ({ page, seededProject }) => {
    const { customerId } = seededProject;
    await mockStatus(page, true);
    await mockMyToken(page, false);
    await mockCustomerTickets(page);
    await mockTicketDetail(page);

    await loginViaUi(page);
    await page.goto(`/customers/${customerId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Tickets" }).click();
    await page.waitForTimeout(500);

    await page.locator('[data-testid="itop-ticket-row"]:visible[data-ref="R-004530"]').click();
    const panel = page.getByRole("dialog", { name: "Ticket details" });
    await expect(panel).toBeVisible();

    await expect(panel.getByRole("button", { name: "Resolve" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Pending" })).toHaveCount(0);
    await expect(panel.getByText("Add your personal iTop token")).toBeVisible();
    await expect(panel.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  test("adding a public log entry shows it in the list", async ({ page, seededProject }) => {
    const { customerId } = seededProject;
    await mockStatus(page, true);
    await mockMyToken(page, true);
    await mockCustomerTickets(page);
    await mockTicketDetail(page);
    await page.route(`**/api/itop/tickets/${TICKET_ID}/log`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        // `actionResponseBody`, not `ticketDetailBody` — see the "Resolve"
        // test above for why: the /log route's echo carries no
        // `myMinutesThisWeek` either.
        body: JSON.stringify(
          actionResponseBody({
            publicLog: [
              ...PUBLIC_LOG_2,
              { date: new Date().toISOString(), author: "QA Admin", message: "Escalated to L2." },
            ],
          }),
        ),
      }),
    );

    await loginViaUi(page);
    await page.goto(`/customers/${customerId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Tickets" }).click();
    await page.waitForTimeout(500);

    await page.locator('[data-testid="itop-ticket-row"]:visible[data-ref="R-004530"]').click();
    const panel = page.getByRole("dialog", { name: "Ticket details" });
    await expect(panel).toBeVisible();

    await panel.getByPlaceholder("Add a log entry…").fill("Escalated to L2.");
    await panel.getByRole("button", { name: "Add entry" }).click();

    await expect(panel.getByText("Escalated to L2.")).toBeVisible();
  });
});
