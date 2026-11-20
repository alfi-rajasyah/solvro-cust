import type { Page } from "@playwright/test";
import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { getTasks } from "../fixtures/seed";

// List bulk edit (docs/archive/plans/list-bulk-edit.md): row checkboxes,
// select-all-visible, and the bulk action bar calling POST /tasks/bulk.

async function openList(page: Page, projectId: number): Promise<void> {
  await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
}

async function createLabel(base: string, token: string, projectId: number, name: string) {
  const res = await fetch(`${base}/api/projects/${projectId}/labels`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, color: "#0058be" }),
  });
  if (!res.ok) throw new Error(`POST labels failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: number; name: string };
}

test.describe("list bulk edit", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page);
  });

  test("select all visible shows the count and clears again", async ({ page, seededProject }) => {
    await openList(page, seededProject.projectId);
    const selectAll = page.getByRole("checkbox", { name: "Select all visible tasks" });
    await selectAll.first().click();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toBeVisible();
    await expect(page.getByText(/^\d+ selected$/)).toBeVisible();
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
  });

  test("a row checkbox does not open the task panel", async ({ page, seededProject }) => {
    await openList(page, seededProject.projectId);
    await page.getByRole("checkbox", { name: "Select Alpha" }).click();
    await expect(page).not.toHaveURL(/task=/);
    await expect(page.getByText("1 selected")).toBeVisible();
  });

  test("adds a label to two tasks in one request and clears the selection", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const label = await createLabel(base, seededProject.token, seededProject.projectId, `bulk-${Date.now()}`);
    await openList(page, seededProject.projectId);

    await page.getByRole("checkbox", { name: "Select Alpha" }).click();
    await page.getByRole("checkbox", { name: "Select Beta" }).click();
    await page.getByRole("button", { name: "Add label" }).click();
    await page.getByRole("button", { name: label.name }).click();
    await page.getByRole("button", { name: "Add to 2 tasks" }).click();

    await expect(page.getByText("Updated 2 tasks.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);

    const tasks = (await getTasks(base, seededProject.token, seededProject.projectId)) as Array<{
      title: string;
      labels?: { id: number }[];
    }>;
    const labelled = tasks.filter((t) => t.labels?.some((l) => l.id === label.id)).map((t) => t.title);
    expect(labelled.sort()).toEqual(["Alpha", "Beta"]);
  });

  test("Set epic is disabled with a reason when a subtask is selected", async ({ page, seededProject }) => {
    await openList(page, seededProject.projectId);
    const sub = page.getByRole("checkbox", { name: /^Select subtask / }).first();
    await sub.click();
    await expect(page.getByRole("button", { name: "Set epic" })).toBeDisabled();
    await expect(page.getByText(/Epics apply to top-level tasks only/)).toBeVisible();
  });
});

test.describe("list bulk edit on phone", () => {
  test("tapping the Select all visible text toggles the box", async ({ page, seededProject }) => {
    test.skip(test.info().project.name !== "mobile", "the label row is phone-only");
    await loginViaUi(page);
    await openList(page, seededProject.projectId);
    await page.getByText("Select all visible", { exact: true }).click();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toBeVisible();
  });

  test("collapsing a subtask list leaves its subtasks out of select all", async ({ page, seededProject }) => {
    await loginViaUi(page);
    await openList(page, seededProject.projectId);
    await page.getByRole("button", { name: "Collapse subtasks" }).first().click();
    await page.getByRole("checkbox", { name: "Select all visible tasks" }).first().click();
    const total = await page.getByText(/^\d+ selected$/).textContent();
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("button", { name: "Expand subtasks" }).first().click();
    await page.getByRole("checkbox", { name: "Select all visible tasks" }).first().click();
    const expandedTotal = await page.getByText(/^\d+ selected$/).textContent();
    expect(Number(expandedTotal!.split(" ")[0])).toBeGreaterThan(Number(total!.split(" ")[0]));
  });
});
