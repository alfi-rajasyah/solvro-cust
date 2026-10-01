import { test, expect, loginViaUi, apiBase } from "../fixtures/test";
import { createEpic, createTask, getTasks } from "../fixtures/seed";
import type { Locator, Page } from "@playwright/test";

// Coverage for T4 (docs/archive/plans/epics-spec.md §6 "Task surfaces", §7 T4): the
// Epic select in TaskPanel and TaskFormModal. Every test seeds its own
// task(s) and epic via the API — same convention as subtask-edit.spec.ts —
// rather than mutating the shared seededProject fixture, so tests stay
// order-independent inside the one shared per-worker project.

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function openTaskPanel(page: Page, projectId: number, taskId: number): Promise<Locator> {
  await page.goto(`/projects/${projectId}/list?task=${taskId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const panel = page.getByRole("dialog", { name: "Task details" });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("Epic select in TaskPanel", () => {
  test("setting an epic on a top-level task shows the chip and it survives reload", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Epic target ${id}` });
    const epic = await createEpic(base, token, projectId, { title: `Epic ${id}` });
    await loginViaUi(page);

    const panel = await openTaskPanel(page, projectId, task.id);
    await panel.getByRole("button", { name: "No epic", exact: true }).click();
    // Both the outer and the `has` locator anchor at `page` (not `panel`) —
    // mirrors kanban-dnd.spec.ts's `prioritySelect` pattern; nesting a
    // `has` locator built off a DIFFERENT scoped root than the outer
    // locator resolves to zero matches.
    const select = page.locator("select").filter({ has: page.getByRole("option", { name: "No epic" }) });
    await expect(select).toBeVisible();
    await select.selectOption({ label: epic.title });

    const chip = panel.getByTestId("epic-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-epic-id", String(epic.id));
    await expect(chip).toHaveText(epic.title);

    // Survives reload — the epicId round-tripped through the API, not just
    // an optimistic cache write.
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const reloadedPanel = page.getByRole("dialog", { name: "Task details" });
    await expect(reloadedPanel).toBeVisible();
    const reloadedChip = reloadedPanel.getByTestId("epic-chip");
    await expect(reloadedChip).toBeVisible();
    await expect(reloadedChip).toHaveAttribute("data-epic-id", String(epic.id));

    const tasksAfter = await getTasks(base, token, projectId);
    expect(tasksAfter.find((t) => t.id === task.id)?.epicId).toBe(epic.id);
  });

  test("the epic select is absent on a subtask", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const parent = await createTask(base, token, projectId, { title: `Parent ${id}` });
    const child = await createTask(base, token, projectId, {
      title: `Child ${id}`,
      parentTaskId: parent.id,
    });
    await loginViaUi(page);

    const panel = await openTaskPanel(page, projectId, child.id);
    // The Epic field's uppercase label span reads "Epic" exactly — hidden
    // entirely on a subtask (§4: epicId is only ever set on a top-level
    // task).
    await expect(panel.getByText("Epic", { exact: true })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "No epic", exact: true })).toHaveCount(0);
  });

  test("the parent's epic chip shows in the subtask breadcrumb", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const epic = await createEpic(base, token, projectId, { title: `Breadcrumb epic ${id}` });
    const parent = await createTask(base, token, projectId, { title: `Parent ${id}` });
    const child = await createTask(base, token, projectId, {
      title: `Child ${id}`,
      parentTaskId: parent.id,
    });
    // Set the parent's epic via the API — this test is about the breadcrumb
    // rendering it, not about setting it.
    await fetch(`${base}/api/tasks/${parent.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ epicId: epic.id }),
    });
    await loginViaUi(page);

    const panel = await openTaskPanel(page, projectId, child.id);
    await expect(panel.getByRole("button", { name: parent.title, exact: true })).toBeVisible();
    const chip = panel.getByTestId("epic-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-epic-id", String(epic.id));
    await expect(chip).toHaveText(epic.title);
  });
});

test.describe("Epic select in TaskFormModal — desktop", () => {
  test.beforeEach(async () => {
    test.skip(
      test.info().project.name !== "desktop",
      "List-view add-task flow is exercised on desktop",
    );
  });

  test("creating a task via the modal with an epic selected carries the chip", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const epic = await createEpic(base, token, projectId, { title: `Modal epic ${id}` });
    const draftTitle = `Modal task ${id}`;

    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Add task$/ }).click();

    const title = page.getByPlaceholder("Task title");
    await expect(title).toBeVisible();
    await title.fill(draftTitle);

    const epicSelect = page
      .locator("select")
      .filter({ has: page.getByRole("option", { name: "No epic" }) });
    await epicSelect.selectOption({ label: epic.title });
    // Scoped to the drawer, not `page`: ProjectList stays mounted behind the
    // drawer and renders each tagged task's EpicChip twice (desktop row +
    // `md:hidden` mobile card), and the worker-scoped seededProject can
    // already carry epics from earlier tests in this file/worker — a
    // page-scoped getByTestId("epic-chip") throws in strict mode once any of
    // that is present. The Drawer exposes role="dialog" + aria-label = its
    // title ("New task" in create mode) — see Drawer.tsx / TaskFormModal.tsx.
    const drawer = page.getByRole("dialog", { name: "New task" });
    await expect(drawer.getByTestId("epic-chip")).toHaveText(epic.title);

    await page.getByRole("button", { name: "Create task" }).click();
    await expect(title).toBeHidden();

    const tasksAfter = await getTasks(base, token, projectId);
    const created = tasksAfter.find((t) => t.title === draftTitle);
    expect(created).toBeTruthy();
    expect(created?.epicId).toBe(epic.id);

    // The chip renders back out of the panel too, not just the API response.
    const panel = await openTaskPanel(page, projectId, created!.id);
    const chip = panel.getByTestId("epic-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-epic-id", String(epic.id));
  });
});
