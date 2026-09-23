import type { Page } from "@playwright/test";
import { expect, loginViaUi, test } from "../fixtures/test";

// Ticket timer (Task 7.1, docs/archive/plans/itop-integration.md): Start/Stop
// on the ticket panel's "Time" block, backed by POST /itop/tickets/:id/time.
// Every iTop route is intercepted (no real iTop instance needed), same
// approach as itop-ticket-panel.spec.ts — `serviceWorkers: "block"` for the
// same reason (the CI stack's PWA service worker would otherwise swallow
// these mocked fetches).
//
// Backend contract note: the POST's 201 body is `{ entry }` only — no
// `myMinutesThisWeek` of its own (fix round, phase review) —
// `useLogTicketTimeFor` (lib/queries.ts) only invalidates on success, so the
// "this week" figure always comes from the next `GET /itop/tickets/:id?
// utcOffsetMinutes=` refetch. The first test below mocks that GET with a
// figure that only changes once the write actually lands, to prove the
// panel is showing the refetch and not some client-side guess.
//
// Timer storage is per-user (`localStorage["solvro.itopTimer.<userId>"]`,
// fix round, phase review) — `backdateStoredTimer` below finds whichever key
// is actually present rather than hardcoding a user id the seeded fixture
// doesn't expose.

const ITOP_BASE_URL = "https://itop.example.test";
const TICKET_ID = 4530;
const TICKET_REF = "R-004530";
const OTHER_TICKET_ID = 4512;
const OTHER_TICKET_REF = "R-004512";

function isoOffsetHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function baseTicket(id: number, ref: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    class: "UserRequest",
    ref,
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
    ...overrides,
  };
}

async function mockStatus(page: Page): Promise<void> {
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
        actionsEnabled: true,
      }),
    }),
  );
}

async function mockMyToken(page: Page): Promise<void> {
  await page.route("**/api/itop/me/token", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        set: true,
        personName: "Rina S.",
        checkedAt: new Date().toISOString(),
        expiresAt: null,
        actionsEnabled: true,
        configured: true,
      }),
    }),
  );
}

async function mockCustomerTickets(
  page: Page,
  customerId: number,
  tickets: ReturnType<typeof baseTicket>[],
): Promise<void> {
  await page.route(`**/api/itop/customers/${customerId}/tickets*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mapped: true,
        orgName: "Northwind Freight Sdn Bhd",
        tickets,
        counts: {
          ongoing: tickets.length,
          resolvedWeek: 0,
          mine: tickets.filter((t) => t.isMine).length,
          incidents: 0,
          requests: tickets.length,
        },
        syncedAt: new Date().toISOString(),
      }),
    }),
  );
}

/** `getMinutes` is read fresh on every GET — a callback rather than a fixed
 * value, so a spec can flip the returned figure at the moment a write
 * actually lands (the per-test `POST .../time` route mutates the same
 * closure variable the callback reads) instead of counting call ordinals.
 * React 18 StrictMode double-invokes the mount effect that drives
 * `useItopTicket` in dev, so the panel's very first render alone can fire
 * two GETs before any user action — an ordinal-based mock ("1st call
 * returns X, every call after returns Y") would flip prematurely and make
 * the assertion below flaky depending on exactly how many GETs preceded the
 * click, not on whether the write happened. */
async function mockTicketDetail(
  page: Page,
  id: number,
  ref: string,
  getMinutes: () => number,
): Promise<void> {
  await page.route(`**/api/itop/tickets/${id}*`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...baseTicket(id, ref),
        publicLog: [],
        privateLog: [],
        myMinutesThisWeek: getMinutes(),
      }),
    });
  });
}

async function openTicketPanel(page: Page, customerId: number, ref: string) {
  await page.goto(`/customers/${customerId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Tickets" }).click();
  await page.waitForTimeout(500);
  await page.locator(`[data-testid="itop-ticket-row"]:visible[data-ref="${ref}"]`).click();
  const panel = page.getByRole("dialog", { name: "Ticket details" });
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * Rewrites the running timer's `startedAt` to `secondsAgo` seconds in the
 * past, then synthesizes a same-tab `storage` event so `useTicketTimer`'s
 * listener (which only fires natively for a DIFFERENT tab/document) picks
 * up the change immediately — used to push a timer past the backend's
 * 1-minute floor or 24h ceiling without a real wait of that length.
 */
async function backdateStoredTimer(page: Page, secondsAgo: number): Promise<void> {
  await page.evaluate((secondsAgo) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("solvro.itopTimer."));
    if (!key) throw new Error("expected a stored iTop timer key in localStorage");
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error("expected a stored iTop timer value");
    const timer = JSON.parse(raw) as Record<string, unknown>;
    timer.startedAt = new Date(Date.now() - secondsAgo * 1000).toISOString();
    const newValue = JSON.stringify(timer);
    localStorage.setItem(key, newValue);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea: localStorage }));
  }, secondsAgo);
}

test.describe("Ticket timer", () => {
  test.use({ serviceWorkers: "block" });

  test("Start ticks the clock; Stop logs time and the week figure comes from the refetch", async ({
    page,
    seededProject,
  }) => {
    const { customerId } = seededProject;
    await mockStatus(page);
    await mockMyToken(page);
    await mockCustomerTickets(page, customerId, [baseTicket(TICKET_ID, TICKET_REF)]);
    // Flips from 0 to 90 the moment the POST /time write actually lands —
    // see mockTicketDetail's own comment for why this isn't ordinal-based.
    let minutesThisWeek = 0;
    await mockTicketDetail(page, TICKET_ID, TICKET_REF, () => minutesThisWeek);

    let timePostBody: { startedAt: string; endedAt: string } | null = null;
    await page.route(`**/api/itop/tickets/${TICKET_ID}/time`, (route) => {
      timePostBody = route.request().postDataJSON() as { startedAt: string; endedAt: string };
      minutesThisWeek = 90;
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        // `{ entry }` only — matches the real backend's 201 body (fix
        // round, phase review); no `myMinutesThisWeek` here at all.
        body: JSON.stringify({
          entry: {
            id: 1,
            startDate: timePostBody!.startedAt,
            endDate: timePostBody!.endedAt,
            durationMinutes: 2,
            title: null,
            ticketRef: TICKET_REF,
          },
        }),
      });
    });

    await loginViaUi(page);
    const panel = await openTicketPanel(page, customerId, TICKET_REF);

    await expect(panel.getByText("0.0 h this week on this ticket")).toBeVisible();
    await panel.getByRole("button", { name: "Start timer" }).click();

    const elapsed = panel.getByTestId("itop-timer-elapsed");
    await expect(elapsed).toBeVisible();
    await expect(elapsed).toHaveText("00:00:00");
    await page.waitForTimeout(2200);
    await expect(elapsed).not.toHaveText("00:00:00");

    // Only ~2s really elapsed — under the backend's 1-minute floor.
    // Backdating past it (rather than waiting out a real minute) is what
    // lets Stop log directly here, with no sub-minute confirm — that path
    // (Discard/Keep running, never a "log anyway") is its own test below.
    await backdateStoredTimer(page, 65);

    const postRequest = page.waitForRequest(
      (req) => req.url().includes(`/itop/tickets/${TICKET_ID}/time`) && req.method() === "POST",
    );
    await panel.getByRole("button", { name: "Stop" }).click();
    await postRequest;
    await expect(panel.getByText("Less than a minute — discard instead?")).toHaveCount(0);

    expect(timePostBody).not.toBeNull();
    expect(typeof timePostBody!.startedAt).toBe("string");
    expect(typeof timePostBody!.endedAt).toBe("string");
    expect(new Date(timePostBody!.endedAt).getTime()).toBeGreaterThan(
      new Date(timePostBody!.startedAt).getTime(),
    );

    // 90 minutes = 1.5 h, from the REFETCHED GET.
    await expect(panel.getByText("1.5 h this week on this ticket")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Start timer" })).toBeVisible();
  });

  test("Stop under a minute offers only Discard or Keep running — never logs", async ({
    page,
    seededProject,
  }) => {
    const { customerId } = seededProject;
    await mockStatus(page);
    await mockMyToken(page);
    await mockCustomerTickets(page, customerId, [baseTicket(TICKET_ID, TICKET_REF)]);
    await mockTicketDetail(page, TICKET_ID, TICKET_REF, () => 5);

    // The backend rejects a sub-minute entry outright (invalid_duration) —
    // this asserts the REAL outcome (fix round, phase review): no POST ever
    // fires under 60s, through either confirm button.
    const postUrls: string[] = [];
    await page.route(`**/api/itop/tickets/${TICKET_ID}/time`, (route) => {
      postUrls.push(route.request().url());
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          entry: {
            id: 1,
            startDate: new Date().toISOString(),
            endDate: new Date().toISOString(),
            durationMinutes: 1,
            title: null,
            ticketRef: TICKET_REF,
          },
        }),
      });
    });

    await loginViaUi(page);
    const panel = await openTicketPanel(page, customerId, TICKET_REF);

    await panel.getByRole("button", { name: "Start timer" }).click();
    const elapsed = panel.getByTestId("itop-timer-elapsed");
    await expect(elapsed).toBeVisible();

    // Stop immediately — well under the backend's 1-minute floor.
    await panel.getByRole("button", { name: "Stop" }).click();
    await expect(panel.getByText("Less than a minute — discard instead?")).toBeVisible();

    // "Keep running" backs out of the confirm without logging or clearing —
    // the clock is still visible and running afterwards.
    await panel.getByRole("button", { name: "Keep running" }).click();
    await expect(elapsed).toBeVisible();
    await expect(panel.getByRole("button", { name: "Start timer" })).toHaveCount(0);

    // Stop again, this time follow through with Discard.
    await panel.getByRole("button", { name: "Stop" }).click();
    await expect(panel.getByText("Less than a minute — discard instead?")).toBeVisible();
    await panel.getByRole("button", { name: "Discard" }).click();
    await page.waitForTimeout(300);

    expect(postUrls, `expected no POST /time under 60s, got ${JSON.stringify(postUrls)}`).toHaveLength(0);
    await expect(panel.getByRole("button", { name: "Start timer" })).toBeVisible();
  });

  test("a timer past the 24h ceiling shows as expired, offering only Discard", async ({
    page,
    seededProject,
  }) => {
    const { customerId } = seededProject;
    await mockStatus(page);
    await mockMyToken(page);
    await mockCustomerTickets(page, customerId, [baseTicket(TICKET_ID, TICKET_REF)]);
    await mockTicketDetail(page, TICKET_ID, TICKET_REF, () => 0);

    const postUrls: string[] = [];
    await page.route(`**/api/itop/tickets/${TICKET_ID}/time`, (route) => {
      postUrls.push(route.request().url());
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          entry: {
            id: 1,
            startDate: new Date().toISOString(),
            endDate: new Date().toISOString(),
            durationMinutes: 1,
            title: null,
            ticketRef: TICKET_REF,
          },
        }),
      });
    });

    await loginViaUi(page);
    const panel = await openTicketPanel(page, customerId, TICKET_REF);

    await panel.getByRole("button", { name: "Start timer" }).click();
    await expect(panel.getByTestId("itop-timer-elapsed")).toBeVisible();

    // Past the backend's 24h ceiling on a loggable entry.
    await backdateStoredTimer(page, 25 * 3600);

    await expect(panel.getByText("Timer expired — discard")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Stop" })).toHaveCount(0);

    await panel.getByRole("button", { name: "Discard" }).click();
    await expect(panel.getByRole("button", { name: "Start timer" })).toBeVisible();
    expect(postUrls, `expected no POST /time for an expired timer, got ${JSON.stringify(postUrls)}`).toHaveLength(0);
  });

  test("persists across a reload and shows a running-elsewhere notice on another ticket", async ({
    page,
    seededProject,
  }) => {
    const { customerId } = seededProject;
    await mockStatus(page);
    await mockMyToken(page);
    await mockCustomerTickets(page, customerId, [
      baseTicket(TICKET_ID, TICKET_REF),
      baseTicket(OTHER_TICKET_ID, OTHER_TICKET_REF, {
        status: "new",
        isMine: false,
        agentPersonId: null,
        agentName: null,
      }),
    ]);
    await mockTicketDetail(page, TICKET_ID, TICKET_REF, () => 0);
    await mockTicketDetail(page, OTHER_TICKET_ID, OTHER_TICKET_REF, () => 0);

    await loginViaUi(page);
    const panel = await openTicketPanel(page, customerId, TICKET_REF);
    await panel.getByRole("button", { name: "Start timer" }).click();
    await expect(panel.getByTestId("itop-timer-elapsed")).toBeVisible();
    await page.waitForTimeout(1500);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const reloadedPanel = page.getByRole("dialog", { name: "Ticket details" });
    await expect(reloadedPanel).toBeVisible();
    const elapsedAfterReload = reloadedPanel.getByTestId("itop-timer-elapsed");
    await expect(elapsedAfterReload).toBeVisible();
    await expect(elapsedAfterReload).not.toHaveText("00:00:00");

    // Close this panel (full-width on mobile, so the row underneath isn't
    // clickable while it's open) before opening the other ticket's panel.
    await reloadedPanel.getByRole("button", { name: "Close" }).click();
    await expect(reloadedPanel).toBeHidden();

    await page.locator(`[data-testid="itop-ticket-row"]:visible[data-ref="${OTHER_TICKET_REF}"]`).click();
    await page.waitForURL((url) => url.searchParams.get("ticket") === String(OTHER_TICKET_ID));

    const otherPanel = page.getByRole("dialog", { name: "Ticket details" });
    await expect(otherPanel).toBeVisible();
    await expect(otherPanel.getByText("Timer running on")).toBeVisible();
    await expect(otherPanel.getByRole("link", { name: TICKET_REF })).toBeVisible();
  });
});
