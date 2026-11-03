import type { Page } from "@playwright/test";
import { expect, apiBase, loginViaUi, test } from "../fixtures/test";
import { createTask } from "../fixtures/seed";

// Starting iTop work from the task modal and panel
// (docs/archive/plans/subtask-itop-tickets.md Tasks 5-7): pin a ticket from
// the New task modal, "Assign to me" from the task panel, and the ticket
// timer inside the panel. iTop is mocked at the HTTP boundary (status, token,
// by-ref, detail, actions, time) exactly as itop-task-ref / itop-timer do;
// the task create / pin requests hit the real backend.

const ITOP_BASE_URL = "https://itop.example.test";
const TICKET_ID = 7701;
const TICKET_REF = "R-007701";

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function ticketRow(status: string, agentName: string | null, customerId: number | null) {
  return {
    customerId,
    id: TICKET_ID,
    class: "UserRequest",
    ref: TICKET_REF,
    title: "Reset the VPN gateway",
    status,
    operationalStatus: "ongoing",
    priority: "3",
    agentPersonId: agentName ? 7 : null,
    agentName,
    teamName: "Service Desk",
    serviceName: "Network",
    callerName: "Jane",
    startDate: new Date(Date.now() - 3_600_000).toISOString(),
    lastUpdate: new Date().toISOString(),
    tto: null,
    ttr: null,
    slaTtoPassed: false,
    slaTtrPassed: false,
    resolutionDate: null,
    isMine: agentName !== null,
  };
}

async function mockItop(
  page: Page,
  state: { status: string; minutes: number },
  customerId: number | null = null,
): Promise<void> {
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
  await page.route(`**/api/itop/tickets/by-ref/${TICKET_REF}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ticketRow(state.status, state.status === "new" ? null : "QA Admin", customerId)),
    }),
  );
  // Detail GET (week figure); non-GETs fall through to the per-test routes.
  await page.route(`**/api/itop/tickets/${TICKET_ID}*`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...ticketRow(state.status, state.status === "new" ? null : "QA Admin", customerId),
        publicLog: [],
        privateLog: [],
        myMinutesThisWeek: state.minutes,
      }),
    });
  });
}

/** The customer the project belongs to NOW (a sibling spec re-parents the shared fixture project). */
async function projectCustomerId(base: string, token: string, projectId: number): Promise<number> {
  const res = await fetch(`${base}/api/projects/${projectId}?today=${new Date().toISOString().slice(0, 10)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const id = ((await res.json()) as { customer: { id: number } | null }).customer?.id;
  expect(id, "the fixture project has a customer").toBeDefined();
  return id!;
}

async function pinRef(base: string, token: string, taskId: number): Promise<void> {
  const res = await fetch(`${base}/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ itopTicketRef: TICKET_REF }),
  });
  expect(res.ok).toBe(true);
}

async function openTaskPanel(page: Page, projectId: number, taskId: number) {
  await page.goto(`/projects/${projectId}/list?task=${taskId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const panel = page.getByRole("dialog", { name: "Task details" });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("iTop from the task modal and panel", () => {
  test.use({ serviceWorkers: "block" });

  test("New task modal pins a ref and sends it with the create request", async ({ page, seededProject }) => {
    const { projectId } = seededProject;
    const state = { status: "new", minutes: 0 };
    await mockItop(page, state);
    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Add task$/ }).click();

    const drawer = page.getByRole("dialog", { name: "New task" });
    const title = page.getByPlaceholder("Task title");
    await title.fill(`Modal ticket ${stamp()}`);

    const field = drawer.getByLabel("iTop ticket", { exact: true });
    await expect(field).toBeVisible();
    await field.fill("r-007701");
    // Enter pins the ref; it must not submit the task form.
    await field.press("Enter");
    await expect(drawer.getByText(TICKET_REF, { exact: true })).toBeVisible();
    await expect(drawer.getByText("New", { exact: true })).toBeVisible();
    await expect(title).toBeVisible();

    const createRequest = page.waitForRequest(
      (req) => req.method() === "POST" && req.url().endsWith(`/api/projects/${projectId}/tasks`),
    );
    const createResponse = page.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().endsWith(`/api/projects/${projectId}/tasks`),
    );
    await page.getByRole("button", { name: "Create task" }).click();
    const req = await createRequest;
    expect(req.postDataJSON()).toMatchObject({ itopTicketRef: TICKET_REF });
    // The real backend stored it.
    expect(((await (await createResponse).json()) as { itopTicketRef: string }).itopTicketRef).toBe(TICKET_REF);
    await expect(title).toBeHidden();
  });

  test("Assign to me from the task panel fires the stimulus", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const task = await createTask(base, token, projectId, { title: `Assign ${stamp()}` });
    await pinRef(base, token, task.id);
    const state = { status: "new", minutes: 0 };
    const customerId = await projectCustomerId(base, token, projectId);
    await mockItop(page, state, customerId);

    let actionBody: { action: string } | null = null;
    await page.route(`**/api/itop/tickets/${TICKET_ID}/actions`, (route) => {
      actionBody = route.request().postDataJSON() as { action: string };
      state.status = "assigned";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...ticketRow("assigned", "QA Admin", customerId), publicLog: [], privateLog: [] }),
      });
    });

    await loginViaUi(page);
    const panel = await openTaskPanel(page, projectId, task.id);
    await expect(panel.getByText("New", { exact: true })).toBeVisible();

    const actionRequest = page.waitForRequest(
      (req) => req.url().includes(`/itop/tickets/${TICKET_ID}/actions`) && req.method() === "POST",
    );
    await panel.getByRole("button", { name: "Assign to me" }).click();
    await actionRequest;
    expect(actionBody).toMatchObject({ action: "assign_to_me" });

    // The by-ref chip refetches to the new status and the next actions appear.
    await expect(panel.getByText("Assigned", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Resolve" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Assign to me" })).toHaveCount(0);
  });

  test("the ticket timer starts and stops from the task panel", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const task = await createTask(base, token, projectId, { title: `Timer ${stamp()}` });
    await pinRef(base, token, task.id);
    const state = { status: "assigned", minutes: 0 };
    await mockItop(page, state, await projectCustomerId(base, token, projectId));

    let timeBody: { startedAt: string; endedAt: string } | null = null;
    await page.route(`**/api/itop/tickets/${TICKET_ID}/time`, (route) => {
      timeBody = route.request().postDataJSON() as { startedAt: string; endedAt: string };
      state.minutes = 90;
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          entry: {
            id: 1,
            startDate: timeBody.startedAt,
            endDate: timeBody.endedAt,
            durationMinutes: 2,
            title: null,
            ticketRef: TICKET_REF,
          },
        }),
      });
    });

    await loginViaUi(page);
    const panel = await openTaskPanel(page, projectId, task.id);
    await expect(panel.getByText("0.0 h this week on this ticket")).toBeVisible();
    await panel.getByRole("button", { name: "Start timer" }).click();
    const elapsed = panel.getByTestId("itop-timer-elapsed");
    await expect(elapsed).toBeVisible();

    // Past the backend's 1-minute floor without waiting a real minute.
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith("solvro.itopTimer."));
      if (!key) throw new Error("expected a stored iTop timer");
      const timer = JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>;
      timer.startedAt = new Date(Date.now() - 65_000).toISOString();
      const newValue = JSON.stringify(timer);
      localStorage.setItem(key, newValue);
      window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea: localStorage }));
    });

    const postRequest = page.waitForRequest(
      (req) => req.url().includes(`/itop/tickets/${TICKET_ID}/time`) && req.method() === "POST",
    );
    await panel.getByRole("button", { name: "Stop" }).click();
    await postRequest;
    expect(timeBody).not.toBeNull();
    await expect(panel.getByText("1.5 h this week on this ticket")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Start timer" })).toBeVisible();
  });

  test("Edit task modal keeps the pinned ref, clears it, and reverts a failed pin", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const customerId = await projectCustomerId(base, token, projectId);
    const title = `Edit pin ${stamp()}`;
    // Due long ago so it sorts to the top of the cross-project /tasks list.
    await createTask(base, token, projectId, {
      title,
      dueDate: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    });
    await mockItop(page, { status: "new", minutes: 0 }, customerId);
    // So "Create in iTop" would be offered whenever no ref is pinned.
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

    await loginViaUi(page);
    await page.goto("/tasks", { waitUntil: "networkidle" });
    await page.getByText(title).first().click();
    const drawer = page.getByRole("dialog", { name: "Edit task" });
    await expect(drawer).toBeVisible();

    const field = drawer.getByLabel("iTop ticket", { exact: true });
    await expect(drawer.getByRole("button", { name: "Create in iTop" })).toBeVisible();

    // Pin: the field shows the ref (not a fresh input) and no second create offer.
    await field.fill(TICKET_REF);
    await field.press("Enter");
    await expect(drawer.getByText(TICKET_REF, { exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Create in iTop" })).toHaveCount(0);
    await expect(drawer.getByLabel("iTop ticket", { exact: true })).toHaveCount(0);

    // Clear: back to an empty input.
    await drawer.getByRole("button", { name: `Clear iTop ticket ${TICKET_REF}` }).click();
    await expect(drawer.getByLabel("iTop ticket", { exact: true })).toHaveValue("");
    await expect(drawer.getByText(TICKET_REF, { exact: true })).toHaveCount(0);

    // A refused pin shows the error and reverts.
    await page.route("**/api/tasks/*", (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Ticket ref refused.", code: "bad_request" }),
      });
    });
    const again = drawer.getByLabel("iTop ticket", { exact: true });
    await again.fill(TICKET_REF);
    await again.press("Enter");
    await expect(drawer.getByText("Ticket ref refused.")).toBeVisible();
    await expect(drawer.getByLabel("iTop ticket", { exact: true })).toHaveValue("");
  });
});
