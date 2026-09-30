import { test, expect, loginViaUi, apiBase } from "../fixtures/test";
import { createTask, getTasks } from "../fixtures/seed";
import type { Locator, Page } from "@playwright/test";

// Conflict warning (collaboration plan C4): an inline edit in the task panel
// sends `expected` (the value it last saw) for the field it changes; if
// someone else changed that same field meanwhile, the server answers 409
// `stale_write` and the panel shows a "Use theirs / Keep mine" dialog. A change
// to a DIFFERENT field never conflicts.
//
// Each test seeds its own task via the API and changes fields "behind the UI's
// back" with a direct PATCH, so the panel's cached copy is stale by design.

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function openTaskPanel(page: Page, projectId: number, taskId: number): Promise<Locator> {
  await page.goto(`/projects/${projectId}/list?task=${taskId}`, { waitUntil: "networkidle" });
  const panel = page.getByRole("dialog", { name: "Task details" });
  await expect(panel).toBeVisible();
  return panel;
}

async function patchBehindBack(
  base: string,
  token: string,
  taskId: number,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${base}/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.ok, `PATCH /tasks/${taskId} → ${res.status}`).toBe(true);
}

async function fieldOf(
  base: string,
  token: string,
  projectId: number,
  taskId: number,
  field: string,
): Promise<unknown> {
  const tasks = await getTasks(base, token, projectId);
  return tasks.find((t) => t.id === taskId)?.[field];
}

async function renameInPanel(panel: Locator, title: string): Promise<void> {
  // The title is the panel's big button; clicking swaps it for an input.
  await panel.locator("button.text-lg").first().click();
  const input = panel.locator("input[type=text]").first();
  await input.fill(title);
  await input.press("Enter");
}

test.describe("task conflict warning", () => {
  test("shows both values, and Use theirs keeps the server's value", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Original ${id}` });
    await loginViaUi(page);
    const panel = await openTaskPanel(page, projectId, task.id);
    await expect(panel.getByText(`Original ${id}`, { exact: true })).toBeVisible();

    await patchBehindBack(base, token, task.id, { title: `Theirs ${id}` });
    await renameInPanel(panel, `Mine ${id}`);

    const dialog = page.getByRole("dialog", { name: "Someone changed this task after you opened it" });
    await expect(dialog).toBeVisible();
    const row = dialog.getByTestId("conflict-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Title");
    await expect(row.getByTestId("conflict-now")).toHaveText(`Theirs ${id}`);
    await expect(row.getByTestId("conflict-yours")).toHaveText(`Mine ${id}`);

    await dialog.getByRole("button", { name: "Use theirs" }).click();
    await expect(dialog).toBeHidden();
    // The optimistic rename was rolled back and the panel shows theirs.
    await expect(panel.getByText(`Theirs ${id}`, { exact: true })).toBeVisible();
    await expect(panel.getByText(`Mine ${id}`, { exact: true })).toHaveCount(0);
    expect(await fieldOf(base, token, projectId, task.id, "title")).toBe(`Theirs ${id}`);
  });

  test("Keep mine saves the edit over theirs", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Original ${id}` });
    await loginViaUi(page);
    const panel = await openTaskPanel(page, projectId, task.id);
    await expect(panel.getByText(`Original ${id}`, { exact: true })).toBeVisible();

    await patchBehindBack(base, token, task.id, { title: `Theirs ${id}` });
    await renameInPanel(panel, `Mine ${id}`);

    const dialog = page.getByRole("dialog", { name: "Someone changed this task after you opened it" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep mine" }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(() => fieldOf(base, token, projectId, task.id, "title"), { timeout: 5_000 })
      .toBe(`Mine ${id}`);
    await expect(panel.getByText(`Mine ${id}`, { exact: true })).toBeVisible();
  });

  test("shows a status conflict with human labels", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const task = await createTask(base, token, projectId, { title: `Status ${stamp()}` });
    await loginViaUi(page);
    const panel = await openTaskPanel(page, projectId, task.id);

    await patchBehindBack(base, token, task.id, { status: "DONE" });
    // Header status chip opens a menu; pick "In progress".
    await panel.getByRole("button", { name: /To do/ }).first().click();
    await panel.getByRole("button", { name: "In progress" }).click();

    const dialog = page.getByRole("dialog", { name: "Someone changed this task after you opened it" });
    await expect(dialog).toBeVisible();
    const row = dialog.getByTestId("conflict-row");
    await expect(row).toContainText("Status");
    await expect(row.getByTestId("conflict-now")).toHaveText("Done");
    await expect(row.getByTestId("conflict-yours")).toHaveText("In progress");
    await dialog.getByRole("button", { name: "Use theirs" }).click();
    expect(await fieldOf(base, token, projectId, task.id, "status")).toBe("DONE");
  });

  test("a change to a different field does not raise the dialog", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Original ${id}` });
    await loginViaUi(page);
    const panel = await openTaskPanel(page, projectId, task.id);
    await expect(panel.getByText(`Original ${id}`, { exact: true })).toBeVisible();

    // Someone else changes the title; I change the priority.
    await patchBehindBack(base, token, task.id, { title: `Theirs ${id}` });
    await panel.getByTitle("Click to cycle priority").click();

    await expect
      .poll(() => fieldOf(base, token, projectId, task.id, "priority"), { timeout: 5_000 })
      .toBe("HIGH");
    await expect(
      page.getByRole("dialog", { name: "Someone changed this task after you opened it" }),
    ).toHaveCount(0);
    // Their title survived my priority save.
    expect(await fieldOf(base, token, projectId, task.id, "title")).toBe(`Theirs ${id}`);
  });
});

test.describe("task panel save ordering and dialog keys", () => {
  async function createLabel(base: string, token: string, projectId: number, name: string) {
    const res = await fetch(`${base}/api/projects/${projectId}/labels`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, color: "#3aae51" }),
    });
    expect(res.ok, `POST label → ${res.status}`).toBe(true);
  }

  test("two quick label toggles raise no dialog and both labels are saved", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const first = `LblA ${id}`;
    const second = `LblB ${id}`;
    await createLabel(base, token, projectId, first);
    await createLabel(base, token, projectId, second);
    const task = await createTask(base, token, projectId, { title: `Labels ${id}` });
    await loginViaUi(page);
    const panel = await openTaskPanel(page, projectId, task.id);

    // Slow every task PATCH so the second click lands while the first save is
    // still in flight — the window in which a stale read used to 409.
    await page.route("**/api/tasks/*", async (route) => {
      if (route.request().method() === "PATCH") await new Promise((r) => setTimeout(r, 500));
      await route.continue();
    });
    await panel.getByRole("button", { name: first }).click();
    await panel.getByRole("button", { name: second }).click();

    await expect
      .poll(
        async () => {
          const labels = (await fieldOf(base, token, projectId, task.id, "labels")) as { name: string }[];
          return labels.map((l) => l.name).sort();
        },
        { timeout: 8_000 },
      )
      .toEqual([first, second].sort());
    await expect(
      page.getByRole("dialog", { name: "Someone changed this task after you opened it" }),
    ).toHaveCount(0);
  });

  test("Escape in the conflict dialog closes only the dialog", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Esc ${id}` });
    await loginViaUi(page);
    const panel = await openTaskPanel(page, projectId, task.id);
    await expect(panel.getByText(`Esc ${id}`, { exact: true })).toBeVisible();

    await patchBehindBack(base, token, task.id, { title: `Theirs ${id}` });
    await renameInPanel(panel, `Mine ${id}`);
    const dialog = page.getByRole("dialog", { name: "Someone changed this task after you opened it" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(panel).toBeVisible();
    expect(new URL(page.url()).searchParams.get("task")).toBe(String(task.id));
  });
});

test.describe("task panel title save ordering", () => {
  test("Enter followed by blur (Safari/Firefox unmount blur) saves the title once, with no dialog", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Blur ${id}` });
    await loginViaUi(page);
    const panel = await openTaskPanel(page, projectId, task.id);
    await expect(panel.getByText(`Blur ${id}`, { exact: true })).toBeVisible();

    const patches: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "PATCH" && req.url().includes(`/api/tasks/${task.id}`)) {
        patches.push(req.postData() ?? "");
      }
    });

    await panel.locator("button.text-lg").first().click();
    const input = panel.locator("input[type=text]").first();
    await input.fill(`Renamed ${id}`);
    // Chromium does not blur an input that unmounts after Enter; Safari and
    // Firefox do, and React then runs the Enter (submit) handler and the blur
    // handler from the same render's closure. Emulate that exactly: call the
    // form's onSubmit and the input's onBlur back to back, synchronously,
    // before React re-renders. This deliberately reads React's private
    // `__reactProps$*` expando off the DOM nodes — there is no public way to
    // call a handler twice from one closure, and real events can't do it on
    // Chromium (React re-renders between any two dispatched events).
    await input.evaluate((el) => {
      type Handlers = { onSubmit?: (e: unknown) => void; onBlur?: (e: unknown) => void };
      const propsOf = (node: Element): Handlers => {
        const key = Object.keys(node).find((k) => k.startsWith("__reactProps$"));
        return (key ? (node as unknown as Record<string, Handlers>)[key] : {}) as Handlers;
      };
      const fakeEvent = { preventDefault() {}, stopPropagation() {} };
      const form = (el as HTMLInputElement).form!;
      propsOf(form).onSubmit?.(fakeEvent);
      propsOf(el).onBlur?.(fakeEvent);
    });

    await expect
      .poll(() => fieldOf(base, token, projectId, task.id, "title"), { timeout: 5_000 })
      .toBe(`Renamed ${id}`);
    // A duplicate save would be sent right after the first commits; wait for
    // the network to drain, then assert exactly one PATCH and no dialog.
    await page.waitForLoadState("networkidle");
    await expect.poll(() => patches.length, { timeout: 2_000 }).toBe(1);
    await expect(
      page.getByRole("dialog", { name: "Someone changed this task after you opened it" }),
    ).toHaveCount(0);
    expect(patches).toHaveLength(1);
  });

  test("a second save queued behind a refused one is dropped; the first conflict stays", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Queue ${id}` });
    await loginViaUi(page);
    const panel = await openTaskPanel(page, projectId, task.id);
    await expect(panel.getByText(`Queue ${id}`, { exact: true })).toBeVisible();

    const patches: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "PATCH" && req.url().includes(`/api/tasks/${task.id}`)) {
        patches.push(req.postData() ?? "");
      }
    });
    await page.route("**/api/tasks/*", async (route) => {
      if (route.request().method() === "PATCH") await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });

    await patchBehindBack(base, token, task.id, { title: `Theirs ${id}` });
    await renameInPanel(panel, `First ${id}`);
    // Second rename of the same field while the first is still in flight: its
    // `expected` would be the first's optimistic title, which can never match.
    await renameInPanel(panel, `Second ${id}`);

    const dialog = page.getByRole("dialog", { name: "Someone changed this task after you opened it" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("conflict-row")).toHaveCount(1);
    await expect(dialog.getByTestId("conflict-yours")).toHaveText(`First ${id}`);
    await page.waitForTimeout(1200);
    await expect(dialog.getByTestId("conflict-yours")).toHaveText(`First ${id}`);
    expect(patches.filter((p) => p.includes("First") || p.includes("Second"))).toHaveLength(1);
  });
});

// Opens the edit form from a /tasks row, scoped to the fixture's customer.
// Two waits matter on a fast (production) build: the Filters popover must be
// fully gone — while it lingers its focus manager pulls focus back into its
// own search input and swallows the typing meant for the form — and the form's
// title input must actually hold focus before the test types into it.
async function openEditForm(page: Page, customerName: string, projectId: number, title: string) {
  await page.goto("/tasks", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("option", { name: "Customer", exact: true }).hover();
  await page.getByRole("option", { name: customerName, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Filter...")).toBeHidden();
  const row = page
    .locator("tr")
    .filter({ has: page.locator(`a[href="/projects/${projectId}"]`) })
    .filter({ has: page.getByText(title, { exact: true }) });
  await row.getByText(title, { exact: true }).click();
  const titleInput = page.getByPlaceholder("Task title");
  await expect(titleInput).toHaveValue(title);
  await expect(titleInput).toBeFocused();
}

// The edit form (opened from a /tasks row) sends only the fields the user
// changed, checked against the task as the form opened — not the live copy.
test.describe("task edit form conflict warning (desktop)", () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== "desktop", "The /tasks filter toolbar is exercised on desktop");
  });

  test("raises the dialog for a field changed on both sides; Keep mine saves it", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId, customerName } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Form ${id}` });
    await loginViaUi(page);
    await openEditForm(page, customerName, projectId, `Form ${id}`);

    await patchBehindBack(base, token, task.id, { title: `Theirs ${id}` });
    await page.getByPlaceholder("Task title").fill(`Mine ${id}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Someone changed this task after you opened it" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("conflict-row")).toHaveCount(1);
    await expect(dialog.getByTestId("conflict-now")).toHaveText(`Theirs ${id}`);
    await expect(dialog.getByTestId("conflict-yours")).toHaveText(`Mine ${id}`);

    await dialog.getByRole("button", { name: "Keep mine" }).click();
    await expect
      .poll(() => fieldOf(base, token, projectId, task.id, "title"), { timeout: 5_000 })
      .toBe(`Mine ${id}`);
  });

  test("a field the user did not touch is neither checked nor overwritten", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId, customerName } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Form ${id}` });
    await loginViaUi(page);
    await openEditForm(page, customerName, projectId, `Form ${id}`);

    // Someone else retitles the task; I only write a description.
    await patchBehindBack(base, token, task.id, { title: `Theirs ${id}` });
    await page.getByPlaceholder("Add a description…").fill(`Notes ${id}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect
      .poll(() => fieldOf(base, token, projectId, task.id, "description"), { timeout: 5_000 })
      .toBe(`Notes ${id}`);
    await expect(
      page.getByRole("dialog", { name: "Someone changed this task after you opened it" }),
    ).toHaveCount(0);
    expect(await fieldOf(base, token, projectId, task.id, "title")).toBe(`Theirs ${id}`);
  });
});

test.describe("task edit form Use theirs (desktop)", () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== "desktop", "The /tasks filter toolbar is exercised on desktop");
  });

  test("keeps the form open with my other edits; only the clashing field takes theirs", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId, customerName } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Keep ${id}` });
    await loginViaUi(page);
    await openEditForm(page, customerName, projectId, `Keep ${id}`);
    const titleInput = page.getByPlaceholder("Task title");

    await patchBehindBack(base, token, task.id, { title: `Theirs ${id}` });
    await titleInput.fill(`Mine ${id}`);
    await page.getByPlaceholder("Add a description…").fill(`Notes ${id}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Someone changed this task after you opened it" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Use theirs" }).click();
    await expect(dialog).toBeHidden();

    // Form still open: title took theirs, my description edit is still there.
    await expect(titleInput).toHaveValue(`Theirs ${id}`);
    await expect(page.getByPlaceholder("Add a description…")).toHaveValue(`Notes ${id}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect
      .poll(() => fieldOf(base, token, projectId, task.id, "description"), { timeout: 5_000 })
      .toBe(`Notes ${id}`);
    expect(await fieldOf(base, token, projectId, task.id, "title")).toBe(`Theirs ${id}`);
  });
});
