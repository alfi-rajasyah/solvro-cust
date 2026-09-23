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
