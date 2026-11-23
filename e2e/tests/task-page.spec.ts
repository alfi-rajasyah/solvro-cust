import type { Page } from "@playwright/test";
import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { createTask } from "../fixtures/seed";

// The task page, /tasks/:id (docs/plans/task-page.md): the same body as the side
// panel in two columns from md. Covers the direct visit, a reload, the four ways
// in (panel button, /tasks row, Ctrl+K, copy link), the not-found state, saving
// from the page, the delete destinations and the phone layout.

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function fieldOf(base: string, token: string, taskId: number, field: string): Promise<unknown> {
  const res = await fetch(`${base}/api/tasks/${taskId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok, `GET /tasks/${taskId} → ${res.status}`).toBe(true);
  return ((await res.json()) as Record<string, unknown>)[field];
}

test.describe("task page", () => {
  test("a direct visit loads the task and survives a reload", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Page ${id}` });
    await loginViaUi(page);
    await page.goto(`/tasks/${task.id}`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { level: 1, name: `Page ${id}` })).toBeAttached();
    await expect(page.getByRole("button", { name: `Page ${id}`, exact: true })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Task fields" })).toBeVisible();
    await expect(page).toHaveTitle(`Page ${id} · Solvro`);
    // Top bar crumb: Tasks > project > task.
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    if (testInfo.project.name === "desktop") {
      await expect(crumbs.getByRole("link", { name: "Tasks", exact: true })).toBeVisible();
      await expect(crumbs.locator(`a[href="/projects/${projectId}"]`)).toBeVisible();
    }

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: `Page ${id}`, exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/tasks/${task.id}`);
  });

  test("a field saves from the page with the panel's rules", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Edit ${id}` });
    await loginViaUi(page);
    await page.goto(`/tasks/${task.id}`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: `Edit ${id}`, exact: true }).click();
    const input = page.locator('input[maxlength="200"]').first();
    await input.fill(`Renamed ${id}`);
    await input.press("Enter");
    await expect.poll(() => fieldOf(base, token, task.id, "title"), { timeout: 5_000 }).toBe(`Renamed ${id}`);
    // The crumb and the document title follow the optimistic rename.
    await expect(page).toHaveTitle(`Renamed ${id} · Solvro`);
  });

  test("a missing task shows one not-found state with a way back", async ({ page }) => {
    await loginViaUi(page);
    await page.goto("/tasks/999999999", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: "Task not found" })).toBeVisible();
    await page.getByRole("link", { name: "Back to Tasks" }).click();
    await expect(page).toHaveURL(/\/tasks$/);

    await page.goto("/tasks/not-a-number", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: "Task not found" })).toBeVisible();
  });

  test("a subtask row opens the subtask's page and the breadcrumb returns to the parent", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const parent = await createTask(base, token, projectId, { title: `Parent ${id}` });
    const child = await createTask(base, token, projectId, { title: `Child ${id}`, parentTaskId: parent.id });
    await loginViaUi(page);
    await page.goto(`/tasks/${parent.id}`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: `Child ${id}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${child.id}$`));
    await expect(page.getByRole("button", { name: `Parent ${id}`, exact: true })).toBeVisible();

    await page.getByRole("button", { name: `Parent ${id}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${parent.id}$`));
  });

  test("deleting a subtask goes to its parent's page; a top-level task goes to its List", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const parent = await createTask(base, token, projectId, { title: `Del parent ${id}` });
    const child = await createTask(base, token, projectId, { title: `Del child ${id}`, parentTaskId: parent.id });
    await loginViaUi(page);

    await page.goto(`/tasks/${child.id}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Task options" }).click();
    await page.getByRole("button", { name: /Delete task/ }).click();
    await page.getByRole("dialog", { name: "Delete task" }).getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${parent.id}$`));
    await expect(page.getByText("Task not found")).toHaveCount(0);

    await page.getByRole("button", { name: "Task options" }).click();
    await page.getByRole("button", { name: /Delete task/ }).click();
    await page.getByRole("dialog", { name: "Delete task" }).getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/list$`));
  });
});

test.describe("task page entry points", () => {
  test("the side panel's Open as page button goes to the page", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const task = await createTask(base, token, projectId, { title: `Panel ${stamp()}` });
    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/list?task=${task.id}`, { waitUntil: "networkidle" });
    const panel = page.getByRole("dialog", { name: "Task details" });
    await expect(panel).toBeVisible();
    await panel.getByRole("link", { name: "Open as page" }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
    await expect(page.getByRole("dialog", { name: "Task details" })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Task fields" })).toBeVisible();
  });

  test("a /tasks row opens the page", async ({ page, seededProject }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "The /tasks filter toolbar is exercised on desktop");
    const base = apiBase(testInfo);
    const { token, projectId, customerName } = seededProject;
    const title = `Row ${stamp()}`;
    const task = await createTask(base, token, projectId, { title });
    await loginViaUi(page);
    await page.goto("/tasks", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    await page.getByRole("option", { name: "Customer", exact: true }).hover();
    await page.getByRole("option", { name: customerName, exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByPlaceholder("Filter...")).toBeHidden();

    const row = page.locator("tr").filter({ has: page.getByText(title, { exact: true }) });
    // The title is a real link: keyboard users reach it with Tab and open it with Enter.
    await expect(row.getByRole("link", { name: title, exact: true })).toHaveAttribute("href", `/tasks/${task.id}`);
    // A click on the row's blank cells opens it too.
    await row.locator("td").last().click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
    await page.goBack();
    await expect(page).toHaveURL(/\/tasks(\?.*)?$/);
  });

  test("Ctrl+K: a task result opens the page", async ({ page, seededProject }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "The Ctrl+K entry point is desktop-only");
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const title = `PaletteTask ${stamp()}`;
    const task = await createTask(base, token, projectId, { title });
    await loginViaUi(page);
    await page.goto("/overview", { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: /open search/i })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: /global search/i });
    await dialog.getByPlaceholder(/search projects/i).fill(title);
    await dialog.getByText(title, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
  });

  test("Copy link in the panel and on the page copies the page URL", async ({
    page,
    context,
    seededProject,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "The clipboard check runs once, on desktop");
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const task = await createTask(base, token, projectId, { title: `Copy ${stamp()}` });
    const origin = new URL(testInfo.project.use.baseURL ?? "http://localhost:8080").origin;
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await loginViaUi(page);

    await page.goto(`/projects/${projectId}/list?task=${task.id}`, { waitUntil: "networkidle" });
    const panel = page.getByRole("dialog", { name: "Task details" });
    await panel.getByRole("button", { name: "Copy task link" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/tasks/${task.id}`);

    await page.goto(`/tasks/${task.id}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Copy task link" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/tasks/${task.id}`);
  });
});

async function box(page: Page, name: string | RegExp) {
  const b = await page.getByText(name, { exact: typeof name === "string" }).first().boundingBox();
  expect(b, `bounding box of ${String(name)}`).not.toBeNull();
  return b!;
}

test.describe("task page layout", () => {
  test("two columns from md, one column on a phone, in reading order", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Layout ${id}` });
    const described = await fetch(`${base}/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ description: `Words ${id}` }),
    });
    expect(described.ok).toBe(true);
    await createTask(base, token, projectId, { title: `Sub ${id}`, parentTaskId: task.id });
    await loginViaUi(page);
    await page.goto(`/tasks/${task.id}`, { waitUntil: "networkidle" });

    const aside = page.getByRole("complementary", { name: "Task fields" });
    await expect(aside).toBeVisible();
    const asideBox = (await aside.boundingBox())!;
    const titleBox = await box(page, `Layout ${id}`);
    const subtasksBox = await box(page, /^Subtasks/);

    if (testInfo.project.name === "desktop") {
      // Fields sit to the right of the title and level with it.
      expect(asideBox.x).toBeGreaterThan(titleBox.x + titleBox.width - 1);
      expect(asideBox.y).toBeLessThan(subtasksBox.y);
    } else {
      // One column: the fields follow the description and come before the subtasks.
      const descBox = await box(page, `Words ${id}`);
      expect(asideBox.y).toBeGreaterThan(descBox.y);
      expect(asideBox.y).toBeLessThan(subtasksBox.y);
      expect(Math.abs(asideBox.x - titleBox.x)).toBeLessThan(40);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }

    // DOM order matches reading order at this width: title, fields, subtasks.
    const order = await page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label="Task fields"]')!;
      const title = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Layout "))!;
      const subs = Array.from(document.querySelectorAll("p")).find((p) => p.textContent?.startsWith("Subtasks"))!;
      const f = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return [f(title, aside), f(aside, subs)];
    });
    expect(order).toEqual([true, true]);
  });
});
