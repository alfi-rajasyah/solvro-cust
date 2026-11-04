import { test, expect, loginViaUi, apiBase } from "../fixtures/test";
import { createTask, getTasks } from "../fixtures/seed";
import type { Page } from "@playwright/test";

// Subtask rows in the project List and in the task panel show and change the
// subtask's assignee, and the panel's quick-add can assign as it creates.
// Each test seeds its own parent + subtask so tests stay order-independent.

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function seedPair(base: string, token: string, projectId: number) {
  const id = stamp();
  const parent = await createTask(base, token, projectId, { title: `Parent ${id}` });
  const child = await createTask(base, token, projectId, { title: `Child ${id}`, parentTaskId: parent.id });
  return { parent, child };
}

async function assigneeOf(base: string, token: string, projectId: number, taskId: number) {
  const tasks = await getTasks(base, token, projectId);
  return tasks.find((t) => t.id === taskId)?.assignedToId ?? null;
}

async function adminUsername(base: string, token: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as { username?: string; user?: { username: string } };
  return (body.user ?? body).username as string;
}

async function openTaskPanel(page: Page, projectId: number, taskId: number) {
  await page.goto(`/projects/${projectId}/list?task=${taskId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const panel = page.getByRole("dialog", { name: "Task details" });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("Subtask assignee", () => {
  test("assigns a subtask from its List row and persists after reload", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId, userId } = seededProject;
    const { child } = await seedPair(base, token, projectId);
    const username = await adminUsername(base, token);
    await loginViaUi(page);

    await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
    const row = page.locator("div.md\\:grid", { hasText: child.title }).first();
    await row.getByRole("button", { name: "Change assignee" }).click();
    await page.getByRole("button", { name: username, exact: false }).last().click();

    await expect.poll(() => assigneeOf(base, token, projectId, child.id), { timeout: 5_000 }).toBe(userId);
    // Picking must not open the panel.
    expect(new URL(page.url()).searchParams.get("task")).toBeNull();

    await page.reload({ waitUntil: "networkidle" });
    const again = page.locator("div.md\\:grid", { hasText: child.title }).first();
    await expect(again.getByRole("button", { name: "Change assignee" })).toContainText(/\S/);
  });

  test("assigns a subtask from the panel's subtask list", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId, userId } = seededProject;
    const { parent, child } = await seedPair(base, token, projectId);
    await loginViaUi(page);

    const panel = await openTaskPanel(page, projectId, parent.id);
    await panel.getByRole("button", { name: `Assignee for ${child.title}`, exact: true }).click();
    await panel.getByLabel(`Assignee for ${child.title}`).selectOption(String(userId));

    await expect.poll(() => assigneeOf(base, token, projectId, child.id), { timeout: 5_000 }).toBe(userId);
    // The panel stays on the parent.
    expect(new URL(page.url()).searchParams.get("task")).toBe(String(parent.id));
  });

  test("quick-add creates the subtask already assigned", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId, userId } = seededProject;
    const { parent } = await seedPair(base, token, projectId);
    await loginViaUi(page);

    const panel = await openTaskPanel(page, projectId, parent.id);
    await panel.getByRole("button", { name: "Assignee for new subtask", exact: true }).click();
    await panel.getByLabel("Assignee for new subtask").selectOption(String(userId));

    const title = `Quick ${stamp()}`;
    const input = panel.getByPlaceholder("Add subtask");
    await input.fill(title);
    await input.press("Enter");

    await expect
      .poll(async () => (await getTasks(base, token, projectId)).find((t) => t.title === title)?.assignedToId ?? null, {
        timeout: 5_000,
      })
      .toBe(userId);
  });
});
