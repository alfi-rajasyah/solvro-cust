import { test, expect, loginViaUi, apiBase, captureTaskRequests } from "../fixtures/test";
import { createTask, getTasks } from "../fixtures/seed";
import type { Locator, Page } from "@playwright/test";

// Coverage for the editable-subtask affordances in TaskPanel. Before these,
// the panel's subtask rows could only be toggled done, reordered, and
// appended to — the title was static text, so a subtask created here could
// never be renamed, retargeted, or deleted from the same surface.
//
// Every test seeds its own parent + subtask via the API (same convention as
// date-picker.spec.ts / gantt-parity.spec.ts) rather than mutating the shared
// seededProject's alpha/subA/subB, so tests stay order-independent inside the
// one shared per-worker project (fixtures/test.ts).

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

/** Seeds a parent task with one subtask, both uniquely titled. */
async function seedPair(base: string, token: string, projectId: number) {
  const id = stamp();
  const parent = await createTask(base, token, projectId, { title: `Parent ${id}` });
  const child = await createTask(base, token, projectId, {
    title: `Child ${id}`,
    parentTaskId: parent.id,
  });
  return { parent, child };
}

async function titleOf(
  base: string,
  token: string,
  projectId: number,
  taskId: number,
): Promise<string | undefined> {
  const tasks = await getTasks(base, token, projectId);
  return tasks.find((t) => t.id === taskId)?.title;
}

test.describe("TaskPanel subtask editing", () => {
  test("renames a subtask inline from the parent panel", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const { parent, child } = await seedPair(base, token, projectId);
    await loginViaUi(page);

    const panel = await openTaskPanel(page, projectId, parent.id);
    // The pencil is hover-revealed on desktop (`md:opacity-0`), so model the
    // real gesture rather than relying on Playwright treating opacity-0 as
    // visible — this is what would catch the affordance becoming unreachable.
    const row = panel.getByRole("button", { name: child.title, exact: true });
    await row.hover();
    await panel.getByRole("button", { name: `Rename ${child.title}`, exact: true }).click();

    const input = panel.getByLabel("Subtask title");
    await expect(input).toBeVisible();
    const renamed = `${child.title} renamed`;
    await input.fill(renamed);
    await input.press("Enter");

    await expect
      .poll(() => titleOf(base, token, projectId, child.id), { timeout: 5_000 })
      .toBe(renamed);
    // The panel still shows the PARENT — an inline rename must not retarget it.
    await expect(panel.getByRole("button", { name: renamed, exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("task")).toBe(String(parent.id));
  });

  test("Escape cancels the rename and leaves the panel open", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const { parent, child } = await seedPair(base, token, projectId);
    await loginViaUi(page);

    const panel = await openTaskPanel(page, projectId, parent.id);
    await panel.getByRole("button", { name: child.title, exact: true }).hover();
    await panel.getByRole("button", { name: `Rename ${child.title}`, exact: true }).click();

    const input = panel.getByLabel("Subtask title");
    await input.fill("discard me");

    // Two regressions guarded at once: Escape must not bubble to the panel's
    // document-level keydown (which closes the whole panel), and unmounting
    // the focused input must not let its onBlur commit the abandoned draft.
    const requests = await captureTaskRequests(page, async () => {
      await input.press("Escape");
    });
    const patches = requests.filter((r) => r.method === "PATCH");
    expect(patches, `expected no PATCH on cancel, got ${JSON.stringify(patches)}`).toHaveLength(0);

    await expect(panel).toBeVisible();
    expect(await titleOf(base, token, projectId, child.id)).toBe(child.title);
  });

  test("a cancelled rename does not swallow the next one", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const { parent, child } = await seedPair(base, token, projectId);
    await loginViaUi(page);

    const panel = await openTaskPanel(page, projectId, parent.id);
    const rename = panel.getByRole("button", { name: `Rename ${child.title}`, exact: true });

    // Cancel one edit…
    await panel.getByRole("button", { name: child.title, exact: true }).hover();
    await rename.click();
    await panel.getByLabel("Subtask title").fill("discarded");
    await panel.getByLabel("Subtask title").press("Escape");
    await page.waitForTimeout(400);

    // …then edit again. A cancel flag that outlives its own edit session eats
    // this second rename silently — no error, title just reverts.
    await panel.getByRole("button", { name: child.title, exact: true }).hover();
    await rename.click();
    const renamed = `${child.title} second`;
    await panel.getByLabel("Subtask title").fill(renamed);
    await panel.getByLabel("Subtask title").press("Enter");

    await expect
      .poll(() => titleOf(base, token, projectId, child.id), { timeout: 5_000 })
      .toBe(renamed);
  });

  test("deleting a subtask returns to its parent", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const { parent, child } = await seedPair(base, token, projectId);
    await loginViaUi(page);

    const subPanel = await openTaskPanel(page, projectId, child.id);
    await subPanel.getByRole("button", { name: "Task options" }).click();
    await subPanel.getByRole("button", { name: "Delete task" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.waitForTimeout(900);

    // The panel stays open on the parent rather than closing outright.
    expect(new URL(page.url()).searchParams.get("task")).toBe(String(parent.id));
    await expect(page.getByRole("dialog", { name: "Task details" })).toBeVisible();
    const titles = (await getTasks(base, token, projectId)).map((t) => t.title);
    expect(titles).not.toContain(child.title);
  });

  test("opens a subtask and returns via the parent breadcrumb", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const { parent, child } = await seedPair(base, token, projectId);
    await loginViaUi(page);

    const panel = await openTaskPanel(page, projectId, parent.id);
    await panel.getByRole("button", { name: child.title, exact: true }).click();
    await page.waitForTimeout(600);

    expect(new URL(page.url()).searchParams.get("task")).toBe(String(child.id));
    const subPanel = page.getByRole("dialog", { name: "Task details" });
    // Fields that were unreachable before: the subtask's own meta grid.
    await expect(subPanel.getByText("Assignee", { exact: true })).toBeVisible();

    await subPanel.getByRole("button", { name: parent.title, exact: true }).click();
    await page.waitForTimeout(600);
    expect(new URL(page.url()).searchParams.get("task")).toBe(String(parent.id));
  });

  test("offers no Add-subtask form on a subtask (max depth is 1)", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const { parent, child } = await seedPair(base, token, projectId);
    await loginViaUi(page);

    const parentPanel = await openTaskPanel(page, projectId, parent.id);
    await expect(parentPanel.getByPlaceholder("Add subtask")).toHaveCount(1);

    const subPanel = await openTaskPanel(page, projectId, child.id);
    // Offering it here would fire a create the backend rejects with
    // max_depth_exceeded (backend/src/lib/taskOrdering.ts's assertValidParent).
    await expect(subPanel.getByPlaceholder("Add subtask")).toHaveCount(0);
  });
});
