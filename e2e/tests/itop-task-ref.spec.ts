import type { Page } from "@playwright/test";
import { expect, apiBase, loginViaUi, test } from "../fixtures/test";
import { createTask } from "../fixtures/seed";

// Task ticket ref field in TaskPanel (Task 4.2,
// docs/archive/plans/itop-integration.md): a task may pin one iTop ticket
// ref, editable from the panel's metadata grid. GET /itop/status and GET
// /itop/tickets/by-ref/:ref are intercepted so the field renders (and its
// status chip resolves) without depending on a real iTop instance or the
// dev stack's snapshot actually containing the ref — same rationale and
// `serviceWorkers: "block"` requirement as itop-tickets.spec.ts (the CI
// stack's PWA service worker would otherwise swallow these mocks). The
// PATCH itself hits the real backend (Task 4.2's backend half, live in this
// same working tree) rather than being mocked, so the saved ref persists
// for the field's own by-ref lookup and no local echo has to mirror the
// full Task shape.
//
// Every test seeds its own throwaway task via the API rather than reusing
// the worker-scoped fixture's alpha/beta/gamma — those are shared across
// this whole spec file (and every other spec run in the same worker), so a
// ref saved by one test/repetition would still be sitting on the task the
// next repetition opens. Fresh task per test keeps `--repeat-each` and
// cross-spec ordering irrelevant.

const ITOP_BASE_URL = "https://itop.example.test";

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

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
        refreshMinutes: 5,
      }),
    }),
  );
}

async function mockTicketByRef(page: Page, ref: string): Promise<void> {
  await page.route(`**/api/itop/tickets/by-ref/${ref}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 501,
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
        startDate: new Date(Date.now() - 3_600_000).toISOString(),
        lastUpdate: new Date().toISOString(),
        tto: null,
        ttr: null,
        slaTtoPassed: false,
        slaTtrPassed: false,
        resolutionDate: null,
        isMine: false,
      }),
    }),
  );
}

// "Create in iTop" from a task (Task 7.2, docs/archive/plans/
// itop-integration.md) — additive mocks for the second describe block below.
// `actionsEnabled: true` is the one difference from `mockItopStatus` above,
// so it's a separate function rather than a param threaded through every
// existing call site.
async function mockItopStatusWithActions(page: Page): Promise<void> {
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
        personName: "QA Admin",
        checkedAt: new Date().toISOString(),
        expiresAt: null,
        actionsEnabled: true,
        configured: true,
      }),
    }),
  );
}

/** `useItopCustomerMapped`'s underlying gate — same `mapped: true` shape
 * `CustomerDetail.tsx`'s own Tickets-tab gate reads. */
async function mockCustomerMapped(page: Page, customerId: number): Promise<void> {
  await page.route(`**/api/itop/customers/${customerId}/tickets*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mapped: true,
        orgName: "QA Fixture Org",
        tickets: [],
        counts: { ongoing: 0, resolvedWeek: 0, mine: 0, incidents: 0, requests: 0 },
        syncedAt: new Date().toISOString(),
      }),
    }),
  );
}

async function mockNewTicketSheetDeps(page: Page, customerId: number): Promise<void> {
  await page.route("**/api/itop/services", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
  );
  await page.route(`**/api/itop/customers/${customerId}/contacts`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: 42, name: "Jane Doe", email: "jane@fixture.test" }]),
    }),
  );
}

async function openTaskPanel(page: Page, projectId: number, taskId: number) {
  await page.goto(`/projects/${projectId}/list?task=${taskId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const panel = page.getByRole("dialog", { name: "Task details" });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("TaskPanel iTop ticket field", () => {
  test.use({ serviceWorkers: "block" });

  test("saves a valid ref and shows its snapshot status", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const task = await createTask(base, token, projectId, { title: `Ticket field ${stamp()}` });
    await mockItopStatus(page);
    await mockTicketByRef(page, "R-004512");
    await loginViaUi(page);

    const panel = await openTaskPanel(page, projectId, task.id);
    const input = panel.getByLabel("iTop ticket");
    await expect(input).toBeVisible();

    const patchRequest = page.waitForRequest(
      (req) => req.method() === "PATCH" && req.url().includes(`/api/tasks/${task.id}`),
    );
    await input.fill("R-004512");
    await input.press("Enter");

    const request = await patchRequest;
    expect(request.postDataJSON()).toMatchObject({ itopTicketRef: "R-004512" });

    await expect(panel.getByText("Assigned", { exact: true })).toBeVisible();
    const openLink = panel.getByRole("link", { name: "Open in iTop ↗" });
    await expect(openLink).toBeVisible();
    const href = await openLink.getAttribute("href");
    expect(href).toContain("class=");
  });

  test("rejects a malformed ref inline without saving", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const task = await createTask(base, token, projectId, { title: `Ticket field ${stamp()}` });
    await mockItopStatus(page);
    await loginViaUi(page);

    const panel = await openTaskPanel(page, projectId, task.id);
    const input = panel.getByLabel("iTop ticket");
    await expect(input).toBeVisible();

    const patches: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "PATCH" && req.url().includes(`/api/tasks/${task.id}`)) {
        patches.push(req.url());
      }
    });

    await input.fill("nonsense");
    await input.press("Enter");
    await page.waitForTimeout(400);

    await expect(panel.getByText("Use the iTop ref, e.g. R-004512")).toBeVisible();
    expect(patches, `expected no PATCH, got ${JSON.stringify(patches)}`).toHaveLength(0);
  });

  test("shows a muted chip for a ref that isn't in the snapshot", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const task = await createTask(base, token, projectId, { title: `Ticket field ${stamp()}` });
    await mockItopStatus(page);
    // Deliberately NOT mocking by-ref for this ticket: the real backend's
    // snapshot has no such ticket in this dev DB, so it answers 404
    // "not_found" on its own — exactly the "unknown ref" case this asserts.
    await loginViaUi(page);

    const panel = await openTaskPanel(page, projectId, task.id);
    const input = panel.getByLabel("iTop ticket");
    await expect(input).toBeVisible();

    const patchRequest = page.waitForRequest(
      (req) => req.method() === "PATCH" && req.url().includes(`/api/tasks/${task.id}`),
    );
    await input.fill("Z-999999");
    await input.press("Enter");
    await patchRequest;

    await expect(panel.getByText("not in snapshot", { exact: true })).toBeVisible();
  });
});

test.describe("TaskPanel Create in iTop", () => {
  test.use({ serviceWorkers: "block" });

  test("creates a ticket from the task and pins its ref", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    // The customer the project belongs to NOW, not the one it was seeded with:
    // the fixture project is shared by the whole worker, and
    // itop-daily-review.spec.ts re-parents it to a customer of its own. The
    // Create-in-iTop gate asks about the project's real customer, so mocking
    // the seed-time one would leave the button hidden whenever that spec ran
    // earlier in the same worker.
    const projectRes = await fetch(
      `${base}/api/projects/${projectId}?today=${new Date().toISOString().slice(0, 10)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const customerId = ((await projectRes.json()) as { customer: { id: number } | null }).customer?.id;
    expect(customerId, "the fixture project has a customer").toBeDefined();
    const taskTitle = `Create ticket ${stamp()}`;
    // `createTask`'s `CreateTaskInput` has no `description` field (nothing
    // in this suite needed one before) — a raw POST here rather than
    // widening that shared fixture helper for one spec's prefill assertion.
    const taskRes = await fetch(`${base}/api/projects/${projectId}/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: taskTitle, description: "Repro steps for the ticket." }),
    });
    const task = (await taskRes.json()) as { id: number };

    await mockItopStatusWithActions(page);
    await mockMyToken(page);
    await mockCustomerMapped(page, customerId!);
    await mockNewTicketSheetDeps(page, customerId!);

    const createdRef = "R-009001";
    await page.route("**/api/itop/tickets", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: 9001,
          class: "UserRequest",
          ref: createdRef,
          title: taskTitle,
          status: "new",
          operationalStatus: "ongoing",
          priority: "3",
          agentPersonId: null,
          agentName: null,
          teamName: null,
          serviceName: null,
          callerName: "Jane Doe",
          startDate: new Date().toISOString(),
          lastUpdate: new Date().toISOString(),
          tto: null,
          ttr: null,
          slaTtoPassed: false,
          slaTtrPassed: false,
          resolutionDate: null,
          isMine: false,
          publicLog: [],
          privateLog: [],
          myMinutesThisWeek: 0,
        }),
      });
    });
    await mockTicketByRef(page, createdRef);

    await loginViaUi(page);

    const panel = await openTaskPanel(page, projectId, task.id);
    const createButton = panel.getByRole("button", { name: "Create in iTop" });
    await expect(createButton).toBeVisible();
    await createButton.click();

    const sheet = page.getByRole("dialog", { name: "New ticket" });
    await expect(sheet).toBeVisible();
    // Prefilled from the task (Task 7.2's acceptance: title + description).
    await expect(sheet.locator("input[type='text']")).toHaveValue(taskTitle);
    await expect(sheet.locator("textarea")).toHaveValue("Repro steps for the ticket.");

    // Caller is required (`canSubmit` in NewTicketSheet.tsx) — the mocked
    // contacts list has exactly one option.
    await sheet.locator("select").nth(1).selectOption("42");

    const createRequest = page.waitForRequest(
      (req) => req.url().endsWith("/api/itop/tickets") && req.method() === "POST",
    );
    const patchRequest = page.waitForRequest(
      (req) => req.method() === "PATCH" && req.url().includes(`/api/tasks/${task.id}`),
    );
    await sheet.getByRole("button", { name: "Create in iTop" }).click();

    await createRequest;
    const patch = await patchRequest;
    expect(patch.postDataJSON()).toMatchObject({ itopTicketRef: createdRef });

    await expect(sheet).toBeHidden();
    await expect(panel.getByText(createdRef, { exact: true })).toBeVisible();
    await expect(panel.getByText("Assigned", { exact: true })).toBeVisible();
  });
});
