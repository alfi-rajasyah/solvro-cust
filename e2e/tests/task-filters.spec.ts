import { test, expect, loginViaUi, apiBase } from "../fixtures/test";
import { createEpic, createSection } from "../fixtures/seed";

// Epic and label filters (shared across List, Kanban, Gantt and Timeline).
// The state lives in the URL (`?epicFilter=`, `?labels=`) and the project tab
// links carry it. Each test seeds its own uniquely named rows so it does not
// depend on what other specs left in the shared project.

async function api<T>(base: string, token: string, path: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

test.describe("task filters", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page);
  });

  test("epic filter keeps its URL across tabs and hides empty sections", async ({ page, seededProject }) => {
    test.skip(test.info().project.name !== "desktop", "tab-switch and Gantt checks run on desktop");
    const base = apiBase(test.info());
    const { token, projectId } = seededProject;
    const stamp = Date.now();
    const epic = await createEpic(base, token, projectId, { title: `Filter epic ${stamp}` });
    const withEpic = await createSection(base, token, projectId, { name: `Has epic ${stamp}` });
    const without = await createSection(base, token, projectId, { name: `No epic ${stamp}` });
    await api(base, token, `/projects/${projectId}/tasks`, "POST", {
      title: `In epic ${stamp}`,
      sectionId: withEpic.id,
      epicId: epic.id,
      startDate: "2026-11-02",
      dueDate: "2026-11-06",
    });
    await api(base, token, `/projects/${projectId}/tasks`, "POST", {
      title: `Outside ${stamp}`,
      sectionId: without.id,
      startDate: "2026-11-02",
      dueDate: "2026-11-06",
    });

    await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByLabel("Epic", { exact: true }).selectOption(String(epic.id));
    await expect(page).toHaveURL(new RegExp(`epicFilter=${epic.id}`));
    await page.keyboard.press("Escape");

    // List: the task of the epic and its section stay, the other section goes.
    await expect(page.getByText(`In epic ${stamp}`).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: `Has epic ${stamp}` })).toBeVisible();
    await expect(page.getByText(`Outside ${stamp}`)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: `No epic ${stamp}` })).toHaveCount(0);

    // The tab links carry the filter to the other views.
    for (const tab of ["Kanban", "Timeline", "Gantt", "List"]) {
      await page.getByRole("link", { name: tab, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`epicFilter=${epic.id}`));
    }

    await page.getByRole("link", { name: "Timeline", exact: true }).click();
    await expect(page.getByText(`In epic ${stamp}`).first()).toBeVisible();
    await expect(page.getByText(`Outside ${stamp}`)).toHaveCount(0);

    await page.getByRole("link", { name: "Gantt", exact: true }).click();
    const gantt = page.getByTestId("solvro-gantt");
    await expect(gantt.getByText(`In epic ${stamp}`).first()).toBeVisible();
    await expect(gantt.getByText(`Outside ${stamp}`)).toHaveCount(0);
    await expect(gantt.getByText(`No epic ${stamp}`)).toHaveCount(0);
    // Filter badge shows one active control; Clear brings everything back.
    await gantt.getByRole("button", { name: /Filter/ }).click();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/epicFilter=/);
    await expect(gantt.getByText(`Outside ${stamp}`).first()).toBeVisible();
  });

  test("label filter: OR, No label, parent stays for a matching subtask, Clear", async ({ page, seededProject }) => {
    const base = apiBase(test.info());
    const { token, projectId } = seededProject;
    const stamp = Date.now();
    const red = await api<{ id: number }>(base, token, `/projects/${projectId}/labels`, "POST", {
      name: `Red ${stamp}`,
      color: "#cc3333",
    });
    const blue = await api<{ id: number }>(base, token, `/projects/${projectId}/labels`, "POST", {
      name: `Blue ${stamp}`,
      color: "#3333cc",
    });
    await api(base, token, `/projects/${projectId}/tasks`, "POST", { title: `Red task ${stamp}`, labelIds: [red.id] });
    await api(base, token, `/projects/${projectId}/tasks`, "POST", { title: `Blue task ${stamp}`, labelIds: [blue.id] });
    await api(base, token, `/projects/${projectId}/tasks`, "POST", { title: `Bare task ${stamp}` });
    const parent = await api<{ id: number }>(base, token, `/projects/${projectId}/tasks`, "POST", {
      title: `Parent ${stamp}`,
    });
    await api(base, token, `/projects/${projectId}/tasks`, "POST", {
      title: `Blue sub ${stamp}`,
      parentTaskId: parent.id,
      labelIds: [blue.id],
    });

    await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
    // List renders a desktop row and a phone card per task; only one is visible.
    const shown = (title: string) => page.getByText(`${title} ${stamp}`).filter({ visible: true }).first();
    const hidden = (title: string) => page.getByText(`${title} ${stamp}`);

    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("checkbox", { name: `Red ${stamp}` }).check();
    await expect(page).toHaveURL(new RegExp(`labels=${red.id}`));
    await expect(shown("Red task")).toBeVisible();
    await expect(hidden("Blue task")).toHaveCount(0);
    await expect(hidden("Bare task")).toHaveCount(0);
    await expect(hidden("Parent")).toHaveCount(0);

    // OR with a second label; the parent comes back through its matching subtask.
    await page.getByRole("checkbox", { name: `Blue ${stamp}` }).check();
    await expect(shown("Blue task")).toBeVisible();
    await expect(shown("Parent")).toBeVisible();
    await expect(shown("Blue sub")).toBeVisible();
    await expect(hidden("Bare task")).toHaveCount(0);

    // "No label" is its own option; the badge counts the label control once.
    await page.getByRole("checkbox", { name: `Red ${stamp}` }).uncheck();
    await page.getByRole("checkbox", { name: `Blue ${stamp}` }).uncheck();
    await page.getByRole("checkbox", { name: "No label" }).check();
    await expect(shown("Bare task")).toBeVisible();
    await expect(hidden("Red task")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Filter 1" })).toBeVisible();

    // The label filter reaches Kanban through the tab link; Clear resets it.
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Kanban", exact: true }).click();
    await expect(page).toHaveURL(/labels=none/);
    await expect(shown("Bare task")).toBeVisible();
    await expect(hidden("Red task")).toHaveCount(0);
    await page.getByRole("button", { name: /Filter/ }).click();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/labels=/);
    await expect(shown("Red task")).toBeVisible();
  });
});
