import {
  test,
  expect,
  loginViaUi,
  openKanban,
  gripFor,
  center,
  mouseDrag,
  apiBase,
  captureTaskRequests,
} from "../fixtures/test";
import { getTasks, setWipLimits } from "../fixtures/seed";

// Kanban columns per workspace status (docs/archive/plans/custom-task-statuses.md
// §3 B3). The status list is workspace-wide and shared with every other spec on
// this stack, so the custom "QA / UAT" status is created in setup and the list
// is put back exactly as found in afterAll.

interface Def {
  id: number;
  name: string;
  category: string;
  color: string;
  isDefault: boolean;
}

const QA_NAME = "QA / UAT";

async function listDefs(base: string, token: string): Promise<Def[]> {
  const res = await fetch(`${base}/api/task-statuses`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET /task-statuses failed: ${res.status}`);
  return (await res.json()) as Def[];
}

async function saveDefs(
  base: string,
  token: string,
  defs: Array<Omit<Def, "id"> & { id?: number }>,
  moveTo?: Record<string, number>,
): Promise<void> {
  const res = await fetch(`${base}/api/admin/task-statuses`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      statuses: defs.map((d) => ({
        ...(d.id !== undefined ? { id: d.id } : {}),
        name: d.name,
        category: d.category,
        color: d.color,
        isDefault: d.isDefault,
      })),
      ...(moveTo ? { moveTo } : {}),
    }),
  });
  if (!res.ok) throw new Error(`PUT /admin/task-statuses failed: ${res.status} ${await res.text()}`);
}

interface TaskState {
  id: number;
  statusId: number;
  position: number;
}

/** Puts every task back on its recorded status and position. `seededProject`
 * is worker-scoped, so the next spec file (kanban-dnd) reuses this project. */
async function restoreTasks(base: string, token: string, projectId: number, saved: TaskState[]): Promise<void> {
  const current = await getTasks(base, token, projectId);
  for (const t of saved) {
    const now = current.find((c) => c.id === t.id);
    if (!now || (now.statusId === t.statusId && now.position === t.position)) continue;
    const res = await fetch(`${base}/api/tasks/${t.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ statusId: t.statusId, position: t.position }),
    });
    if (!res.ok) throw new Error(`restore of task ${t.id} failed: ${res.status}`);
  }
}

test.describe("kanban — one column per custom status", () => {
  let original: Def[] = [];
  let savedTasks: TaskState[] = [];
  let qa: Def;

  test.beforeAll(async ({ seededProject }, workerInfo) => {
    const base = workerInfo.project.use.baseURL ?? "http://localhost:8080";
    original = await listDefs(base, seededProject.token);
    savedTasks = (await getTasks(base, seededProject.token, seededProject.projectId))
      .filter((t) => t.parentTaskId === null)
      .map((t) => ({ id: t.id, statusId: t.statusId as number, position: t.position }));
    // QA / UAT sits right after the Active default, still inside the Active category.
    const withQa: Array<Omit<Def, "id"> & { id?: number }> = [];
    for (const d of original) {
      withQa.push(d);
      if (d.category === "IN_PROGRESS" && d.isDefault) {
        withQa.push({ name: QA_NAME, category: "IN_PROGRESS", color: "violet", isDefault: false });
      }
    }
    await saveDefs(base, seededProject.token, withQa);
    const defs = await listDefs(base, seededProject.token);
    const found = defs.find((d) => d.name === QA_NAME);
    if (!found) throw new Error("QA / UAT was not created");
    qa = found;
  });

  test.afterAll(async ({ seededProject }, workerInfo) => {
    const base = workerInfo.project.use.baseURL ?? "http://localhost:8080";
    // Tasks the specs moved go back to their recorded status and position
    // first; the whole-list save then drops QA with nothing left to relocate.
    try {
      await restoreTasks(base, seededProject.token, seededProject.projectId, savedTasks);
    } finally {
      // Anything still on QA (e.g. a subtask restoreTasks did not cover) moves
      // onto the In progress default instead of failing the restore with a 409.
      const inProgress = original.find((d) => d.category === "IN_PROGRESS" && d.isDefault);
      await saveDefs(base, seededProject.token, original, inProgress?.id && qa?.id ? { [String(qa.id)]: inProgress.id } : undefined);
    }
  });

  test("a 4th column appears under the Active band; dragging a card into it persists statusId", async ({
    page,
    seededProject,
  }) => {
    test.skip(test.info().project.name !== "desktop", "mouse drag runs on the desktop project only");
    const base = apiBase(test.info());
    await loginViaUi(page);
    await openKanban(page, seededProject.projectId);

    await expect(page.locator('[data-slot="kanban-column"]')).toHaveCount(4);
    await expect(page.locator("h3", { hasText: QA_NAME })).toBeVisible();
    // Band: Not started (1 col) / Active (2 cols: In progress + QA) / Done (1 col).
    const bands = page.getByTestId("kanban-category-band");
    await expect(bands).toHaveCount(3);
    await expect(bands.nth(1)).toContainText("Active");
    const activeBox = await bands.nth(1).boundingBox();
    const qaColBox = await page.locator(`[data-slot="kanban-column"][data-value="status-${qa.id}"]`).boundingBox();
    expect(activeBox && qaColBox, "band and QA column must render").toBeTruthy();
    // The Active band spans past the QA column's left edge to its right edge.
    expect(activeBox!.x + activeBox!.width).toBeGreaterThanOrEqual(qaColBox!.x + qaColBox!.width - 2);

    const grip = await gripFor(page, "Gamma", "Drag to reorder");
    const header = await page.locator("h3", { hasText: QA_NAME }).boundingBox();
    expect(grip, "grip for Gamma not found").toBeTruthy();
    expect(header, "QA / UAT header not found").toBeTruthy();

    const requests = await captureTaskRequests(page, async () => {
      await mouseDrag(page, center(grip!), { x: header!.x + 60, y: header!.y + 160 });
    });
    expect(requests.length).toBe(1);
    expect(requests[0].body?.statusId).toBe(qa.id);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const tasks = await getTasks(base, seededProject.token, seededProject.projectId);
    const gamma = tasks.find((t) => t.title === "Gamma");
    expect(gamma?.statusId).toBe(qa.id);
    // The category stays in lockstep with the status.
    expect(gamma?.status).toBe("IN_PROGRESS");
    const qaColumn = page.locator(`[data-slot="kanban-column"][data-value="status-${qa.id}"]`);
    await expect(qaColumn.getByText("Gamma", { exact: true })).toBeVisible();
  });

  test("the WIP pill reads the limit of its own status", async ({ page, seededProject }) => {
    const base = apiBase(test.info());
    // Keys are status ids: the QA limit must not leak onto the In progress column.
    const res = await fetch(`${base}/api/projects/${seededProject.projectId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${seededProject.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ wipLimits: { [String(qa.id)]: 1 } }),
    });
    expect(res.ok).toBe(true);
    try {
      // Exactly one card in QA, whatever an earlier test left there.
      await restoreTasks(base, seededProject.token, seededProject.projectId, savedTasks);
      const beta = savedTasks.length > 1 ? savedTasks[1] : savedTasks[0];
      const move = await fetch(`${base}/api/tasks/${beta.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${seededProject.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ statusId: qa.id }),
      });
      expect(move.ok).toBe(true);
      await loginViaUi(page);
      await openKanban(page, seededProject.projectId);

      const qaColumn = page.locator(`[data-slot="kanban-column"][data-value="status-${qa.id}"]`);
      const inProgressDef = original.find((d) => d.category === "IN_PROGRESS" && d.isDefault)!;
      const inProgressColumn = page.locator(`[data-slot="kanban-column"][data-value="status-${inProgressDef.id}"]`);
      // The first test left Gamma in QA (desktop); on mobile nothing moved yet.
      await expect(qaColumn.getByTitle("WIP limit: 1")).toBeVisible();
      await expect(qaColumn.getByText("1 / 1")).toBeVisible();
      await expect(inProgressColumn.getByTitle(/WIP limit/)).toHaveCount(0);
    } finally {
      await setWipLimits(base, seededProject.token, seededProject.projectId, {
        TODO: null,
        IN_PROGRESS: null,
        DONE: null,
      });
      await fetch(`${base}/api/projects/${seededProject.projectId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${seededProject.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ wipLimits: { [String(qa.id)]: null } }),
      });
    }
  });

  test("Done columns collapse into a hidden note and expand again (per viewer)", async ({ page, seededProject }) => {
    test.skip(test.info().project.name !== "desktop", "header controls are exercised on desktop");
    await loginViaUi(page);
    await openKanban(page, seededProject.projectId);

    const doneDef = original.find((d) => d.category === "DONE" && d.isDefault)!;
    await expect(page.locator('[data-slot="kanban-column"]')).toHaveCount(4);
    await page.getByRole("button", { name: `Collapse ${doneDef.name} column` }).click();
    await expect(page.locator('[data-slot="kanban-column"]')).toHaveCount(3);
    const note = page.getByRole("button", { name: `Show ${doneDef.name} column` });
    await expect(note).toContainText("(hidden)");

    // Survives a reload (localStorage), then expands back.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator('[data-slot="kanban-column"]')).toHaveCount(3);
    await page.getByRole("button", { name: `Show ${doneDef.name} column` }).click();
    await expect(page.locator('[data-slot="kanban-column"]')).toHaveCount(4);
  });

  test("mobile move sheet lists statuses by category and moves a card into QA / UAT", async ({
    page,
    seededProject,
  }) => {
    test.skip(test.info().project.name !== "mobile", "move sheet is the phone path");
    const base = apiBase(test.info());
    await loginViaUi(page);
    await openKanban(page, seededProject.projectId);

    await page.locator('[aria-label="Card options"]').first().click();
    await expect(page.getByText("Move to", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Active", { exact: true }).last()).toBeVisible();
    await page.getByRole("button", { name: QA_NAME, exact: true }).click();
    await page.waitForTimeout(1000);

    const tasks = await getTasks(base, seededProject.token, seededProject.projectId);
    expect(tasks.some((t) => t.parentTaskId === null && t.statusId === qa.id)).toBe(true);
  });
});
