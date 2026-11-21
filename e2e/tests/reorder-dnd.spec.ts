import { test, expect, loginViaUi, apiBase, mouseDrag, center } from "../fixtures/test";
import { createSection, createTask, getTasks } from "../fixtures/seed";
import type { Locator } from "@playwright/test";

// Drag coverage for the two Sortable reorder surfaces that had only render
// checks: the "Reorder sections" modal on the List view and the subtask list
// inside the task panel. Mouse drag on the handle (dnd-kit PointerSensor), so
// the desktop project only, like kanban-dnd.spec.ts. Each test builds its own
// rows with unique names and reads the persisted order back from the API, so
// it neither depends on nor disturbs the shared per-worker project's data.

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Drags `handle` onto the vertical centre of `target` (the row to take over). */
async function dragHandleOnto(page: import("@playwright/test").Page, handle: Locator, target: Locator) {
  const hb = await handle.boundingBox();
  const tb = await target.boundingBox();
  expect(hb, "drag handle has no box").toBeTruthy();
  expect(tb, "drop target has no box").toBeTruthy();
  await mouseDrag(page, center(hb!), { x: hb!.x + hb!.width / 2, y: tb!.y + tb!.height / 3 });
}

/** A throwaway project on the fixture's own customer, deleted by the caller. */
async function throwawayProject(
  base: string,
  token: string,
  customerId: number,
  name: string,
): Promise<number> {
  const res = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, customerId }),
  });
  expect(res.ok, `project create failed: ${res.status}`).toBe(true);
  return ((await res.json()) as { id: number }).id;
}

async function deleteProject(base: string, token: string, projectId: number): Promise<void> {
  const res = await fetch(`${base}/api/projects/${projectId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok, `project ${projectId} delete failed: ${res.status}`).toBe(true);
}

test.describe("sortable reorder — desktop (mouse)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      test.info().project.name !== "desktop",
      "mouse drag cases run on the desktop project only",
    );
    await loginViaUi(page);
  });

  test("Reorder sections modal: dragging the last section to the top persists", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, customerId } = seededProject;
    const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const s = stamp();
    const projectId = await throwawayProject(base, token, customerId, `Reorder ${s}`);
    try {
      const names = [`Sec A ${s}`, `Sec B ${s}`, `Sec C ${s}`];
      for (const name of names) {
        await createSection(base, token, projectId, { name });
      }

      const sectionOrder = async (): Promise<string[]> => {
        const rows = (await fetch(`${base}/api/projects/${projectId}/sections`, { headers: H }).then(
          (r) => r.json(),
        )) as Array<{ name: string; position: number; id: number }>;
        return rows.sort((a, b) => a.position - b.position || a.id - b.id).map((r) => r.name);
      };
      expect(await sectionOrder()).toEqual(names);

      await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Reorder sections" }).click();
      const modal = page.getByRole("dialog", { name: "Reorder sections" });
      await expect(modal).toBeVisible();

      const rowOf = (name: string) =>
        modal.locator("div", { has: page.getByText(name, { exact: true }) }).filter({
          has: page.getByRole("button", { name: "Reorder section" }),
        }).last();
      const handles = modal.getByRole("button", { name: "Reorder section" });
      await expect(handles).toHaveCount(3);

      await dragHandleOnto(page, handles.nth(2), rowOf(names[0]));

      await expect
        .poll(sectionOrder, { timeout: 8_000 })
        .toEqual([names[2], names[0], names[1]]);
      // The modal mirrors the committed order.
      await expect(modal.getByText(/Sec [ABC] /)).toHaveText([names[2], names[0], names[1]]);
    } finally {
      await deleteProject(base, token, projectId);
    }
  });

  test("Task panel subtasks: dragging the last subtask to the top persists", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const s = stamp();
    const parent = await createTask(base, token, projectId, { title: `Drag parent ${s}` });
    const titles = [`Sub A ${s}`, `Sub B ${s}`, `Sub C ${s}`];
    for (const title of titles) {
      await createTask(base, token, projectId, { title, parentTaskId: parent.id });
    }

    const subtaskOrder = async (): Promise<string[]> =>
      (await getTasks(base, token, projectId))
        .filter((t) => t.parentTaskId === parent.id)
        .sort((a, b) => a.position - b.position || a.id - b.id)
        .map((t) => t.title);
    expect(await subtaskOrder()).toEqual(titles);

    await page.goto(`/projects/${projectId}/list?task=${parent.id}`, { waitUntil: "networkidle" });
    const panel = page.getByRole("dialog", { name: "Task details" });
    await expect(panel).toBeVisible();

    const handles = panel.getByRole("button", { name: "Reorder subtask" });
    await expect(handles).toHaveCount(3);
    const firstRow = panel.getByRole("button", { name: titles[0], exact: true });
    await expect(firstRow).toBeVisible();

    await dragHandleOnto(page, handles.nth(2), firstRow);

    await expect
      .poll(subtaskOrder, { timeout: 8_000 })
      .toEqual([titles[2], titles[0], titles[1]]);
  });
});
