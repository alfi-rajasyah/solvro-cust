import type { Page } from "@playwright/test";
import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { createTask } from "../fixtures/seed";

// Focus around the Gantt row menu. A dialog opened from a menu item must keep
// the focus it takes, and closing it (or the menu) must hand focus back to the
// row's Task actions button, never <body>. Desktop only: the Gantt is.

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function expectFocusOnAControl(page: Page) {
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? "none")).not.toMatch(/^(BODY|none)$/);
}

test.describe("gantt row menu focus (desktop)", () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== "desktop", "The Gantt is desktop-only");
  });

  async function setup(page: Page, seededProject: { token: string; projectId: number }, testInfo: Parameters<typeof apiBase>[0]) {
    const title = `Focus ${stamp()}`;
    const task = await createTask(apiBase(testInfo), seededProject.token, seededProject.projectId, { title });
    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}/gantt`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const row = page.locator(`[data-slot="gantt-row-group"][data-gantt-row-id="task-${task.id}"]`);
    await expect(row).toBeVisible();
    return { title, task, row, actions: row.getByRole("button", { name: "Task actions" }) };
  }

  test("Add subtask: the new task's title input holds focus; closing returns to the row", async ({ page, seededProject }, testInfo) => {
    const { row } = await setup(page, seededProject, testInfo);
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Add subtask" }).click();
    const input = page.getByPlaceholder("Task title");
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
    // Opened by right-click, so the menu's trigger is the row: focus goes back to a row control, not <body>.
    await expectFocusOnAControl(page);
  });

  test("Delete: the confirm's Cancel holds focus; Cancel returns to the row", async ({ page, seededProject }, testInfo) => {
    const { row } = await setup(page, seededProject, testInfo);
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete task" });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expectFocusOnAControl(page);
  });

  test("Delete opened from the Task actions button: Cancel returns to that button", async ({ page, seededProject }, testInfo) => {
    const { row, actions } = await setup(page, seededProject, testInfo);
    await row.hover();
    await actions.click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete task" });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(actions).toBeFocused();
  });

  test("Edit opened from the Task actions button: Escape returns to that button", async ({ page, seededProject }, testInfo) => {
    const { title, row, actions } = await setup(page, seededProject, testInfo);
    await row.hover();
    await actions.click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const input = page.getByPlaceholder("Task title");
    await expect(input).toHaveValue(title);
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(actions).toBeFocused();
  });

  test("keyboard: Task actions opens the menu and Escape returns focus to it", async ({ page, seededProject }, testInfo) => {
    const { actions } = await setup(page, seededProject, testInfo);
    await actions.focus();
    await expect(actions).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-slot="gantt-resource-menu"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-slot="gantt-resource-menu"]')).toHaveCount(0);
    await expect(actions).toBeFocused();
  });
});
