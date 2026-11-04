import { type Page } from "@playwright/test";
import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { getTasks, login } from "../fixtures/seed";

// Admin → Task statuses (docs/archive/plans/custom-task-statuses.md §3 B1).
// The status list is workspace-wide, so this spec edits shared state: it puts
// the three default statuses back before and after (a run that died midway
// must not leave other specs facing "Backlog" / "QA / UAT").

interface Def {
  id: number;
  name: string;
  category: "TODO" | "IN_PROGRESS" | "DONE";
  color: string;
  isDefault: boolean;
  taskCount: number;
}

const DEFAULTS = [
  { name: "To do", category: "TODO", color: "gray" },
  { name: "In progress", category: "IN_PROGRESS", color: "primary" },
  { name: "Done", category: "DONE", color: "emerald" },
] as const;

async function listDefs(base: string, token: string): Promise<Def[]> {
  const res = await fetch(`${base}/api/admin/task-statuses`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET task-statuses ${res.status}`);
  return res.json() as Promise<Def[]>;
}

/** Back to To do / In progress / Done: each category's default is renamed into place, the rest moves onto it. */
async function restoreDefaults(base: string, token: string): Promise<void> {
  const defs = await listDefs(base, token);
  const keep = DEFAULTS.map((d) => ({
    ...d,
    row: defs.find((x) => x.category === d.category && x.isDefault)!,
  }));
  const keptIds = new Set(keep.map((k) => k.row.id));
  const moveTo: Record<string, number> = {};
  for (const d of defs) {
    if (keptIds.has(d.id)) continue;
    moveTo[String(d.id)] = keep.find((k) => k.category === d.category)!.row.id;
  }
  const res = await fetch(`${base}/api/admin/task-statuses`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      statuses: keep.map((k) => ({
        id: k.row.id,
        name: k.name,
        category: k.category,
        color: k.color,
        isDefault: true,
      })),
      moveTo,
    }),
  });
  if (!res.ok) throw new Error(`restore defaults ${res.status} ${await res.text()}`);
}

const row = (page: Page, name: string) =>
  page
    .getByTestId("task-status-row")
    .filter({ has: page.locator(`input[value="${name}"]`) });

async function openTab(page: Page) {
  await page.goto("/admin?tab=statuses");
  await expect(page.getByRole("heading", { name: "Task statuses" })).toBeVisible();
  await expect(page.getByTestId("status-group-TODO")).toBeVisible();
}

test.describe("Admin task statuses", () => {
  test.describe.configure({ mode: "serial" });

  let token = "";
  let base = "";

  test.beforeAll(async ({}, testInfo) => {
    base = apiBase(testInfo);
    token = (await login(base)).token;
    await restoreDefaults(base, token);
  });

  test.afterAll(async () => {
    await restoreDefaults(base, token);
  });

  test("rename, add in Active, save, reload persists; delete a status in use asks where to move its tasks", async ({
    page,
    seededProject,
  }) => {
    await loginViaUi(page);
    await openTab(page);

    // Three groups with their meaning.
    for (const title of ["Not started", "Active", "Done"]) {
      await expect(page.getByRole("region", { name: title })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

    // Rename "To do" -> "Backlog".
    await row(page, "To do").locator('input[aria-label="Status name"]').fill("Backlog");
    // Add "QA / UAT" in the Active group.
    await page.getByRole("button", { name: "Add status to Active" }).click();
    const added = page.getByTestId("status-group-IN_PROGRESS").locator('input[aria-label="Status name"]').last();
    await added.fill("QA / UAT");
    await expect(page.getByText("Unsaved changes")).toBeVisible();

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Unsaved changes")).toBeHidden();

    // Persisted: a hard reload shows the new names, QA / UAT inside Active.
    await page.reload();
    await expect(page.getByTestId("status-group-TODO").locator('input[value="Backlog"]')).toBeVisible();
    await expect(page.getByTestId("status-group-IN_PROGRESS").locator('input[value="QA / UAT"]')).toBeVisible();
    await expect(page.locator('input[value="To do"]')).toHaveCount(0);

    // Put a task on QA / UAT through the API, then delete the status in the UI.
    const defs = await listDefs(base, token);
    const qa = defs.find((d) => d.name === "QA / UAT")!;
    const res = await fetch(`${base}/api/projects/${seededProject.projectId}/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: `QA task ${Date.now()}`, statusId: qa.id }),
    });
    expect(res.ok).toBe(true);
    const task = (await res.json()) as { id: number };

    await page.reload();
    const qaRow = row(page, "QA / UAT");
    await expect(qaRow).toContainText("1 task");
    await qaRow.getByRole("button", { name: "Actions for QA / UAT" }).click();
    await page.getByRole("menuitem", { name: "Delete status" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Move 1 task to…")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Delete and move" })).toBeDisabled();
    await dialog.getByRole("combobox").selectOption({ label: "In progress" });
    await dialog.getByRole("button", { name: "Delete and move" }).click();
    await expect(page.locator('input[value="QA / UAT"]')).toHaveCount(0);

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Unsaved changes")).toBeHidden();

    await page.reload();
    await expect(page.locator('input[value="QA / UAT"]')).toHaveCount(0);
    const after = await listDefs(base, token);
    expect(after.find((d) => d.name === "QA / UAT")).toBeUndefined();
    const tasks = await getTasks(base, token, seededProject.projectId);
    const moved = tasks.find((t) => t.id === task.id) as unknown as { statusId: number; status: string };
    expect(moved.statusId).toBe(after.find((d) => d.name === "In progress")!.id);
    expect(moved.status).toBe("IN_PROGRESS");
  });

  test("the only status of a category cannot be deleted; a default cannot be deleted; duplicate names block save", async ({
    page,
  }) => {
    await loginViaUi(page);
    await openTab(page);

    // "Done" is the only status in its category.
    await row(page, "Done").getByRole("button", { name: "Actions for Done" }).click();
    await expect(page.getByRole("menuitem", { name: "Delete status" })).toBeDisabled();
    await expect(page.getByText("Each category needs at least one status")).toBeVisible();
    await page.keyboard.press("Escape");

    // With a second status in Not started, the default one still cannot go.
    await page.getByRole("button", { name: "Add status to Not started" }).click();
    await page.getByTestId("status-group-TODO").locator('input[aria-label="Status name"]').last().fill("Extra");
    await row(page, "Backlog").getByRole("button", { name: "Actions for Backlog" }).click();
    await expect(page.getByRole("menuitem", { name: "Delete status" })).toBeDisabled();
    await expect(page.getByText("Make another status the default first")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Add status to Done" }).click();
    const added = page.getByTestId("status-group-DONE").locator('input[aria-label="Status name"]').last();
    await added.fill("done");
    await expect(page.getByText("Another status already has this name").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  test("Reset to defaults restores To do / In progress / Done, keeping the saved statuses' ids", async ({
    page,
  }) => {
    const before = await listDefs(base, token);
    await loginViaUi(page);
    await openTab(page);

    await page.getByRole("button", { name: "Add status to Not started" }).click();
    await page.getByTestId("status-group-TODO").locator('input[aria-label="Status name"]').last().fill("Triage");
    await row(page, "Triage").getByRole("button", { name: "Actions for Triage" }).click();
    await page.getByRole("menuitem", { name: "Set as default" }).click();
    await row(page, "Backlog").locator('input[aria-label="Status name"]').fill("Later");

    await page.getByRole("button", { name: "Reset to defaults" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset draft" }).click();

    await expect(page.getByTestId("task-status-row")).toHaveCount(3);
    for (const name of ["To do", "In progress", "Done"]) {
      await expect(page.locator(`input[value="${name}"]`)).toBeVisible();
    }
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Unsaved changes")).toBeHidden();

    const after = await listDefs(base, token);
    expect(after.map((d) => d.name)).toEqual(["To do", "In progress", "Done"]);
    expect(after.map((d) => d.id)).toEqual(before.map((d) => d.id));
  });
});
