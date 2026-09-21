import { test, expect, loginViaUi, apiBase } from "../fixtures/test";
import { createTask, createSection, isoDateOffset } from "../fixtures/seed";
import type { Locator, Page } from "@playwright/test";

// Coverage for docs/plans/duplicate-tasks-sections.md's four v1 surfaces
// (§3 Decision 12): the Task panel's "Duplicate task" menu item, a
// subtask row's "Duplicate <title>" button, the Gantt row context menu's
// "Duplicate" item, and the List view section header's "Duplicate section"
// button. Each test seeds its own uniquely-titled task(s)/section via the
// API (same convention as subtask-edit.spec.ts / gantt-parity.spec.ts)
// rather than mutating the shared seededProject's alpha/beta/gamma/delta,
// so tests stay order-independent inside the one shared per-worker project.

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

/**
 * Locates the List view row rendering `title` — TaskRow mounts BOTH a
 * desktop grid row (`hidden ... md:grid`) and a mobile card (`... md:hidden`)
 * for every task regardless of the active viewport (only CSS display
 * differs), so a bare title-text locator double-counts. Pick the variant
 * that's actually rendered for the running project (mirrors list-dnd.spec.ts's
 * `desktopRow` helper, extended to the mobile card for this file's
 * desktop+mobile tests). The column-header row also carries "grid-cols-" but
 * never matches a task title, same reasoning list-dnd.spec.ts documents.
 */
function rowLocator(page: Page, title: string): Locator {
  const selector =
    test.info().project.name === "desktop"
      ? 'div[class*="grid-cols-"]'
      : 'div[class*="md:hidden"]';
  return page.locator(selector, { hasText: title });
}

test.describe("Duplicate — Task panel, subtask row, section header (desktop + mobile)", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page);
  });

  test("Task panel: Duplicate task retargets the panel at a new id and lists two rows", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const title = `DupTask ${stamp()}`;
    const task = await createTask(base, token, projectId, { title });

    const panel = await openTaskPanel(page, projectId, task.id);
    await panel.getByRole("button", { name: "Task options" }).click();
    await panel.getByRole("button", { name: "Duplicate task", exact: true }).click();
    await page.waitForTimeout(900);

    const newTaskId = new URL(page.url()).searchParams.get("task");
    expect(newTaskId).not.toBeNull();
    expect(newTaskId).not.toBe(String(task.id));

    const newPanel = page.getByRole("dialog", { name: "Task details" });
    await expect(newPanel).toBeVisible();
    await expect(newPanel.getByRole("button", { name: title, exact: true })).toBeVisible();

    await expect(rowLocator(page, title)).toHaveCount(2);
  });

  test("Task panel: a subtask's Duplicate button adds a second subtask row with the same title", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();
    const parent = await createTask(base, token, projectId, { title: `DupParent ${s}` });
    const child = await createTask(base, token, projectId, {
      title: `DupChild ${s}`,
      parentTaskId: parent.id,
    });

    const panel = await openTaskPanel(page, projectId, parent.id);
    // The button is hover-revealed on desktop (`md:opacity-0`) — model the
    // real gesture rather than relying on Playwright treating opacity-0 as
    // visible (same reasoning subtask-edit.spec.ts's rename tests document).
    await panel.getByRole("button", { name: child.title, exact: true }).hover();
    await panel.getByRole("button", { name: `Duplicate ${child.title}`, exact: true }).click();
    await page.waitForTimeout(900);

    await expect(panel.getByRole("button", { name: child.title, exact: true })).toHaveCount(2);
  });

  test("Section: Duplicate section adds a second group directly below with the same task count", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();
    const sectionName = `DupSection ${s}`;
    const section = await createSection(base, token, projectId, { name: sectionName });
    await createTask(base, token, projectId, { title: `DupSecA ${s}`, sectionId: section.id });
    await createTask(base, token, projectId, { title: `DupSecB ${s}`, sectionId: section.id });

    await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // The "No section" pseudo-group is not a real Section row — it must
    // never offer a Duplicate button (ProjectList.tsx gates the button on
    // `section` being non-null).
    const noneRow = page
      .getByRole("heading", { level: 3, name: "No section", exact: true })
      .locator("xpath=..");
    await expect(noneRow.getByRole("button", { name: "Duplicate section", exact: true })).toHaveCount(
      0,
    );

    const headings = page.getByRole("heading", { level: 3, name: sectionName, exact: true });
    await expect(headings).toHaveCount(1);

    // Scope the click to THIS section's own header row — every section
    // header on the page carries a "Duplicate section" button.
    const sourceRow = headings.first().locator("xpath=..");
    await sourceRow.getByRole("button", { name: "Duplicate section", exact: true }).click();
    await page.waitForTimeout(900);

    await expect(headings).toHaveCount(2);

    // "Directly below the source" (§3 Decision 10: position = source + 1) —
    // the very next h3 in document order is the copy, with nothing else
    // (e.g. another section, or the "No section" pseudo-group) between them.
    const allHeadingTexts = await page.getByRole("heading", { level: 3 }).allTextContents();
    const idx = allHeadingTexts.indexOf(sectionName);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(allHeadingTexts[idx + 1]).toBe(sectionName);

    // Count pill: `font-mono` is unique to it within the header row — the
    // section-color dot also carries `rounded-full` in its own class list.
    const countPill = (heading: Locator) =>
      heading.locator("xpath=..").locator('span[class*="font-mono"]');
    await expect(countPill(headings.nth(0))).toHaveText("2");
    await expect(countPill(headings.nth(1))).toHaveText("2");
  });
});

test.describe("Duplicate — Gantt row context menu (desktop)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "Gantt is desktop-only (hidden md:block)");
    await loginViaUi(page);
  });

  test("Gantt row context menu: Duplicate adds a second tree row with the same title", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const title = `DupGantt ${stamp()}`;
    const task = await createTask(base, token, projectId, {
      title,
      status: "TODO",
      startDate: isoDateOffset(0),
      dueDate: isoDateOffset(3),
    });

    await page.goto(`/projects/${projectId}/gantt`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const taskRow = page.locator(
      `[data-slot="gantt-row-group"][data-gantt-row-id="task-${task.id}"]`,
    );
    await expect(taskRow).toBeVisible();
    await taskRow.click({ button: "right" });
    const duplicateItem = page.getByRole("menuitem", { name: "Duplicate", exact: true });
    await expect(duplicateItem).toBeVisible();
    await duplicateItem.click();
    await page.waitForTimeout(900);

    const treePane = page.locator('[data-slot="gantt-tree-pane"]');
    await expect(treePane.getByText(title, { exact: true })).toHaveCount(2);
  });
});
