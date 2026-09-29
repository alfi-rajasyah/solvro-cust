import type { Page } from "@playwright/test";
import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { createTask, isoDateOffset } from "../fixtures/seed";

// Tasks page saved views (pages/Tasks.tsx): the default "All open" view hides
// Done rows, and ?view=overdue lists only overdue work. `/tasks` is windowed to
// 200 rows globally, so each test scopes the page to the fixture's customer
// through the Filters chip first (same flow as kanban-dnd.spec.ts).

async function scopeToCustomer(page: Page, customerName: string): Promise<void> {
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("option", { name: "Customer", exact: true }).hover();
  await page.getByRole("option", { name: customerName, exact: true }).click();
  await page.keyboard.press("Escape");
}

function taskRow(page: Page, projectId: number, title: string) {
  return page
    .locator("tr")
    .filter({ has: page.locator(`a[href="/projects/${projectId}"]`) })
    .filter({ has: page.getByText(title, { exact: true }) });
}

test.describe("Tasks saved views (desktop)", () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== "desktop", "Filter toolbar is exercised on desktop");
  });

  test("default view shows no Done rows; All shows them", async ({ page, seededProject }) => {
    const base = apiBase(test.info());
    const stamp = Date.now().toString(36);
    const doneTitle = `Views done ${stamp}`;
    const openTitle = `Views open ${stamp}`;
    await createTask(base, seededProject.token, seededProject.projectId, {
      title: doneTitle,
      status: "DONE",
      dueDate: isoDateOffset(3),
    });
    await createTask(base, seededProject.token, seededProject.projectId, {
      title: openTitle,
      status: "TODO",
      dueDate: isoDateOffset(3),
    });

    await loginViaUi(page);
    await page.goto("/tasks", { waitUntil: "networkidle" });
    await scopeToCustomer(page, seededProject.customerName);

    await expect(taskRow(page, seededProject.projectId, openTitle)).toHaveCount(1);
    await expect(taskRow(page, seededProject.projectId, doneTitle)).toHaveCount(0);

    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page).toHaveURL(/[?&]view=all\b/);
    await expect(taskRow(page, seededProject.projectId, doneTitle)).toHaveCount(1);
  });

  test("?view=overdue shows only overdue rows", async ({ page, seededProject }) => {
    const base = apiBase(test.info());
    const stamp = Date.now().toString(36);
    const overdueTitle = `Views overdue ${stamp}`;
    const doneLateTitle = `Views done late ${stamp}`;
    const futureTitle = `Views future ${stamp}`;
    await createTask(base, seededProject.token, seededProject.projectId, {
      title: overdueTitle,
      status: "TODO",
      dueDate: isoDateOffset(-3),
    });
    await createTask(base, seededProject.token, seededProject.projectId, {
      title: doneLateTitle,
      status: "DONE",
      dueDate: isoDateOffset(-3),
    });
    await createTask(base, seededProject.token, seededProject.projectId, {
      title: futureTitle,
      status: "TODO",
      dueDate: isoDateOffset(5),
    });

    await loginViaUi(page);
    await page.goto("/tasks?view=overdue", { waitUntil: "networkidle" });
    await scopeToCustomer(page, seededProject.customerName);

    await expect(taskRow(page, seededProject.projectId, overdueTitle)).toHaveCount(1);
    await expect(taskRow(page, seededProject.projectId, doneLateTitle)).toHaveCount(0);
    await expect(taskRow(page, seededProject.projectId, futureTitle)).toHaveCount(0);
    // Fixture tasks dated today or later are not overdue either.
    await expect(taskRow(page, seededProject.projectId, "Alpha")).toHaveCount(0);
  });
});
