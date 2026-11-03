import type { Page } from "@playwright/test";
import { expect, apiBase, loginViaUi, test } from "../fixtures/test";
import { createTask } from "../fixtures/seed";

// Ticket column on the project List (tasks and subtasks) and its row menu
// (docs/archive/plans/subtask-itop-tickets.md). iTop is faked by intercepting the
// /api/itop/* reads; the PATCH that pins a ref hits the real backend. Needs
// `serviceWorkers: "block"` for the same reason as itop-task-ref.spec.ts.

const ITOP_BASE_URL = "https://itop.example.test";

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function ticketRow(ref: string, status: string) {
  return {
    id: 777,
    class: "UserRequest",
    ref,
    title: "Pinned ticket",
    status,
    operationalStatus: "ongoing",
    priority: "3",
    agentPersonId: null,
    agentName: null,
    teamName: null,
    serviceName: null,
    callerName: "Jane",
    startDate: new Date().toISOString(),
    lastUpdate: new Date().toISOString(),
    tto: null,
    ttr: null,
    slaTtoPassed: false,
    slaTtrPassed: false,
    resolutionDate: null,
    isMine: false,
  };
}

async function mockItop(page: Page, customerId: number, byRefs: Record<string, unknown>): Promise<void> {
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
  await page.route("**/api/itop/services", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route(`**/api/itop/customers/${customerId}/contacts`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: 42, name: "Jane Doe", email: "jane@fixture.test" }]),
    }),
  );
  await page.route("**/api/itop/tickets/by-refs*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(byRefs) }),
  );
}

async function projectCustomerId(base: string, token: string, projectId: number): Promise<number> {
  const res = await fetch(`${base}/api/projects/${projectId}?today=${new Date().toISOString().slice(0, 10)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as { customer: { id: number } | null };
  expect(body.customer, "the fixture project has a customer").not.toBeNull();
  return body.customer!.id;
}

test.describe("Project List iTop ticket column", () => {
  test.use({ serviceWorkers: "block" });

  test("shows a pinned subtask ref as a chip and pins an existing ref to the subtask", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const parent = await createTask(base, token, projectId, { title: `Parent ${stamp()}` });
    const pinned = await createTask(base, token, projectId, { title: `Pinned sub ${stamp()}`, parentTaskId: parent.id });
    const bare = await createTask(base, token, projectId, { title: `Bare sub ${stamp()}`, parentTaskId: parent.id });
    // Pin one subtask through the real API so the batched lookup has a ref to resolve.
    const pin = await fetch(`${base}/api/tasks/${pinned.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ itopTicketRef: "R-004512" }),
    });
    expect(pin.ok).toBe(true);

    const customerId = await projectCustomerId(base, token, projectId);
    await mockItop(page, customerId, { "R-004512": ticketRow("R-004512", "assigned") });
    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });

    // The column header is desktop-only chrome; on phone the chip sits in the row itself.
    if (testInfo.project.name === "desktop") {
      await expect(page.getByText("Ticket", { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "iTop ticket R-004512" })).toBeVisible();

    const patch = page.waitForRequest(
      (req) => req.method() === "PATCH" && req.url().includes(`/api/tasks/${bare.id}`),
    );
    await page.getByRole("button", { name: `Add iTop ticket to ${bare.title}` }).click();
    await page.getByRole("menuitem", { name: "Pin existing iTop ticket…" }).click();
    const dialog = page.getByRole("dialog", { name: "Pin an iTop ticket" });
    await dialog.getByPlaceholder("R-000000").fill("R-004600");
    await dialog.getByRole("button", { name: "Pin" }).click();
    expect((await patch).postDataJSON()).toMatchObject({ itopTicketRef: "R-004600" });
  });

  test("creates a ticket from a subtask row with the context line and pins it to that subtask", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const parent = await createTask(base, token, projectId, { title: `Parent ${stamp()}` });
    const sub = await createTask(base, token, projectId, { title: `Sub create ${stamp()}`, parentTaskId: parent.id });
    const customerId = await projectCustomerId(base, token, projectId);

    await mockItop(page, customerId, {});
    const createdRef = "R-009002";
    await page.route("**/api/itop/tickets", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ ...ticketRow(createdRef, "new"), id: 9002, publicLog: [], privateLog: [], myMinutesThisWeek: 0 }),
      });
    });
    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: `Add iTop ticket to ${sub.title}` }).click();
    await page.getByRole("menuitem", { name: "Create iTop ticket…" }).click();

    const sheet = page.getByRole("dialog", { name: "New ticket" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Created as QA Admin with your personal iTop token")).toBeVisible();
    await expect(sheet.locator("input[type='text']")).toHaveValue(sub.title);
    await expect(sheet.locator("textarea")).toHaveValue(new RegExp(`Solvro: .* › ${sub.title}$`));
    await sheet.locator("select").nth(1).selectOption("42");

    const patch = page.waitForRequest(
      (req) => req.method() === "PATCH" && req.url().includes(`/api/tasks/${sub.id}`),
    );
    await sheet.getByRole("button", { name: "Create in iTop" }).click();
    expect((await patch).postDataJSON()).toMatchObject({ itopTicketRef: createdRef });
  });
});
