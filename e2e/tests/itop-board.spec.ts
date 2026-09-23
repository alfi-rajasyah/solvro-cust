import type { Page, Request } from "@playwright/test";
import { center, expect, gripFor, loginViaUi, mouseDrag, test, touchDrag } from "../fixtures/test";

// Tickets tab Board view (Task 6.1, docs/archive/plans/itop-integration.md
// — mockup "5 · The Tickets tab gets a Board" in
// docs/archive/plans/itop-integration-spec.md). Every iTop route is
// intercepted via page.route, matching itop-ticket-panel.spec.ts's own
// convention — no real iTop instance needed. `serviceWorkers: "block"`
// (hoisted to file scope, fix round item 6 — every test in this file mocks
// iTop routes, not just the New-ticket-sheet describe): the CI stack's PWA
// service worker would otherwise swallow these mocked fetches (same
// rationale as itop-tickets.spec.ts).
test.use({ serviceWorkers: "block" });

const ITOP_BASE_URL = "https://itop.example.test";

function isoOffsetHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

interface MockTicket {
  id: number;
  class: string;
  ref: string;
  title: string;
  status: string;
  operationalStatus: string | null;
  priority: string | null;
  agentPersonId: number | null;
  agentName: string | null;
  teamName: string | null;
  serviceName: string | null;
  callerName: string | null;
  startDate: string | null;
  lastUpdate: string;
  tto: string | null;
  ttr: string | null;
  slaTtoPassed: boolean;
  slaTtrPassed: boolean;
  resolutionDate: string | null;
  isMine: boolean;
}

function ticket(id: number, ref: string, status: string, title: string): MockTicket {
  return {
    id,
    class: "UserRequest",
    ref,
    title,
    status,
    operationalStatus: "ongoing",
    priority: "3",
    agentPersonId: status === "new" ? null : 7,
    agentName: status === "new" ? null : "Rina S.",
    teamName: status === "new" ? null : "Service Desk",
    serviceName: "Backup",
    callerName: "Jane",
    startDate: isoOffsetHours(-5),
    lastUpdate: isoOffsetHours(-1),
    tto: null,
    ttr: null,
    slaTtoPassed: false,
    slaTtrPassed: false,
    resolutionDate: null,
    isMine: false,
  };
}

function makeTickets(): MockTicket[] {
  return [
    ticket(910, "R-910", "new", "Firewall rule for the new HR app"),
    ticket(911, "R-911", "assigned", "Add 2 users to the Acronis console"),
    ticket(912, "R-912", "pending", "Monthly backup report not received"),
    ticket(913, "R-913", "resolved", "Printer queue stuck, floor 3"),
    ticket(914, "R-914", "closed", "VPN client install"),
  ];
}

const COUNTS = { ongoing: 3, resolvedWeek: 2, mine: 0, incidents: 0, requests: 5 };

// iTop's default lifecycle stimulus -> resulting status, mirroring
// `dropMapper.ts`'s TRANSITIONS map — used by the mocked `/actions` route
// below to answer with the SAME status a real backend would apply.
const STATUS_AFTER_ACTION: Record<string, string> = {
  assign_to_me: "assigned",
  pending: "pending",
  resolve: "resolved",
  close: "closed",
  reopen: "assigned",
};

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

/** Serves BOTH the Board's two scope fetches (ongoing, resolved_week) and
 * the Table/filter-chip gate fetch off the SAME mutable ticket list — the
 * mocked `/actions` route below mutates a ticket's `status` in place, so a
 * post-action refetch (triggered by TicketBoard's own cache invalidation)
 * picks up the new status without a second route registration. */
async function mockCustomerTickets(page: Page, tickets: MockTicket[]): Promise<void> {
  await page.route("**/api/itop/customers/*/tickets*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mapped: true,
        orgName: "Northwind Freight Sdn Bhd",
        tickets,
        counts: COUNTS,
        syncedAt: new Date().toISOString(),
      }),
    }),
  );
}

async function mockActions(page: Page, tickets: MockTicket[]): Promise<void> {
  await page.route("**/api/itop/tickets/*/actions", (route) => {
    const url = route.request().url();
    const match = /\/tickets\/(\d+)\/actions/.exec(url);
    const id = match ? Number(match[1]) : null;
    const body = route.request().postDataJSON() as { action: string };
    const target = tickets.find((t) => t.id === id);
    if (target && STATUS_AFTER_ACTION[body.action]) {
      target.status = STATUS_AFTER_ACTION[body.action];
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...target, publicLog: [], privateLog: [] }),
    });
  });
}

interface CapturedActionRequest {
  url: string;
  body: Record<string, unknown> | null;
}

async function captureActionRequests(
  page: Page,
  fn: () => Promise<void>,
): Promise<CapturedActionRequest[]> {
  const requests: CapturedActionRequest[] = [];
  const onRequest = (req: Request) => {
    if (req.method() !== "POST") return;
    if (!req.url().includes("/itop/tickets/") || !req.url().includes("/actions")) return;
    let body: Record<string, unknown> | null = null;
    try {
      body = req.postDataJSON() as Record<string, unknown>;
    } catch {
      body = null;
    }
    requests.push({ url: req.url(), body });
  };
  page.on("request", onRequest);
  try {
    await fn();
    await page.waitForTimeout(800);
  } finally {
    page.off("request", onRequest);
  }
  return requests;
}

async function openBoard(page: Page, customerId: number): Promise<void> {
  // Plain navigate + explicit tab/switch clicks (same convention as
  // itop-tickets.spec.ts / itop-ticket-panel.spec.ts) rather than a
  // `?tab=tickets&view=board` deep link — avoids racing the mapped-customer
  // gate query that decides whether "Tickets" even appears in `TAB_ITEMS`
  // on first render (CustomerDetail.tsx).
  await page.goto(`/customers/${customerId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Tickets" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.waitForTimeout(500);
  await expect(page.getByRole("button", { name: "Board", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

function boardCard(page: Page, ref: string) {
  return page.locator(`[data-testid="itop-board-card"][data-ref="${ref}"]`);
}

function boardColumn(page: Page, column: string) {
  return page.locator(`[data-slot="kanban-column"][data-value="${column}"]`);
}

/**
 * Drop target near a column's own TOP (just past its header), not its
 * bottom edge. dnd-kit's collision detection compares the DRAGGED ITEM's
 * own rect (translated by the finger/pointer delta, not the raw pointer
 * position itself) against droppable rects — the grabbed card's own height
 * therefore extends past wherever the pointer lands. On this board's mobile
 * layout (`md:grid-cols-5` collapses to a single stacked column below
 * `md:`), columns sit directly on top of one another, so a bottom-edge
 * target lets the dragged card's own height push the resolved collision
 * into the NEXT column down (captured live: an "Assigned -> Pending" touch
 * drag aimed at Pending's bottom resolved to Closed instead). Desktop's
 * side-by-side grid isn't affected by this (overshoot stays within the same
 * column vertically), but targeting the top is harmless there too.
 */
function dropTargetPoint(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + 40 };
}

test.describe("Tickets Board — desktop (mouse)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "mouse drag cases run on the desktop project only");
  });

  test("shows 5 columns with counts, drags an allowed step, rejects a forbidden one, and opens the resolve sheet", async ({
    page,
    seededProject,
  }) => {
    const tickets = makeTickets();
    await mockStatus(page, true);
    await mockMyToken(page, true);
    await mockCustomerTickets(page, tickets);
    await mockActions(page, tickets);
    await loginViaUi(page);

    await openBoard(page, seededProject.customerId);

    // 5 columns, each with exactly one seeded card.
    for (const [column, ref] of [
      ["new", "R-910"],
      ["assigned", "R-911"],
      ["pending", "R-912"],
      ["resolved", "R-913"],
      ["closed", "R-914"],
    ] as const) {
      await expect(boardColumn(page, column)).toBeVisible();
      await expect(boardColumn(page, column).getByText("1", { exact: true })).toBeVisible();
      await expect(boardCard(page, ref)).toBeVisible();
    }

    // Allowed step: Assigned (R-911) -> Pending fires `{ action: "pending" }`
    // and the card lands in Pending after the mocked refetch.
    const assignedGrip = await gripFor(page, "R-911", "Drag ticket");
    const pendingColumnBox = await boardColumn(page, "pending").boundingBox();
    expect(assignedGrip, "grip for R-911 not found").toBeTruthy();
    expect(pendingColumnBox, "Pending column not found").toBeTruthy();

    const pendingRequests = await captureActionRequests(page, async () => {
      await mouseDrag(page, center(assignedGrip!), dropTargetPoint(pendingColumnBox!));
    });
    expect(pendingRequests.length).toBe(1);
    expect(pendingRequests[0].body).toEqual({ action: "pending" });
    await expect(boardColumn(page, "pending").locator('[data-ref="R-911"]')).toBeVisible();
    await expect(boardColumn(page, "assigned").locator('[data-ref="R-911"]')).toHaveCount(0);

    // Forbidden step: New (R-910) -> Closed fires no request at all, and the
    // card stays in New.
    const newGrip = await gripFor(page, "R-910", "Drag ticket");
    const closedColumnBox = await boardColumn(page, "closed").boundingBox();
    expect(newGrip, "grip for R-910 not found").toBeTruthy();
    expect(closedColumnBox, "Closed column not found").toBeTruthy();

    const forbiddenRequests = await captureActionRequests(page, async () => {
      await mouseDrag(page, center(newGrip!), dropTargetPoint(closedColumnBox!));
    });
    expect(forbiddenRequests.length).toBe(0);
    await expect(boardColumn(page, "new").locator('[data-ref="R-910"]')).toBeVisible();
    await expect(boardColumn(page, "closed").locator('[data-ref="R-910"]')).toHaveCount(0);

    // Resolve step: dragging Pending's R-912 -> Resolved opens the shared
    // resolve ActionSheet instead of firing the action directly.
    const pendingGrip = await gripFor(page, "R-912", "Drag ticket");
    const resolvedColumnBox = await boardColumn(page, "resolved").boundingBox();
    expect(pendingGrip, "grip for R-912 not found").toBeTruthy();
    expect(resolvedColumnBox, "Resolved column not found").toBeTruthy();

    await mouseDrag(page, center(pendingGrip!), dropTargetPoint(resolvedColumnBox!));

    const sheet = page.getByRole("dialog", { name: /Resolve R-912/ });
    await expect(sheet).toBeVisible();
  });

  test("a 409 itop_team_required on New -> Assigned opens the team sheet; the retry carries team_id", async ({
    page,
    seededProject,
  }) => {
    const tickets = makeTickets();
    await mockStatus(page, true);
    await mockMyToken(page, true);
    await mockCustomerTickets(page, tickets);
    // `assign_to_me` refuses 409 until the retry includes `team_id` — same
    // refusal shape `TicketPanel.tsx`'s own team-required test drives
    // (backend/src/routes/itop.ts's `itop_team_required` contract).
    await page.route("**/api/itop/tickets/*/actions", (route) => {
      const url = route.request().url();
      const match = /\/tickets\/(\d+)\/actions/.exec(url);
      const id = match ? Number(match[1]) : null;
      const body = route.request().postDataJSON() as {
        action: string;
        fields?: { team_id?: number };
      };
      if (body.action === "assign_to_me" && !body.fields?.team_id) {
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: "iTop needs a team for this step.",
            code: "itop_team_required",
            details: {
              teams: [
                { id: 5, name: "Service Desk" },
                { id: 6, name: "NOC" },
              ],
            },
          }),
        });
      }
      const target = tickets.find((t) => t.id === id);
      if (target) target.status = "assigned";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...target, publicLog: [], privateLog: [] }),
      });
    });
    await loginViaUi(page);

    await openBoard(page, seededProject.customerId);

    const newGrip = await gripFor(page, "R-910", "Drag ticket");
    const assignedColumnBox = await boardColumn(page, "assigned").boundingBox();
    expect(newGrip, "grip for R-910 not found").toBeTruthy();
    expect(assignedColumnBox, "Assigned column not found").toBeTruthy();

    await mouseDrag(page, center(newGrip!), dropTargetPoint(assignedColumnBox!));

    const sheet = page.getByRole("dialog", { name: /Assign R-910/ });
    await expect(sheet).toBeVisible();
    await sheet.locator("select").selectOption("5");

    const retryRequest = page.waitForRequest(
      (req) => req.url().includes("/itop/tickets/910/actions") && req.method() === "POST",
    );
    await sheet.getByRole("button", { name: "Assign in iTop" }).click();
    const request = await retryRequest;
    const body = request.postDataJSON() as Record<string, unknown>;
    expect(body).toEqual({ action: "assign_to_me", fields: { team_id: 5 } });

    await expect(sheet).toBeHidden();
    await expect(boardColumn(page, "assigned").locator('[data-ref="R-910"]')).toBeVisible();
  });
});

test.describe("Tickets Board — mobile (touch)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "touch drag cases run on the mobile project only");
  });

  test("drags an allowed step via touch", async ({ page, seededProject }) => {
    const tickets = makeTickets();
    await mockStatus(page, true);
    await mockMyToken(page, true);
    await mockCustomerTickets(page, tickets);
    await mockActions(page, tickets);
    await loginViaUi(page);

    await openBoard(page, seededProject.customerId);
    // `scrollIntoViewIfNeeded()`'s default "nearest" alignment can leave the
    // card sitting right under the page's fixed top nav bar (its own
    // bounding box technically "visible" in the DOM sense but obscured by a
    // higher-stacked element, so a touch dispatched at its coordinates hits
    // the nav bar instead) — `block: "center"` keeps clearance from the
    // header and leaves the Pending column below at least partially in
    // view too, now that the real (post-layout-fix) column heights are
    // taller than the old squashed `auto-rows-fr` bug ever let them render.
    await boardCard(page, "R-911").evaluate((el) => el.scrollIntoView({ block: "center" }));

    const assignedGrip = await gripFor(page, "R-911", "Drag ticket");
    const pendingColumnBox = await boardColumn(page, "pending").boundingBox();
    expect(assignedGrip, "grip for R-911 not found").toBeTruthy();
    expect(pendingColumnBox, "Pending column not found").toBeTruthy();

    const pendingRequests = await captureActionRequests(page, async () => {
      await touchDrag(page, center(assignedGrip!), dropTargetPoint(pendingColumnBox!));
    });
    expect(pendingRequests.length).toBe(1);
    expect(pendingRequests[0].body).toEqual({ action: "pending" });
    await expect(boardColumn(page, "pending").locator('[data-ref="R-911"]')).toBeVisible();
    await expect(boardColumn(page, "assigned").locator('[data-ref="R-911"]')).toHaveCount(0);
  });

  // Fix round blocker 1: `KanbanBoard`'s vendor default className (`grid
  // auto-rows-fr gap-4 sm:grid-cols-3`, reui/kanban.tsx) used to merge with
  // TicketBoard.tsx's own `grid gap-3 md:grid-cols-5` instead of being
  // replaced — below 640px, the surviving `auto-rows-fr` collapsed every
  // column into equal-height rows whose actual content overflowed and bled
  // into the next column (the exact bug `kanban-v2/SolvroKanban.tsx:13-18`
  // already documents for the task board). Two independent proofs a real
  // per-column layout, not a collapsed/overlapping one, is rendering: each
  // column's card count matches its own header count, and no two columns'
  // bounding boxes vertically overlap (this board's mobile layout stacks
  // columns in a single column below `md:`, so a real fix means column N's
  // box ends before column N+1's box begins).
  test("stacks columns vertically without overlap, and each column's card count matches its header count", async ({
    page,
    seededProject,
  }) => {
    const tickets = makeTickets();
    await mockStatus(page, true);
    await mockMyToken(page, true);
    await mockCustomerTickets(page, tickets);
    await loginViaUi(page);

    await openBoard(page, seededProject.customerId);

    const boxes: Array<{ column: string; box: { x: number; y: number; width: number; height: number } }> = [];
    for (const column of ["new", "assigned", "pending", "resolved", "closed"] as const) {
      const col = boardColumn(page, column);
      await expect(col).toBeVisible();
      // Every seeded column has exactly 1 card (makeTickets()) — the header
      // badge and the actual rendered card count must agree.
      await expect(col.getByText("1", { exact: true })).toBeVisible();
      await expect(col.locator('[data-testid="itop-board-card"]')).toHaveCount(1);

      const box = await col.boundingBox();
      expect(box, `${column} column not found`).toBeTruthy();
      boxes.push({ column, box: box! });
    }

    const sorted = [...boxes].sort((a, b) => a.box.y - b.box.y);
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      expect(
        next.box.y,
        `${current.column} (bottom ${current.box.y + current.box.height}) and ${next.column} (top ${next.box.y}) overlap`,
      ).toBeGreaterThanOrEqual(current.box.y + current.box.height);
    }
  });
});

test.describe("Tickets Board — read-only without a token", () => {
  test("shows the disabled-drag note and hides New ticket", async ({ page, seededProject }) => {
    const tickets = makeTickets();
    await mockStatus(page, true);
    await mockMyToken(page, false);
    await mockCustomerTickets(page, tickets);
    await loginViaUi(page);

    await openBoard(page, seededProject.customerId);

    await expect(page.getByText("Add your personal iTop token in")).toBeVisible();
    await expect(page.getByRole("button", { name: "New ticket" })).toHaveCount(0);
    // No drag handle rendered anywhere on the board in read-only mode.
    await expect(page.locator('[aria-label="Drag ticket"]')).toHaveCount(0);
  });
});

test.describe("New ticket sheet", () => {
  test("submits POST /api/itop/tickets with the expected body and opens the panel", async ({
    page,
    seededProject,
  }) => {
    const tickets = makeTickets();
    await mockStatus(page, true);
    await mockMyToken(page, true);
    await mockCustomerTickets(page, tickets);
    await page.route("**/api/itop/services", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 1, name: "Backup", providerName: "Internal IT" }]),
      }),
    );
    await page.route(`**/api/itop/customers/${seededProject.customerId}/contacts`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 42, name: "Jane Doe", email: "jane@northwind.test" }]),
      }),
    );

    const createdTicket = ticket(999, "R-999", "new", "New firewall rule");
    await page.route("**/api/itop/tickets", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ ...createdTicket, publicLog: [], privateLog: [] }),
      });
    });

    await loginViaUi(page);
    await page.goto(`/customers/${seededProject.customerId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Tickets" }).click();
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: "New ticket" }).click();
    const dialog = page.getByRole("dialog", { name: "New ticket" });
    await expect(dialog).toBeVisible();

    // Positional, not label-text-based: `Modal.tsx`'s label markup nests a
    // required-asterisk `<span>` inside each field's label span, so the
    // implicit label's accessible name is "Title *", not "Title" — matching
    // on field order (Type select, Title input, Caller select, Service
    // select, Description textarea) is simpler than a fuzzy label regex.
    await dialog.locator("input[type='text']").fill("New firewall rule");
    await dialog.locator("select").nth(1).selectOption("42");
    await dialog.locator("textarea").fill("Please open port 443 for the new HR app.");

    const createRequest = page.waitForRequest(
      (req) => req.url().endsWith("/api/itop/tickets") && req.method() === "POST",
    );
    await dialog.getByRole("button", { name: "Create in iTop" }).click();
    const request = await createRequest;
    const body = request.postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({
      customerId: seededProject.customerId,
      class: "UserRequest",
      title: "New firewall rule",
      description: "Please open port 443 for the new HR app.",
      callerId: 42,
    });

    await page.waitForURL((url) => url.searchParams.get("ticket") === "999");
    const panel = page.getByRole("dialog", { name: "Ticket details" });
    await expect(panel).toBeVisible();
  });
});
