import { type Page } from "@playwright/test";
import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { createTask, getTasks, isoDateOffset, login } from "../fixtures/seed";

// The one grouped status picker (docs/archive/plans/custom-task-statuses.md
// §3 B2/B4). The status list is workspace-wide shared state, so this spec puts
// the three default statuses back before and after (a run that died midway
// must not leave other specs facing "QA / UAT").

interface Def {
  id: number;
  name: string;
  category: "TODO" | "IN_PROGRESS" | "DONE";
  isDefault: boolean;
}

const DEFAULTS = [
  { name: "To do", category: "TODO", color: "gray" },
  { name: "In progress", category: "IN_PROGRESS", color: "primary" },
  { name: "Done", category: "DONE", color: "emerald" },
] as const;

const adminHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

async function listDefs(base: string, token: string): Promise<Def[]> {
  const res = await fetch(`${base}/api/admin/task-statuses`, { headers: adminHeaders(token) });
  if (!res.ok) throw new Error(`GET admin/task-statuses ${res.status}`);
  return res.json() as Promise<Def[]>;
}

async function saveDefs(base: string, token: string, body: unknown): Promise<void> {
  const res = await fetch(`${base}/api/admin/task-statuses`, {
    method: "PUT",
    headers: adminHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT admin/task-statuses ${res.status} ${await res.text()}`);
}

/** Back to To do / In progress / Done: each category's default is renamed into place, the rest moves onto it. */
async function restoreDefaults(base: string, token: string): Promise<void> {
  const defs = await listDefs(base, token);
  const keep = DEFAULTS.map((d) => ({ ...d, row: defs.find((x) => x.category === d.category && x.isDefault)! }));
  const keptIds = new Set(keep.map((k) => k.row.id));
  const moveTo: Record<string, number> = {};
  for (const d of defs) {
    if (keptIds.has(d.id)) continue;
    moveTo[String(d.id)] = keep.find((k) => k.category === d.category)!.row.id;
  }
  await saveDefs(base, token, {
    statuses: keep.map((k) => ({ id: k.row.id, name: k.name, category: k.category, color: k.color, isDefault: true })),
    moveTo,
  });
}

async function openPanel(page: Page, projectId: number, taskId: number) {
  await page.goto(`/projects/${projectId}/list?task=${taskId}`, { waitUntil: "networkidle" });
  const panel = page.getByRole("dialog", { name: "Task details" });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("Grouped status picker", () => {
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

  test("with the default statuses the picker groups To do / In progress / Done under their category", async ({
    page,
    seededProject,
  }) => {
    const task = await createTask(base, seededProject.token, seededProject.projectId, {
      title: `Picker default ${Date.now().toString(36)}`,
    });
    await loginViaUi(page);
    const panel = await openPanel(page, seededProject.projectId, task.id);

    const trigger = panel.getByRole("combobox", { name: "Status" });
    await expect(trigger).toContainText("To do");
    await trigger.click();

    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    for (const header of ["Not started", "Active", "Done"]) {
      await expect(listbox.getByRole("group", { name: header })).toBeVisible();
    }
    await expect(listbox.getByRole("option")).toHaveText(["To do", "In progress", "Done"]);
    await expect(listbox.getByRole("option", { name: "To do", exact: true })).toHaveAttribute("aria-selected", "true");

    // Keyboard: Escape closes without changing anything.
    await page.keyboard.press("Escape");
    await expect(listbox).toBeHidden();
    await expect(trigger).toContainText("To do");
  });

  test("a custom status is grouped in the picker, and a task moved to it shows its name in the panel, List and Tasks page", async ({
    page,
    seededProject,
  }) => {
    const defs = await listDefs(base, token);
    const byCat = (c: Def["category"]) => defs.find((d) => d.category === c && d.isDefault)!;
    await saveDefs(base, token, {
      statuses: [
        { id: byCat("TODO").id, name: "To do", category: "TODO", color: "gray", isDefault: true },
        { name: "Backlog", category: "TODO", color: "amber", isDefault: false },
        { id: byCat("IN_PROGRESS").id, name: "In progress", category: "IN_PROGRESS", color: "primary", isDefault: true },
        { name: "QA / UAT", category: "IN_PROGRESS", color: "violet", isDefault: false },
        { id: byCat("DONE").id, name: "Done", category: "DONE", color: "emerald", isDefault: true },
      ],
    });

    const title = `Picker custom ${Date.now().toString(36)}`;
    const task = await createTask(base, seededProject.token, seededProject.projectId, {
      title,
      // Dated so the Tasks page (soonest-due first, 200-row window) lists it.
      dueDate: isoDateOffset(3),
    });
    await loginViaUi(page);
    const panel = await openPanel(page, seededProject.projectId, task.id);

    await panel.getByRole("combobox", { name: "Status" }).click();
    const listbox = page.getByRole("listbox");
    await expect(listbox.getByRole("group", { name: "Active" })).toContainText("QA / UAT");
    await expect(listbox.getByRole("group", { name: "Not started" })).toContainText("Backlog");
    await expect(listbox.getByRole("option")).toHaveText(["To do", "Backlog", "In progress", "QA / UAT", "Done"]);
    await listbox.getByRole("option", { name: "QA / UAT", exact: true }).click();

    // Panel chip shows the status name; the server kept the category in step.
    await expect(panel.getByRole("combobox", { name: "Status" })).toContainText("QA / UAT");
    await expect
      .poll(async () => {
        const t = (await getTasks(base, seededProject.token, seededProject.projectId)).find((x) => x.id === task.id);
        return [t?.status, (t?.statusDef as { name?: string } | undefined)?.name];
      })
      .toEqual(["IN_PROGRESS", "QA / UAT"]);

    // List shows the same name (desktop row or phone card).
    await page.goto(`/projects/${seededProject.projectId}/list`, { waitUntil: "networkidle" });
    await expect(page.getByText("QA / UAT", { exact: true }).locator("visible=true").first()).toBeVisible();

    // Tasks page: chip shows the status; the status filter groups it.
    if (test.info().project.name === "desktop") {
      await page.goto("/tasks", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Filter", exact: true }).click();
      await page.getByRole("option", { name: "Customer", exact: true }).hover();
      await page.getByRole("option", { name: seededProject.customerName, exact: true }).click();
      await page.keyboard.press("Escape");
      const row = page.locator("tr").filter({ has: page.getByText(title, { exact: true }) });
      await expect(row).toContainText("QA / UAT");
    }
  });
});
