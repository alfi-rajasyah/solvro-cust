import {
  test,
  expect,
  loginViaUi,
  gripFor,
  center,
  mouseDrag,
  apiBase,
} from "../fixtures/test";
import { getTasks, type SeededTask, createEpic } from "../fixtures/seed";
import type { Page } from "@playwright/test";

// Regression coverage for unified-task-ordering
// (docs/plans/unified-task-ordering-plan.md, Task 6): List-view row reorder
// + status-chip parity, and Gantt list-pane row reorder. Mirrors
// kanban-dnd.spec.ts's fixtures, mouse-drag helper, and
// (position, id)-sorted-order assertion idiom — mouse-drag cases only make
// sense on the desktop project (dnd-kit PointerSensor), same guard as
// kanban-dnd. `position` is now a single per-project global order for
// top-level tasks, so every assertion below reads that global order rather
// than a per-view/per-status one.

function byTitle<T extends { title: string }>(tasks: T[], title: string): T | undefined {
  return tasks.find((t) => t.title === title);
}

function topLevelSorted(tasks: SeededTask[]): SeededTask[] {
  return tasks
    .filter((t) => t.parentTaskId === null)
    .sort((a, b) => a.position - b.position || a.id - b.id);
}

async function openList(page: Page, projectId: number): Promise<void> {
  await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
}

async function openGanttView(page: Page, projectId: number): Promise<void> {
  await page.goto(`/projects/${projectId}/gantt`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
}

/**
 * Locates the desktop List row (the `hidden ... md:grid` grid row — not the
 * `md:hidden` mobile card the same TaskRow also renders) containing `title`.
 * Both the column-header row and every desktop task row carry the same
 * arbitrary-value `grid-cols-[...]` Tailwind token, and no other element on
 * the page does, so an attribute-substring match + text filter is a stable
 * hook without needing a data-testid (the header row never matches a task
 * title). Reused instead of `gripFor`'s heuristic here because this test
 * needs a *button inside* the row (the status chip), not the row itself.
 */
function desktopRow(page: Page, title: string) {
  return page.locator('div[class*="grid-cols-"]', { hasText: title });
}

async function apiPatchTask(
  base: string,
  token: string,
  id: number,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${base}/api/tasks/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PATCH /tasks/${id} failed: ${res.status} ${await res.text()}`);
  }
}

/** Same "click past the popover" dismissal kanban-dnd.spec.ts's
 * `closeFilterPopover` uses — the List filter popover is the same
 * fixed-overlay + absolute-panel shape (ProjectList.tsx). */
async function closeFilterPopover(page: Page): Promise<void> {
  await page.mouse.click(500, 500);
}

test.describe("list & gantt drag & drop — desktop (mouse)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      test.info().project.name !== "desktop",
      "mouse drag cases run on the desktop project only",
    );
    await loginViaUi(page);
  });

  test("cross-status reorder in one section sticks: Gamma onto Alpha", async ({
    page,
    seededProject,
  }) => {
    // All four seeded top-level tasks have sectionId null (the "No section"
    // group is the only section rendered), so this is inherently a
    // same-section drag — no sectionId patch should be sent.
    const base = apiBase(test.info());
    const before = await getTasks(base, seededProject.token, seededProject.projectId);
    const gammaBefore = byTitle(before, "Gamma");
    const statusesBefore = new Map(topLevelSorted(before).map((t) => [t.title, t.status]));
    expect(gammaBefore, "Gamma not found in seed").toBeTruthy();

    await openList(page, seededProject.projectId);

    const grip = await gripFor(page, "Gamma", "Drag to reorder");
    const alphaBox = await page.getByText("Alpha", { exact: true }).first().boundingBox();
    expect(grip, "grip for Gamma not found").toBeTruthy();
    expect(alphaBox, "Alpha row not found").toBeTruthy();

    await mouseDrag(page, center(grip!), { x: alphaBox!.x + 60, y: alphaBox!.y + 8 });

    const after = await getTasks(base, seededProject.token, seededProject.projectId);
    const order = topLevelSorted(after);
    const gammaIdx = order.findIndex((t) => t.title === "Gamma");
    const alphaIdx = order.findIndex((t) => t.title === "Alpha");
    expect(gammaIdx, "Gamma not found post-drag").toBeGreaterThanOrEqual(0);
    expect(alphaIdx, "Alpha not found post-drag").toBeGreaterThanOrEqual(0);
    // Gamma lands immediately before Alpha (upward drag -> insert-before
    // arrayMove semantics — ProjectList.tsx handleDragEnd row-drop branch).
    expect(gammaIdx).toBe(alphaIdx - 1);

    // The reorder must not touch status: Gamma keeps whatever the seed gave
    // it, and so does every other top-level task.
    const gammaAfter = byTitle(after, "Gamma");
    expect(gammaAfter?.status).toBe(gammaBefore?.status);
    for (const [title, status] of statusesBefore) {
      const t = byTitle(after, title);
      expect(t?.status, `${title} status changed`).toBe(status);
    }
  });

  test("status chip change keeps the slot: Beta status flips, order stays", async ({
    page,
    seededProject,
  }) => {
    // Read Beta's CURRENT status rather than assuming the raw seed value
    // (TODO): `seededProject` is a worker-scoped fixture and this worker
    // also runs kanban-dnd.spec.ts, whose "cross-column drag" case flips
    // this same seeded project's Beta to IN_PROGRESS when both files share
    // a worker — so hardcoding "TODO" here is a false assumption about
    // fixture isolation, not a real precondition on the app.
    const STATUS_LABEL: Record<string, string> = { TODO: "To do", IN_PROGRESS: "Active", DONE: "Done" };
    const NEXT: Record<string, string> = { TODO: "IN_PROGRESS", IN_PROGRESS: "DONE", DONE: "TODO" };

    const base = apiBase(test.info());
    const before = await getTasks(base, seededProject.token, seededProject.projectId);
    const beforeOrder = topLevelSorted(before).map((t) => t.id);
    const betaBefore = byTitle(before, "Beta");
    expect(betaBefore, "Beta not found in seed").toBeTruthy();

    const fromStatus = betaBefore!.status;
    const toStatus = NEXT[fromStatus] ?? "DONE";
    const fromLabel = STATUS_LABEL[fromStatus] ?? fromStatus;
    const toLabel = STATUS_LABEL[toStatus] ?? toStatus;
    expect(fromLabel).not.toBe(toLabel);

    await openList(page, seededProject.projectId);

    // StatusSelect (ProjectList.tsx): the chip is a <button> whose visible
    // text is the current STATUS_LABEL ("To do"/"Active"/"Done"); clicking
    // it opens a dropdown of the same three labels as sibling <button>s
    // inside the same row.
    const row = desktopRow(page, "Beta");
    await row.locator("button").filter({ hasText: fromLabel }).click();
    await row.locator("button").filter({ hasText: toLabel }).click();

    // Poll the API until the PATCH has actually landed, instead of a fixed
    // sleep — the click fires an optimistic mutation; asserting immediately
    // risked reading pre-PATCH state before the request settles.
    let after: SeededTask[] = [];
    await expect
      .poll(
        async () => {
          after = await getTasks(base, seededProject.token, seededProject.projectId);
          return after.find((t) => t.id === betaBefore!.id)?.status;
        },
        { message: "waiting for Beta's status PATCH to land", timeout: 10_000 },
      )
      .toBe(toStatus);

    const afterOrder = topLevelSorted(after).map((t) => t.id);
    // Identical id SEQUENCE — a status-only change must not move the row's
    // slot (siblingListId no longer partitions by status).
    expect(afterOrder).toEqual(beforeOrder);

    const betaAfter = after.find((t) => t.id === betaBefore!.id);
    expect(betaAfter?.status).toBe(toStatus);
    for (const t of topLevelSorted(after)) {
      if (t.id === betaBefore!.id) continue;
      const orig = before.find((x) => x.id === t.id);
      expect(t.status, `${t.title} status changed unexpectedly`).toBe(orig?.status);
    }
  });

  test("gantt row drag: reorder sticks, dates untouched", async ({ page, seededProject }) => {
    const base = apiBase(test.info());
    const before = await getTasks(base, seededProject.token, seededProject.projectId);
    const beforeOrder = topLevelSorted(before);
    // Plan B Task 8 flake fix: `playwright.config.ts` pins `workers: 1` and
    // `fullyParallel: false`, and worker-scoped fixtures (`seededProject`)
    // are only re-created when Playwright actually restarts the worker —
    // which does NOT happen between every spec file in a single-worker run.
    // In practice this file's project can end up shared with OTHER spec
    // files that alphabetically sort before it (e.g. `gantt-parity.spec.ts`
    // seeds a milestone task with no `startDate` — a legitimate, realistic
    // case since only `dueDate` is required for a milestone). Filtering to
    // top-level tasks that actually HAVE both dates keeps this test's own
    // "moved"/"over" selection meaningful regardless of what other files in
    // the suite have added to the shared project by the time this runs.
    const datedOrder = beforeOrder.filter((t) => t.startDate && t.dueDate);
    expect(datedOrder.length).toBeGreaterThanOrEqual(2);

    // Drag the last DATED top-level task onto the first DATED one — a
    // deterministic upward drag regardless of what the prior two tests in
    // this file (or another file sharing this project) already did to the
    // order.
    const moved = datedOrder[datedOrder.length - 1];
    const over = datedOrder[0];
    expect(moved.id).not.toBe(over.id);
    // Not a vacuous null === null check — the byte-identical assertion
    // below has teeth precisely because `datedOrder` only contains tasks
    // with both dates set.
    expect(moved.startDate, "moved task has no startDate — dates check would be vacuous").not.toBeNull();
    expect(moved.dueDate, "moved task has no dueDate — dates check would be vacuous").not.toBeNull();

    await openGanttView(page, seededProject.projectId);

    // Plan B Task 8: the ReUI-engined Gantt's row-reorder grip carries
    // aria-label="Reorder" (gantt-i18n.tsx's default `labels.reorder`),
    // replacing the old hand-rolled engine's "Drag handle".
    const grip = await gripFor(page, moved.title, "Reorder");
    const overBox = await page.getByText(over.title, { exact: true }).first().boundingBox();
    expect(grip, `grip for ${moved.title} not found`).toBeTruthy();
    expect(overBox, `row for ${over.title} not found`).toBeTruthy();

    await mouseDrag(page, center(grip!), { x: overBox!.x + 60, y: overBox!.y + 8 });

    const after = await getTasks(base, seededProject.token, seededProject.projectId);
    const afterOrder = topLevelSorted(after);
    const movedIdx = afterOrder.findIndex((t) => t.id === moved.id);
    const overIdx = afterOrder.findIndex((t) => t.id === over.id);
    expect(movedIdx, "moved task not found post-drag").toBeGreaterThanOrEqual(0);
    // Dragged row lands immediately before the over row (insert-before —
    // GanttFrame.handleDragEnd row-target branch mirrors ProjectList.tsx).
    expect(overIdx).toBe(movedIdx + 1);

    // Row drags never touch dates.
    const movedAfter = afterOrder[movedIdx];
    expect(movedAfter.startDate).toBe(moved.startDate);
    expect(movedAfter.dueDate).toBe(moved.dueDate);
  });

  // T6 (docs/archive/plans/epics-spec.md §6/§7): epic chip renders on the assigned
  // row only, and the List toolbar's Epic filter narrows the visible rows
  // the same render-only way SolvroKanban.tsx's filter does — mirrors
  // kanban-dnd.spec.ts's G11 case. A drag-while-filtered assertion (also
  // covered for Kanban by G11) isn't meaningful here: narrowing to one epic
  // leaves exactly one visible top-level row, and ProjectList's DnD needs a
  // second visible row/group to drop onto — so this case stops at filter +
  // chip, as the task brief allows.
  test("epic chip + filter — renders on the tagged row only, filter narrows and clears", async ({
    page,
    seededProject,
  }) => {
    const base = apiBase(test.info());
    const token = seededProject.token;
    const projectId = seededProject.projectId;

    const current = topLevelSorted(await getTasks(base, token, projectId));
    expect(current.length, "need at least 2 top-level tasks").toBeGreaterThanOrEqual(2);
    const [tagged, other] = current;

    const epic = await createEpic(base, token, projectId, { title: "Epic T6" });
    await apiPatchTask(base, token, tagged.id, { epicId: epic.id });

    await openList(page, projectId);

    const taggedRow = desktopRow(page, tagged.title);
    const otherRow = desktopRow(page, other.title);
    await expect(taggedRow.getByTestId("epic-chip")).toBeVisible();
    await expect(taggedRow.getByTestId("epic-chip")).toHaveText(epic.title);
    await expect(otherRow.getByTestId("epic-chip")).toHaveCount(0);

    // Apply the Epic filter to this epic — the List toolbar has exactly one
    // <select> (ProjectList.tsx has no assignee/priority filter to
    // disambiguate against, unlike Kanban's popover).
    await page.getByRole("button", { name: "Filter" }).click();
    const epicSelect = page.locator("select");
    await epicSelect.selectOption(String(epic.id));
    await closeFilterPopover(page);

    // Both the desktop grid row and the `md:hidden` mobile card render for
    // the same title in the DOM at once (CSS hides whichever doesn't match
    // the viewport) — `.first()` picks the desktop variant, matching the
    // other locators in this file at the desktop project's 1440px viewport.
    await expect(page.getByText(tagged.title, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(other.title, { exact: true })).toHaveCount(0);

    // Clear the filter — every row is back.
    await page.getByRole("button", { name: "Filter" }).click();
    await page.locator("select").selectOption("");
    await closeFilterPopover(page);

    await expect(page.getByText(tagged.title, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(other.title, { exact: true }).first()).toBeVisible();
  });
});
