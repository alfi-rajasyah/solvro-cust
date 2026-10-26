import { test, expect, loginViaUi, apiBase } from "../fixtures/test";
import { createTask, createEpic } from "../fixtures/seed";
import type { Page } from "@playwright/test";

// The "Add subtask" (TaskPanel) and "Add story" (EpicPanel) inputs await the
// create request. Pressing Enter twice while it is in flight must still create
// exactly one row. The create is held back with route interception so the
// second Enter lands while the first request is pending.
//
// Each test works in its own project: the seeded project is shared by every
// spec in the worker, and epics.spec.ts expects it to start with no epics.

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** A fresh project under the seeded customer, owned by the seeded admin. */
async function ownProject(base: string, seeded: { token: string; customerId: number; userId: number }): Promise<number> {
  const res = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { Authorization: `Bearer ${seeded.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: `Double submit ${stamp()}`, customerId: seeded.customerId, tamId: seeded.userId }),
  });
  expect(res.ok, `create project: ${res.status}`).toBeTruthy();
  return ((await res.json()) as { id: number }).id;
}

/** Delays every POST /api/projects/:id/tasks by 1.5s and counts how many were sent. */
async function holdTaskCreates(page: Page): Promise<{ count: () => number }> {
  let posts = 0;
  await page.route("**/api/projects/*/tasks", async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      await new Promise((r) => setTimeout(r, 1500));
    }
    await route.continue();
  });
  return { count: () => posts };
}

test.describe("Inline create inputs ignore a second Enter while pending", () => {
  test("Add subtask creates one subtask", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token } = seededProject;
    const projectId = await ownProject(base, seededProject);
    const parent = await createTask(base, token, projectId, { title: `DS parent ${stamp()}` });
    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/list?task=${parent.id}`, { waitUntil: "networkidle" });
    const panel = page.getByRole("dialog", { name: "Task details" });
    await expect(panel).toBeVisible();

    const posts = await holdTaskCreates(page);
    const title = `Sub ${stamp()}`;
    const input = panel.getByPlaceholder("Add subtask");
    await input.fill(title);
    await input.press("Enter");
    await input.press("Enter");

    await expect(panel.getByRole("button", { name: title, exact: true })).toHaveCount(1);
    await page.waitForTimeout(500);
    expect(posts.count()).toBe(1);
    await expect(panel.getByRole("button", { name: title, exact: true })).toHaveCount(1);
  });

  test("Add story creates one story", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token } = seededProject;
    const projectId = await ownProject(base, seededProject);
    const epic = await createEpic(base, token, projectId, { title: `DS epic ${stamp()}` });
    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/epics?epic=${epic.id}`, { waitUntil: "networkidle" });
    const panel = page.getByRole("dialog", { name: "Epic details" });
    await expect(panel).toBeVisible();

    const posts = await holdTaskCreates(page);
    const title = `Story ${stamp()}`;
    const input = panel.getByLabel("Add story");
    await input.fill(title);
    await input.press("Enter");
    await input.press("Enter");

    await expect(panel.getByText(title, { exact: true })).toHaveCount(1);
    await page.waitForTimeout(500);
    expect(posts.count()).toBe(1);
    await expect(panel.getByText(title, { exact: true })).toHaveCount(1);
  });
});
