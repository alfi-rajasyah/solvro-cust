import {
  test,
  expect,
  loginViaUi,
  openKanban,
  gripFor,
  center,
  mouseDrag,
  touchDrag,
  apiBase,
  captureTaskRequests,
} from "../fixtures/test";
import { getTasks, setWipLimits, type SeededTask, createEpic } from "../fixtures/seed";
import type { Page } from "@playwright/test";

// Ported from the QA gate script qa-wave2.mjs, then rewritten against the
// ReUI board (docs/plans/kanban-reui-swap/plan.md, T10) per the binding
// scenario table (docs/plans/kanban-reui-swap/scenarios.md) and its e2e
// Coverage Audit (T2) section. `openKanban` (fixtures/test.ts) targets
// `KANBAN_ROUTE` ("kanban" as of the T11 cutover).
// Mouse-drag cases only make sense on the desktop project (dnd-kit
// PointerSensor); touch cases only make sense on the mobile project (dnd-kit
// TouchSensor, 250ms hold).

function byTitle<T extends { title: string }>(tasks: T[], t: string) {
  return tasks.find((x) => x.title === t);
}

// `position` is now a single per-project global order for top-level tasks
// (unified-task-ordering) — a column is a filtered subsequence of it, not
// its own sibling list. Absolute `position` values are no longer meaningful
// per column, so reorder assertions compare relative order within a column
// instead of pinning a literal index.
function columnOrder(tasks: SeededTask[], status: string): string[] {
  return tasks
    .filter((t) => t.status === status && t.parentTaskId === null)
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((t) => t.title);
}

/** Canonical global top-level order — position ascending, id ascending tiebreak. */
function byPos(a: SeededTask, b: SeededTask): number {
  return a.position - b.position || a.id - b.id;
}

function globalTopLevel(tasks: SeededTask[]): SeededTask[] {
  return tasks.filter((t) => t.parentTaskId === null).sort(byPos);
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

/** G9's fixture-setup tool (T8 scratch's `setPriority` pattern) — `Task.priority`
 * is filter-field-agnostic with `assignedToId` for the mapper's math (both only
 * narrow the RENDERED projection, never `topLevelAll`/`groupedAll`), and needs no
 * second user (CP0 decision log #2: G9 uses the priority filter, not assignee). */
async function setPriority(base: string, token: string, id: number, priority: string): Promise<void> {
  await apiPatchTask(base, token, id, { priority });
}

/** G10's fixture-setup tool: creates a fresh subtask via the API, independent
 * of whatever the RG-2/RG-3 modal-path rewrites below did to Alpha's ORIGINAL
 * seeded subtasks (Sub one/Sub two) — decouples G10's "Alpha has subtasks"
 * precondition from file-order coupling. */
async function createSubtask(
  base: string,
  token: string,
  projectId: number,
  parentTaskId: number,
  title: string,
): Promise<SeededTask> {
  const res = await fetch(`${base}/api/projects/${projectId}/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title, parentTaskId }),
  });
  if (!res.ok) {
    throw new Error(`POST /projects/${projectId}/tasks failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}


/** T10 Fix 3: the modal trio (subtask re-parent, subtask promote, G10) moved
 * off the Gantt/Timeline paths — the Gantt route never actually opened the
 * dialog (timeout waiting for the parent select) — onto `/tasks` instead,
 * whose every Row.onClick reliably opens TaskFormModal mode="edit"
 * (Tasks.tsx ~line 198 -> 181).
 *
 * T10 stabilization: `/tasks` with no filters queries unscoped `GET /tasks`,
 * which the backend windows to `take: 200` globally position/id-ordered rows
 * (backend/src/routes/tasks.ts). On a dev DB that's accumulated thousands of
 * tasks across every prior e2e/QA run, this fixture's own rows can fall
 * entirely outside that window and no matching `<tr>` ever renders. Scope
 * the page to this fixture's own customer first via the Customer filter
 * (`TasksFilter.customerId`, frontend/src/lib/queries.ts) — driven through
 * the ReUI Filters chip toolbar by the customer's display name. */
async function openTasksPage(page: Page, customerName: string): Promise<void> {
  await page.goto(`/tasks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  // The customer filter is a ReUI Filters chip flow (2026-07-31): open the
  // "+ Filter" menu, hover the Customer field to open its option submenu,
  // pick the fixture customer by exact display name.
  await page.getByRole("button", { name: /filter/i }).first().click();
  await page.getByRole("option", { name: "Customer", exact: true }).hover();
  await page.waitForTimeout(400);
  await page.getByRole("option", { name: customerName, exact: true }).click();
  await page.waitForTimeout(500);
}

/** `/tasks` lists tasks across EVERY project, and this file's generic seeded
 * titles ("Alpha", "Sub one", ...) can collide with other specs' fixture
 * projects left in the shared dev DB — so a row must be scoped to both the
 * exact title AND this test's own seeded project. `Row`'s Project cell
 * (Tasks.tsx ~line 208) renders a `<Link to={`/projects/${task.project.id}`}>`,
 * whose deterministic `href` is the disambiguator (no need to know the
 * project's display name). */
function taskRowByProject(page: Page, projectId: number, title: string) {
  return page
    .locator("tr")
    .filter({ has: page.locator(`a[href="/projects/${projectId}"]`) })
    .filter({ has: page.getByText(title, { exact: true }) });
}

/** Clicks the title cell (not the bare row, whose bounding-box center could
 * land on the Project link, which `stopPropagation`s) of the uniquely-scoped
 * row for `title` within `projectId`'s tasks. */
async function clickTaskRow(page: Page, projectId: number, title: string): Promise<void> {
  const row = taskRowByProject(page, projectId, title);
  await expect(row, `expected exactly one /tasks row for "${title}" in project ${projectId}`).toHaveCount(1);
  await row.getByText(title, { exact: true }).click();
}

/** Closes the Kanban toolbar's filter popover via its full-screen backdrop —
 * "Lessons already learned": clicking a coordinate clear of the sidebar rail
 * (x>=300) rather than re-clicking the toggle button, which the backdrop
 * (`fixed inset-0 z-10`, rendered after the button) sits on top of and would
 * intercept anyway. */
async function closeFilterPopover(page: Page): Promise<void> {
  await page.mouse.click(500, 500);
}

/** Full CARD bounding box for a title, not just the title text's own bbox
 * (`page.getByText(...).boundingBox()`). T10 stabilization finding: a card
 * can carry extra content below its title (e.g. a subtask checklist), which
 * extends the card's actual rect well past the title text's own short
 * height — an "overshoot past this card" gesture calibrated off the
 * title-only bbox can still land inside that extra content, keeping the
 * pointer over the SAME card instead of clearing it (captured as a live
 * zero-request failure when the target card had subtasks rendered inline).
 * `[data-slot="kanban-item"]` (reui/kanban.tsx) is the card's own container. */
function cardBoxFor(page: Page, title: string) {
  return page
    .locator('[data-slot="kanban-item"]')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first()
    .boundingBox();
}

test.describe("kanban drag & drop — desktop (mouse)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "mouse drag cases run on the desktop project only");
    await loginViaUi(page);
  });

  test("reorder within column: Gamma onto Alpha -> Gamma before Alpha", async ({ page, seededProject }) => {
    await openKanban(page, seededProject.projectId);

    const grip = await gripFor(page, "Gamma", "Drag to reorder");
    const alpha = await page.getByText("Alpha", { exact: true }).first().boundingBox();
    expect(grip, "grip for Gamma not found").toBeTruthy();
    expect(alpha, "Alpha card not found").toBeTruthy();

    await mouseDrag(page, center(grip!), { x: alpha!.x + 60, y: alpha!.y + 8 });

    const tasks = await getTasks(apiBase(test.info()), seededProject.token, seededProject.projectId);
    const g = byTitle(tasks, "Gamma");
    expect(g?.status).toBe("TODO");
    const order = columnOrder(tasks, "TODO");
    expect(order.indexOf("Gamma")).toBeLessThan(order.indexOf("Alpha"));
  });

  test("cross-column drag: Beta -> In Progress column", async ({ page, seededProject }) => {
    await openKanban(page, seededProject.projectId);

    const grip = await gripFor(page, "Beta", "Drag to reorder");
    const col =
      (await page.locator("h3", { hasText: "In progress" }).first().boundingBox()) ??
      (await page.getByText("In progress", { exact: true }).first().boundingBox());
    expect(grip, "grip for Beta not found").toBeTruthy();
    expect(col, "In Progress column not found").toBeTruthy();

    await mouseDrag(page, center(grip!), { x: col!.x + 60, y: col!.y + 150 });

    const tasks = await getTasks(apiBase(test.info()), seededProject.token, seededProject.projectId);
    const b = byTitle(tasks, "Beta");
    expect(b?.status).toBe("IN_PROGRESS");
    // Column-body drop = end of column (see computeCardDrop) — Beta must
    // land after every other IN_PROGRESS card, not just "somewhere in" it.
    const order = columnOrder(tasks, "IN_PROGRESS");
    expect(order).toContain("Beta");
    expect(order[order.length - 1]).toBe("Beta");
  });

  // RG-1 rewrite (T2 disposition superseded by CP0 decision log #3 + plan
  // Task 13): board-level subtask drag is retired. TaskPanel's reorder path
  // is the vendored ReUI Sortable drag handle (2026-07-30 — the Move subtask
  // up/down arrow buttons were removed); this case reorders via the handle's
  // keyboard flow (focus → Space → ArrowUp → Space), keeping the original
  // position-0 + parentTaskId assertions. Runs BEFORE the RG-2/RG-3
  // rewrites below, which move Sub one/Sub two out of Alpha's subtask list
  // entirely.
  test("subtask reorder (TaskPanel path): open Alpha's panel, move Sub two up -> pos 0", async ({
    page,
    seededProject,
  }) => {
    await openKanban(page, seededProject.projectId);

    await page.getByText("Alpha", { exact: true }).first().click();
    const panel = page.getByRole("dialog", { name: "Task details" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Sub two", { exact: true })).toBeVisible();

    // Sub one seeds at position 0, Sub two at 1 → Sub two owns the second
    // "Reorder subtask" handle in the panel's subtask list. exact: true —
    // dnd-kit also puts role="button" on each row, whose accessible name
    // CONTAINS the handle's label (docs/ISSUES.md, sortable deferred #4).
    const handles = panel.getByRole("button", { name: "Reorder subtask", exact: true });
    await expect(handles).toHaveCount(2);
    const subTwoHandle = handles.nth(1);

    const base = apiBase(test.info());

    // Keyboard drag needs per-step sync on a slow CI runner: a blind
    // ArrowUp right after Space can arrive before the keyboard sensor is
    // attached and get silently ignored (drop-in-place, no PATCH — this
    // exact flake failed CI twice). Activation is observable via dnd-kit's
    // live region turning non-empty ("Picked up …" itself is replaced
    // within a frame by the initial self-overlap "moved over" line, so
    // match no specific text). The move is observable via Sub one's row
    // being displaced with a CSS transform; retried presses are clamped at
    // the top of the list, so they are idempotent. Located by dnd-kit's
    // `DndLiveRegion-<n>` id, not by role: the panel's Copy task link button
    // has its own role="status" live region.
    const status = panel.locator('[id^="DndLiveRegion"]');
    await subTwoHandle.focus();
    await page.keyboard.press("Space");
    await expect(status).not.toBeEmpty();
    // The sortable row itself — the element dnd-kit puts the drag transform
    // on. Matched by `data-slot`, not by role+name: the row, its title
    // button and its "Rename Sub one" button all expose an accessible name
    // containing "Sub one", so a `getByRole("button", { name: /Sub one/ })`
    // resolves to three elements and trips strict mode.
    const subOneRow = panel.locator('[data-slot="sortable-item"]', { hasText: "Sub one" });
    await expect(async () => {
      await page.keyboard.press("ArrowUp");
      // Displacement = non-zero translate-Y. During a drag EVERY row gets a
      // transform (identity matrix at rest), so match a non-zero final
      // component specifically.
      await expect(subOneRow).toHaveCSS("transform", /matrix\(1, 0, 0, 1, 0, -?[1-9]/, {
        timeout: 500,
      });
    }).toPass({ timeout: 10_000 });
    await page.keyboard.press("Space");
    await expect
      .poll(
        async () => {
          const tasks = await getTasks(base, seededProject.token, seededProject.projectId);
          return byTitle(tasks, "Sub two")?.position;
        },
        { timeout: 10_000 },
      )
      .toBe(0);
    const tasks = await getTasks(base, seededProject.token, seededProject.projectId);
    expect(byTitle(tasks, "Sub two")?.parentTaskId).toBe(seededProject.alpha.id);
  });

  test("WIP badge shows over-limit count in TODO column", async ({ page, seededProject }) => {
    const base = apiBase(test.info());
    await setWipLimits(base, seededProject.token, seededProject.projectId, {
      TODO: 1,
      IN_PROGRESS: null,
      DONE: null,
    });
    await openKanban(page, seededProject.projectId);

    const tasks = await getTasks(base, seededProject.token, seededProject.projectId);
    const todoCount = tasks.filter((x) => x.status === "TODO" && x.parentTaskId === null).length;

    await expect(page.getByText(`${todoCount} / 1`).first()).toBeVisible();
  });

  // G6 (scenarios.md CC-3): must run before DONE gets a real member — the
  // subtask-promote rewrite below (RG-3) is the first thing that puts a task
  // into DONE, so this genuinely-empty-column case runs first.
  test("G6: cross-column drop into a genuinely empty column omits `position` (CC-3)", async ({
    page,
    seededProject,
  }) => {
    const base = apiBase(test.info());
    await openKanban(page, seededProject.projectId);

    const before = await getTasks(base, seededProject.token, seededProject.projectId);
    const doneCount = before.filter((t) => t.status === "DONE" && t.parentTaskId === null).length;
    expect(doneCount, "DONE must be genuinely empty for this case").toBe(0);

    const source = globalTopLevel(before).find((t) => t.status !== "DONE");
    expect(source, "need a non-DONE top-level task to drag").toBeTruthy();

    const grip = await gripFor(page, source!.title, "Drag to reorder");
    const doneHdr = await page.locator("h3", { hasText: /done/i }).first().boundingBox();
    expect(grip, `grip for ${source!.title} not found`).toBeTruthy();
    expect(doneHdr, "Done column header not found").toBeTruthy();

    const requests = await captureTaskRequests(page, async () => {
      await mouseDrag(page, center(grip!), { x: doneHdr!.x + 90, y: doneHdr!.y + 160 });
    });

    expect(requests.length).toBe(1);
    const body = requests[0].body;
    expect(body).toBeTruthy();
    expect(body?.status).toBe("DONE");
    expect(Object.prototype.hasOwnProperty.call(body ?? {}, "position")).toBe(false);

    const after = await getTasks(base, seededProject.token, seededProject.projectId);
    expect(byTitle(after, source!.title)?.status).toBe("DONE");
  });

  test("G1: cross-column card-to-card drop lands the moved card immediately before the target (CC-1)", async ({
    page,
    seededProject,
  }) => {
    const base = apiBase(test.info());

    // T10 Fix 4: pin a deterministic fixture before dragging, exactly like
    // the G9 trio does below — this case previously trusted whatever cascade
    // of earlier tests (G6, etc.) left the shared worker-scoped project's
    // global order as, which only reliably passed when a Playwright retry
    // spun up a fresh worker (and therefore a fresh `seededProject`, since
    // that fixture is worker-scoped) rather than continuing to mutate the
    // same one. Repacking on each sequential PATCH guarantees the exact
    // order regardless of what earlier tests left behind.
    //
    // T10 stabilization finding: pinning only 3 of the project's top-level
    // tasks and leaving any remaining ones untouched is NOT enough — this
    // project always has 4 top-level tasks (Alpha/Beta/Gamma/Delta), and
    // whichever one isn't pinned keeps whatever TODO/IN_PROGRESS status
    // earlier tests (or an unrelated dispatch ordering) left it in. Captured
    // as a live failure: a 4th unpinned task that was still TODO left the
    // TODO column with 3 cards instead of 2, and the mouse-overshoot gesture
    // below (calibrated for exactly one distractor-free target) skipped past
    // it, landing one slot too far (position 2 instead of 1). Sweep every
    // OTHER top-level task into IN_PROGRESS too (status only, no explicit
    // position — their exact slot doesn't matter, only that none of them sit
    // in TODO) so the column has exactly one member — `pinnedTodo` — before
    // the drag, and exactly two after.
    const pinCandidates = globalTopLevel(await getTasks(base, seededProject.token, seededProject.projectId));
    expect(pinCandidates.length, "need at least 3 top-level tasks").toBeGreaterThanOrEqual(3);
    const [pinnedTodo, pinnedMover, pinnedOther, ...pinnedRest] = pinCandidates;
    await apiPatchTask(base, seededProject.token, pinnedTodo.id, { status: "TODO", position: 0 });
    await apiPatchTask(base, seededProject.token, pinnedMover.id, { status: "IN_PROGRESS", position: 1 });
    await apiPatchTask(base, seededProject.token, pinnedOther.id, { status: "IN_PROGRESS", position: 2 });
    for (const extra of pinnedRest) {
      await apiPatchTask(base, seededProject.token, extra.id, { status: "IN_PROGRESS" });
    }

    await openKanban(page, seededProject.projectId);

    const before = await globalTopLevel(await getTasks(base, seededProject.token, seededProject.projectId));
    const todoFirst = before.find((t) => t.status === "TODO");
    const nonTodo = before.find((t) => t.status !== "TODO");
    expect(todoFirst, "need a TODO task").toBeTruthy();
    expect(nonTodo, "need a non-TODO task").toBeTruthy();
    expect(todoFirst?.id, "todoFirst must be the pinned TODO task").toBe(pinnedTodo.id);
    expect(nonTodo?.id, "nonTodo must be the pinned mover task").toBe(pinnedMover.id);

    const grip = await gripFor(page, nonTodo!.title, "Drag to reorder");
    const targetBox = await page.getByText(todoFirst!.title, { exact: true }).first().boundingBox();
    expect(grip, `grip for ${nonTodo!.title} not found`).toBeTruthy();
    expect(targetBox, `${todoFirst!.title} card not found`).toBeTruthy();

    // Payload capture (T10 hardening): derived from `before` via the exact
    // math `resolvePosition`'s successor branch uses (no predecessor, since
    // nonTodo lands first in the committed TODO column; successor is
    // todoFirst) — makes a geometry miss diagnosable (wrong request count or
    // body) instead of only failing the relative-order assertion below.
    const movedExcludedGlobal = before.filter((t) => t.id !== nonTodo!.id);
    const expectedPosition = movedExcludedGlobal.findIndex((t) => t.id === todoFirst!.id);
    expect(expectedPosition, "todoFirst must exist in the moved-excluded global order").toBeGreaterThanOrEqual(0);

    // Resolved Phase 1 review addendum (2026-07-27): cross-column card-to-card
    // drops always commit "insert before" regardless of which half of the
    // over-card the pointer releases over. T10: aim at the target card's
    // vertical CENTER, not a near-edge offset — a drop that close to a card's
    // top edge (particularly when it's the column's own first card) risks
    // dnd-kit's rectIntersection occasionally resolving `over` to the column
    // itself instead of the card, which was this case's source of flake.
    const requests = await captureTaskRequests(page, async () => {
      await mouseDrag(page, center(grip!), { x: targetBox!.x + 60, y: targetBox!.y + targetBox!.height / 2 });
    });

    expect(requests.length).toBe(1);
    expect(requests[0].body).toEqual({ status: "TODO", position: expectedPosition });

    const after = globalTopLevel(await getTasks(base, seededProject.token, seededProject.projectId));
    const titles = after.map((t) => t.title);
    expect(titles.indexOf(nonTodo!.title)).toBe(titles.indexOf(todoFirst!.title) - 1);
    expect(byTitle(after, nonTodo!.title)?.status).toBe("TODO");
  });

  test("G2: same-column downward one-slot drop must not no-op (SC-2)", async ({ page, seededProject }) => {
    const base = apiBase(test.info());
    await openKanban(page, seededProject.projectId);

    const before = globalTopLevel(await getTasks(base, seededProject.token, seededProject.projectId));
    const todoSorted = before.filter((t) => t.status === "TODO");
    expect(todoSorted.length, "need at least two TODO tasks").toBeGreaterThanOrEqual(2);
    const [moved, target] = todoSorted;
    const movedIndexBefore = before.findIndex((t) => t.id === moved.id);

    const grip = await gripFor(page, moved.title, "Drag to reorder");
    // T10 stabilization: the FULL card box (`cardBoxFor`), not just the
    // title text's own bbox — see its doc comment. Load-bearing for the
    // overshoot gesture below when `target` carries extra content (e.g. a
    // subtask checklist) that extends its rect well past the title line.
    const targetBox = await cardBoxFor(page, target.title);
    expect(grip, `grip for ${moved.title} not found`).toBeTruthy();
    expect(targetBox, `${target.title} card not found`).toBeTruthy();

    // Payload capture (T10 hardening): once dropped, moved lands directly
    // AFTER target in the committed column, so its predecessor is target
    // itself — `resolvePosition`'s predecessor branch: findIndex(target) in
    // the moved-excluded global order, +1.
    const movedExcludedGlobal = before.filter((t) => t.id !== moved.id);
    const expectedPosition = movedExcludedGlobal.findIndex((t) => t.id === target.id) + 1;

    // T10 stabilization: mouse geometry alone is inherently ambiguous for a
    // one-slot downward move — dnd-kit's live dragOver preview reshuffles
    // the column as the pointer arrives, and if the drop's `over` resolves
    // back onto the now-displaced card, the vendor's own same-container
    // `arrayMove` swap cancels the move outright (zero PATCH — the captured
    // failure this fix addresses).
    //
    // The prescribed fix is a KEYBOARD drag — dnd-kit's KeyboardSensor +
    // sortableKeyboardCoordinates ARE wired in reui/kanban.tsx (`useSensors`
    // includes `useSensor(KeyboardSensor, ...)`), and `KeyboardSensor
    // .activators` is `[{ eventName: "onKeyDown", ... }]`. Investigated
    // interactively against the running dev server before writing this:
    // `attributes` (role="button", tabIndex=0 — what makes an element
    // focusable/Tab-reachable) is spread only onto `KanbanItem`'s OUTER
    // wrapper (reui/kanban.tsx ~line 796, `[data-slot="kanban-item"]`),
    // while `listeners` (the actual onKeyDown activator) reaches only
    // `KanbanItemHandle` via `ItemContext` (~line 838) and carries no
    // tabIndex/role of its own. Confirmed via direct DOM inspection: the
    // handle (`[aria-label="Drag to reorder"]`) has neither `tabindex` nor
    // `role`, so it can never become `document.activeElement` — clicking it
    // moves focus to the outer item wrapper instead, and pressing Space
    // there never sets `data-dragging` because the wrapper has no onKeyDown
    // listener. With `attributes` and `listeners` split across two different
    // DOM nodes, no real keyboard interaction (Tab, click-then-Space) can
    // ever reach the sensor's activator — keyboard drag is a dead end here,
    // not a gesture-timing issue. Falling back to the prescribed mouse
    // alternative: drag PAST the target's card so the pointer lands solidly
    // below the post-reshuffle boundary rather than riding it.
    //
    // T10 stabilization: a height-*multiplied* overshoot (originally 1.5x)
    // doesn't scale safely — against a real 3-card TODO column where the
    // 3rd (distractor) card was tall (inline subtask checklist), 1.5x of a
    // short target's card cleared the target but still landed inside the
    // distractor below it (captured live: position 2 instead of 1, i.e. the
    // drop skipped past both cards). A small FIXED clearance past the
    // target's FULL card box (`cardBoxFor`, not just its title text) proved
    // robust instead: verified across offsets 5-30px against both a 3-card
    // column with a tall distractor and a plain 2-card column, all landing
    // correctly with exactly one PATCH; 20px is comfortably inside that
    // working range.
    const requests = await captureTaskRequests(page, async () => {
      await mouseDrag(page, center(grip!), {
        x: targetBox!.x + 60,
        y: targetBox!.y + targetBox!.height + 20,
      });
    });

    expect(requests.length).toBe(1);
    expect(requests[0].body).toEqual({ status: "TODO", position: expectedPosition });

    const after = globalTopLevel(await getTasks(base, seededProject.token, seededProject.projectId));
    const movedIndexAfter = after.findIndex((t) => t.id === moved.id);
    const targetIndexAfter = after.findIndex((t) => t.id === target.id);
    expect(movedIndexAfter).toBeGreaterThan(movedIndexBefore);
    expect(movedIndexAfter).toBeGreaterThan(targetIndexAfter);
  });

  test("G3: drop-in-place fires no request (SC-3/NO-1)", async ({ page, seededProject }) => {
    const base = apiBase(test.info());
    await openKanban(page, seededProject.projectId);

    const tasks = globalTopLevel(await getTasks(base, seededProject.token, seededProject.projectId));
    const target = tasks[0];
    expect(target, "need at least one top-level task").toBeTruthy();

    const grip = await gripFor(page, target.title, "Drag to reorder");
    expect(grip, `grip for ${target.title} not found`).toBeTruthy();

    const requests = await captureTaskRequests(page, async () => {
      // Pointer never leaves the grip's own rect — below the vendor's mouse
      // sensor activation distance (10px, reui/kanban.tsx MOUSE_SENSOR_OPTIONS)
      // so no drag ever registers, matching SC-3's "pointer inside original
      // rect" case.
      await page.mouse.move(grip!.x, grip!.y);
      await page.mouse.down();
      await page.mouse.move(grip!.x + 2, grip!.y + 1);
      await page.waitForTimeout(150);
      await page.mouse.up();
    });

    expect(requests.length).toBe(0);
  });

  test("G4: already-last card dropped onto its own column body fires no request (NO-2)", async ({
    page,
    seededProject,
  }) => {
    const base = apiBase(test.info());
    await openKanban(page, seededProject.projectId);

    const tasks = globalTopLevel(await getTasks(base, seededProject.token, seededProject.projectId));
    const todoSorted = tasks.filter((t) => t.status === "TODO");
    expect(todoSorted.length, "need at least one TODO task").toBeGreaterThanOrEqual(1);
    const last = todoSorted[todoSorted.length - 1];

    const grip = await gripFor(page, last.title, "Drag to reorder");
    const lastBox = await page.getByText(last.title, { exact: true }).first().boundingBox();
    expect(grip, `grip for ${last.title} not found`).toBeTruthy();
    expect(lastBox, `${last.title} card not found`).toBeTruthy();

    const requests = await captureTaskRequests(page, async () => {
      await mouseDrag(page, center(grip!), { x: lastBox!.x + 40, y: lastBox!.y + lastBox!.height + 50 });
    });

    expect(requests.length).toBe(0);
  });

  test("G5: Escape mid-drag cancels with no request and unchanged DOM order (NO-3)", async ({
    page,
    seededProject,
  }) => {
    const base = apiBase(test.info());
    await openKanban(page, seededProject.projectId);

    const tasks = globalTopLevel(await getTasks(base, seededProject.token, seededProject.projectId));
    const todoSorted = tasks.filter((t) => t.status === "TODO");
    expect(todoSorted.length, "need at least two TODO tasks").toBeGreaterThanOrEqual(2);
    const [moved, target] = todoSorted;

    const yBefore: Record<string, number> = {};
    for (const t of todoSorted) {
      const box = await page.getByText(t.title, { exact: true }).first().boundingBox();
      expect(box, `${t.title} not found before drag`).toBeTruthy();
      yBefore[t.title] = box!.y;
    }
    const orderBefore = Object.entries(yBefore)
      .sort((a, b) => a[1] - b[1])
      .map(([title]) => title);

    const grip = await gripFor(page, moved.title, "Drag to reorder");
    const targetBox = await page.getByText(target.title, { exact: true }).first().boundingBox();
    expect(grip, `grip for ${moved.title} not found`).toBeTruthy();
    expect(targetBox, `${target.title} card not found`).toBeTruthy();

    const requests = await captureTaskRequests(page, async () => {
      const from = center(grip!);
      const to = { x: targetBox!.x + 60, y: targetBox!.y + targetBox!.height };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
        await page.waitForTimeout(35);
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await page.mouse.up();
    });

    expect(requests.length).toBe(0);

    const yAfter: Record<string, number> = {};
    for (const t of todoSorted) {
      const box = await page.getByText(t.title, { exact: true }).first().boundingBox();
      expect(box, `${t.title} not found after escape`).toBeTruthy();
      yAfter[t.title] = box!.y;
    }
    const orderAfter = Object.entries(yAfter)
      .sort((a, b) => a[1] - b[1])
      .map(([title]) => title);
    expect(orderAfter).toEqual(orderBefore);
  });

  // G9 trio (CP0 decision log #2: priority filter, not assignee — identical
  // hidden-cards code path, no second-user fixture surface needed). Each
  // sub-case explicitly pins its own 3-task fixture via direct API PATCHes
  // (status + position) before setting priorities, rather than trusting
  // whatever the earlier gap cases left the shared project's global order
  // as — decouples these from file-order/position bookkeeping.
  test("G9a: priority filter — hidden card between two visible neighbors still shifts correctly (FA-1-shape)", async ({
    page,
    seededProject,
  }) => {
    const base = apiBase(test.info());
    const token = seededProject.token;
    const projectId = seededProject.projectId;

    const current = globalTopLevel(await getTasks(base, token, projectId));
    expect(current.length, "need at least 3 top-level tasks").toBeGreaterThanOrEqual(3);
    const [v1, hidden, v2, ...rest] = current;

    // Pin v1, hidden, v2 into consecutive global slots [0,1,2], all TODO —
    // repacking on each sequential PATCH guarantees the exact order
    // regardless of what earlier gap cases left the project's global order as.
    await apiPatchTask(base, token, v1.id, { status: "TODO", position: 0 });
    await apiPatchTask(base, token, hidden.id, { status: "TODO", position: 1 });
    await apiPatchTask(base, token, v2.id, { status: "TODO", position: 2 });
    // T10 stabilization: this project always has 4 top-level tasks, so
    // `current` has exactly one more beyond [v1, hidden, v2] — sweep it (and
    // any others) out of TODO the same way G9b already does below, or it can
    // sit as an unaccounted-for extra TODO card and shift the mouse-overshoot
    // gesture's landing slot (captured as a live failure: an unswept 4th TODO
    // card pushed the drop one slot further than expected, and the drag
    // itself failed to register at all in a run where the extra card sat
    // ahead of v1, throwing off the "first visible card" geometry).
    for (const extra of rest) {
      await apiPatchTask(base, token, extra.id, { status: "IN_PROGRESS" });
    }

    await setPriority(base, token, v1.id, "LOW");
    await setPriority(base, token, v2.id, "LOW");
    await setPriority(base, token, hidden.id, "HIGH");

    await openKanban(page, projectId);
    await page.getByRole("button", { name: "Filter" }).click();
    const prioritySelect = page.locator("select").filter({ has: page.getByRole("option", { name: "Any priority" }) });
    await prioritySelect.selectOption("LOW");
    await closeFilterPopover(page);

    await expect(page.getByText(hidden.title, { exact: true })).toHaveCount(0);
    // T10 stabilization finding: the true root cause of this case's flake
    // wasn't drop geometry at all — `dnd-kit`'s `animateLayoutChanges`
    // applies a CSS transition to the remaining cards as they slide into
    // place once the filtered-out `hidden` card leaves the DOM, and
    // `toHaveCount(0)` above only proves `hidden` is gone, not that this
    // reflow has finished settling. Measuring `grip`/`v1Box` before that
    // transition completes captures a mid-flight (not final) position;
    // by the time the drag itself plays out ~800ms later, the layout has
    // already reached its true rest state, so the drop lands off-target.
    // Confirmed live: the exact same offset failed and succeeded across
    // otherwise-identical runs of this case, and looping the gesture with
    // an added settle pause here made every offset in a 0-82px sweep pass
    // consistently — a settle wait, not a geometry tweak, was the fix.
    await page.waitForTimeout(400);

    const grip = await gripFor(page, v2.title, "Drag to reorder");
    // T10 stabilization: FULL card box (`cardBoxFor`) — v1 is picked
    // dynamically from whatever top-level tasks exist and can land on a
    // card with extra content (e.g. Alpha's subtask checklist), which the
    // upward overshoot below must clear entirely, not just its title line.
    const v1Box = await cardBoxFor(page, v1.title);
    expect(grip, `grip for ${v2.title} not found`).toBeTruthy();
    expect(v1Box, `${v1.title} card not found`).toBeTruthy();

    // T10 stabilization: same one-slot mouse-geometry ambiguity as G2 (see
    // its comment above for the full root cause and the interactive
    // keyboard investigation) — this case moves upward instead of down, so
    // it's the mirror of G2's fallback: a small fixed clearance above v1's
    // own FULL card box (`cardBoxFor`) lands the pointer past the
    // post-reshuffle boundary. Verified against both a plain v1 and a tall
    // (subtask-bearing) v1, with the settle wait above in place: this
    // produces exactly one PATCH with v2 landing immediately before v1.
    // Payload capture: v2 becomes the committed column's FIRST item (no
    // predecessor), successor is v1 — `resolvePosition`'s successor branch
    // anchors on v1's own (unfiltered) global index, which is 0 (pinned
    // above) — derived literal: `{ status: "TODO", position: 0 }`.
    const requests = await captureTaskRequests(page, async () => {
      await mouseDrag(page, center(grip!), {
        x: v1Box!.x + 60,
        y: v1Box!.y - 20,
      });
    });

    expect(requests.length).toBe(1);
    expect(requests[0].body).toEqual({ status: "TODO", position: 0 });

    const after = globalTopLevel(await getTasks(base, token, projectId));
    const titles = after.map((t) => t.title);
    const iV1 = titles.indexOf(v1.title);
    const iV2 = titles.indexOf(v2.title);
    const iHidden = titles.indexOf(hidden.title);
    // v2 lands immediately before v1, and the never-rendered hidden card
    // still correctly shifts to immediately after v1 — proving it
    // participated in the global math despite never being on screen.
    expect(iV2).toBe(iV1 - 1);
    expect(iHidden).toBe(iV1 + 1);
  });

  test("G9b: priority filter — column-body drop lands after the hidden TRUE-last member, not the last visible one (FA-5-shape)", async ({
    page,
    seededProject,
  }) => {
    const base = apiBase(test.info());
    const token = seededProject.token;
    const projectId = seededProject.projectId;

    const current = globalTopLevel(await getTasks(base, token, projectId));
    expect(current.length, "need at least 3 top-level tasks").toBeGreaterThanOrEqual(3);
    const [visibleOther, hiddenLast, source, ...rest] = current;

    // TODO must contain EXACTLY [visibleOther, hiddenLast] (hiddenLast the
    // TRUE last member) — force every other top-level task out of TODO.
    await apiPatchTask(base, token, visibleOther.id, { status: "TODO", position: 0 });
    await apiPatchTask(base, token, hiddenLast.id, { status: "TODO", position: 1 });
    await apiPatchTask(base, token, source.id, { status: "IN_PROGRESS" });
    for (const extra of rest) {
      await apiPatchTask(base, token, extra.id, { status: "IN_PROGRESS" });
    }

    await setPriority(base, token, hiddenLast.id, "URGENT");
    await setPriority(base, token, visibleOther.id, "LOW");
    await setPriority(base, token, source.id, "LOW");

    await openKanban(page, projectId);
    await page.getByRole("button", { name: "Filter" }).click();
    const prioritySelect = page.locator("select").filter({ has: page.getByRole("option", { name: "Any priority" }) });
    await prioritySelect.selectOption("LOW");
    await closeFilterPopover(page);

    await expect(page.getByText(hiddenLast.title, { exact: true })).toHaveCount(0);
    // T10 stabilization: same settle wait as G9a above — let the remaining
    // cards' post-filter reflow transition (`animateLayoutChanges`) finish
    // before measuring geometry, not just before the drag starts.
    await page.waitForTimeout(400);

    const grip = await gripFor(page, source.title, "Drag to reorder");
    const lastVisibleBox = await page.getByText(visibleOther.title, { exact: true }).first().boundingBox();
    expect(grip, `grip for ${source.title} not found`).toBeTruthy();
    expect(lastVisibleBox, `${visibleOther.title} card not found`).toBeTruthy();

    // Payload capture (T10 hardening): fresh snapshot AFTER pinning above —
    // `Task.position` is one canonical GLOBAL order across every status
    // (CLAUDE.md), so the position pins on visibleOther/hiddenLast can shift
    // OTHER tasks' global slots too; re-reading right before the drag is the
    // actual ground truth `mapCommitToPatch` computes against, not a
    // hand-derived literal. Expected position mirrors
    // `columnAppendPosition`'s own math: index of hiddenLast (the TRUE last
    // TODO member) in the moved-excluded global order, + 1.
    const pinned = globalTopLevel(await getTasks(base, token, projectId));
    const movedExcludedGlobal = pinned.filter((t) => t.id !== source.id);
    const expectedPosition = movedExcludedGlobal.findIndex((t) => t.id === hiddenLast.id) + 1;
    expect(expectedPosition, "hiddenLast must exist in the moved-excluded global order").toBeGreaterThan(0);

    // T10 stabilization: a +150px drop below the last VISIBLE card still
    // rect-overlapped that card's own bounding box, so dnd-kit's
    // rectIntersection resolved `over` to the CARD, not the column — which
    // the mapper's card-drop path correctly reads as "insert after
    // visibleOther" (position 1), not "append after the true last member"
    // (the captured failure this fix addresses). The refined mapper is
    // correct for genuine card-drops; this case needs a genuine COLUMN-space
    // drop so the append signal (`over.id === "TODO"`) actually fires.
    // Columns are full-height now (`md:h-full`, SolvroKanban.tsx), so target
    // the column's OWN bottom padding via its
    // `[data-slot="kanban-column"][data-value="TODO"]` bounding box — well
    // clear of any card rect, regardless of how many cards are visible.
    // Verified against a live fixture (visibleOther/hiddenLast/source): this
    // produces exactly one PATCH anchored on hiddenLast (the true last
    // member), not visibleOther.
    const todoColumn = page.locator('[data-slot="kanban-column"][data-value="TODO"]');
    const columnBox = await todoColumn.boundingBox();
    expect(columnBox, "TODO column not found").toBeTruthy();

    const requests = await captureTaskRequests(page, async () => {
      await mouseDrag(page, center(grip!), {
        x: columnBox!.x + columnBox!.width / 2,
        y: columnBox!.y + columnBox!.height - 40,
      });
    });

    expect(requests.length).toBe(1);
    expect(requests[0].body).toEqual({ status: "TODO", position: expectedPosition });

    const after = globalTopLevel(await getTasks(base, token, projectId));
    const titles = after.map((t) => t.title);
    expect(titles.indexOf(source.title)).toBe(titles.indexOf(hiddenLast.title) + 1);
    expect(byTitle(after, source.title)?.status).toBe("TODO");
  });

  test("G9c: priority filter — drop-in-place still fires no request", async ({ page, seededProject }) => {
    const base = apiBase(test.info());
    const token = seededProject.token;
    const projectId = seededProject.projectId;

    const current = globalTopLevel(await getTasks(base, token, projectId));
    const target = current[0];
    expect(target, "need at least one top-level task").toBeTruthy();
    await setPriority(base, token, target.id, "MEDIUM");

    await openKanban(page, projectId);
    await page.getByRole("button", { name: "Filter" }).click();
    const prioritySelect = page.locator("select").filter({ has: page.getByRole("option", { name: "Any priority" }) });
    await prioritySelect.selectOption("MEDIUM");
    await closeFilterPopover(page);

    const grip = await gripFor(page, target.title, "Drag to reorder");
    expect(grip, `grip for ${target.title} not found`).toBeTruthy();

    const requests = await captureTaskRequests(page, async () => {
      await page.mouse.move(grip!.x, grip!.y);
      await page.mouse.down();
      await page.mouse.move(grip!.x + 2, grip!.y + 1);
      await page.waitForTimeout(150);
      await page.mouse.up();
    });

    expect(requests.length).toBe(0);
  });

  // G11 (docs/archive/plans/epics-spec.md §6/§7 T5): epic chip renders on the
  // assigned card only, the toolbar's Epic filter narrows the visible set
  // the same render-only way assignee/priority do, and a cross-column drag
  // taken while that filter is active still derives its drop math from
  // `topLevelAll` (unfiltered) — the position/status it commits survives a
  // reload just like an unfiltered drag would.
  test("G11: epic chip + filter — renders on the assigned card only, narrows visible cards, and a filtered drag persists after reload", async ({
    page,
    seededProject,
  }) => {
    const base = apiBase(test.info());
    const token = seededProject.token;
    const projectId = seededProject.projectId;

    const current = globalTopLevel(await getTasks(base, token, projectId));
    expect(current.length, "need at least 2 top-level tasks").toBeGreaterThanOrEqual(2);
    const [tagged, other, ...rest] = current;

    // Pin a clean, deterministic starting state: `tagged` alone in TODO (so
    // the cross-column drag below has somewhere to go and the filtered TODO
    // column shows exactly one card), everything else swept into
    // IN_PROGRESS.
    await apiPatchTask(base, token, tagged.id, { status: "TODO" });
    for (const t of [other, ...rest]) {
      await apiPatchTask(base, token, t.id, { status: "IN_PROGRESS" });
    }

    const epic = await createEpic(base, token, projectId, { title: "Epic G11" });
    await apiPatchTask(base, token, tagged.id, { epicId: epic.id });

    await openKanban(page, projectId);

    const taggedCard = page
      .locator('[data-slot="kanban-item"]')
      .filter({ has: page.getByText(tagged.title, { exact: true }) });
    const otherCard = page
      .locator('[data-slot="kanban-item"]')
      .filter({ has: page.getByText(other.title, { exact: true }) });
    await expect(taggedCard.getByTestId("epic-chip")).toBeVisible();
    await expect(taggedCard.getByTestId("epic-chip")).toHaveText(epic.title);
    await expect(otherCard.getByTestId("epic-chip")).toHaveCount(0);

    // Apply the Epic filter to this epic — the "No epic" option is unique to
    // this select, disambiguating it from the Assignee/Priority selects.
    await page.getByRole("button", { name: "Filter" }).click();
    const epicSelect = page
      .locator("select")
      .filter({ has: page.getByRole("option", { name: "No epic" }) });
    await epicSelect.selectOption(String(epic.id));
    await closeFilterPopover(page);

    await expect(page.getByText(tagged.title, { exact: true })).toBeVisible();
    await expect(page.getByText(other.title, { exact: true })).toHaveCount(0);

    // Drag the only visible (filtered) card cross-column — drop math must
    // still derive from `topLevelAll`, per SolvroKanban.tsx's `isTaskVisible`
    // comments.
    const grip = await gripFor(page, tagged.title, "Drag to reorder");
    const col =
      (await page.locator("h3", { hasText: "In progress" }).first().boundingBox()) ??
      (await page.getByText("In progress", { exact: true }).first().boundingBox());
    expect(grip, `grip for ${tagged.title} not found`).toBeTruthy();
    expect(col, "In Progress column not found").toBeTruthy();

    await mouseDrag(page, center(grip!), { x: col!.x + 60, y: col!.y + 150 });

    const afterDrag = await getTasks(base, token, projectId);
    expect(byTitle(afterDrag, tagged.title)?.status).toBe("IN_PROGRESS");

    // Reload (filter state resets — it's local component state, not a URL
    // param) and confirm the status committed by the filtered drag persisted
    // server-side and renders correctly once more, unfiltered.
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const afterReload = await getTasks(base, token, projectId);
    expect(byTitle(afterReload, tagged.title)?.status).toBe("IN_PROGRESS");
    const reloadedCard = page
      .locator('[data-slot="kanban-item"]')
      .filter({ has: page.getByText(tagged.title, { exact: true }) });
    await expect(reloadedCard).toBeVisible();
    await expect(reloadedCard.getByTestId("epic-chip")).toHaveText(epic.title);
  });

  // RG-2 rewrite (T10 follow-up): board-level subtask re-parent is retired;
  // the modal-path replacement is TaskFormModal's Parent field. Originally
  // reached via the Gantt tree, but that path never actually opened the
  // dialog in practice (timeout waiting for the parent select) — rewritten
  // onto `/tasks` (Tasks.tsx), whose default filter is `topLevel: true`
  // (line 26) so the "Top-level only" checkbox must be unchecked first to
  // reveal Sub one's row; every Row.onClick opens TaskFormModal mode="edit"
  // regardless of whether the task is top-level.
  test("subtask re-parent (modal path via Tasks): Sub one's Parent set to Delta", async ({
    page,
    seededProject,
  }) => {
    const base = apiBase(test.info());
    await openTasksPage(page, seededProject.customerName);

    await page.getByRole("checkbox", { name: "Top-level only" }).uncheck();
    await page.waitForTimeout(500);

    await clickTaskRow(page, seededProject.projectId, "Sub one");
    const dialog = page.getByRole("dialog", { name: "Edit task" });
    await expect(dialog).toBeVisible();

    // T10 stabilization finding: `.filter({ has: dialog.getByRole("option",
    // ...) })` hangs indefinitely on this page — `GET /users`
    // (backend/src/routes/users.ts) returns every accumulated test user with
    // no pagination (thousands, accrued across this repo's e2e/QA history),
    // and the Assignee field (FieldRow above Parent) renders every one as an
    // `<option>`. `getByRole("option", ...)` resolves via the browser's
    // accessibility tree, and evaluating that role query anywhere on a page
    // holding a `<select>` that large never completes in practice (confirmed
    // live against the real dev DB: even a 30s timeout wasn't enough). A pure
    // CSS `:has()` — native browser matching, no accessibility-tree walk —
    // scoped to the Parent field's own row (`FieldRow`'s fixed wrapper
    // structure, TaskFormModal.tsx ~511) sidesteps it entirely and resolves
    // in well under a second.
    const parentSelect = dialog.locator('div.flex.items-center.gap-3:has(span:text-is("Parent")) select');
    await parentSelect.selectOption(String(seededProject.delta.id));

    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(600);

    const tasks = await getTasks(base, seededProject.token, seededProject.projectId);
    const s = byTitle(tasks, "Sub one");
    expect(s?.parentTaskId).toBe(seededProject.delta.id);
  });

  // RG-3 rewrite (T10 follow-up): same modal path via `/tasks` (see the
  // comment above), clearing Parent to top-level. MUST preserve the
  // load-bearing GLOBAL-order assertion (ported verbatim in spirit from the
  // retired drag-based case) — this is what actually pins the
  // unified-task-ordering fix (append at the GLOBAL end via `insertAt`'s
  // `undefined` handling, not the front), since a modal-driven parent change
  // never sends a `position` key (TaskFormModal.tsx's patch object literal).
  test("subtask promote (modal path via Tasks): Sub two's Parent cleared to top-level, status set to Done", async ({
    page,
    seededProject,
  }) => {
    const base = apiBase(test.info());
    const before = await getTasks(base, seededProject.token, seededProject.projectId);
    const othersBefore = globalTopLevel(before)
      .filter((t) => t.title !== "Sub two")
      .map((t) => t.title);

    await openTasksPage(page, seededProject.customerName);
    await page.getByRole("checkbox", { name: "Top-level only" }).uncheck();
    await page.waitForTimeout(500);

    await clickTaskRow(page, seededProject.projectId, "Sub two");
    const dialog = page.getByRole("dialog", { name: "Edit task" });
    await expect(dialog).toBeVisible();

    // T10 stabilization: CSS `:has()`, not `.filter({ has: dialog.getByRole
    // ("option", ...) }) — see the first "subtask re-parent" test above for
    // why the getByRole form hangs indefinitely on this page.
    const parentSelect = dialog.locator('div.flex.items-center.gap-3:has(span:text-is("Parent")) select');
    await parentSelect.selectOption("");

    const statusSelect = dialog.locator('div.flex.items-center.gap-3:has(span:text-is("Status")) select');
    await statusSelect.selectOption("DONE");

    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(600);

    const tasks = await getTasks(base, seededProject.token, seededProject.projectId);
    const s = byTitle(tasks, "Sub two");
    expect(s?.parentTaskId).toBeNull();
    expect(s?.status).toBe("DONE");

    const doneOrder = columnOrder(tasks, "DONE");
    expect(doneOrder[doneOrder.length - 1]).toBe("Sub two");

    const othersAfter = globalTopLevel(tasks)
      .filter((t) => t.title !== "Sub two")
      .map((t) => t.title);
    expect(othersAfter).toEqual(othersBefore);

    // The assertion that actually pins the fix: the promoted task must be
    // last in the GLOBAL top-level order, not merely last within its
    // (currently single-card) DONE column.
    const globalTitles = globalTopLevel(tasks).map((t) => t.title);
    expect(globalTitles[globalTitles.length - 1]).toBe("Sub two");
  });

  // G10 (RG-5 in scenarios.md): the reachable form of `max_depth_exceeded`
  // through the UI — giving a parent to a task that already has subtasks.
  // Creates its own temporary subtask of Alpha so this case's precondition
  // ("Alpha has subtasks") holds regardless of what the RG-2/RG-3 rewrites
  // above did to Alpha's ORIGINAL seeded subtasks (Sub one/Sub two both
  // moved away from Alpha by that point). Opened via `/tasks` under its
  // DEFAULT filter (`topLevel: true`) — Alpha is top-level, so no checkbox
  // toggle is needed here (unlike the re-parent/promote cases above).
  test("G10: modal error path — giving Alpha (has subtasks) a Parent surfaces max_depth_exceeded", async ({
    page,
    seededProject,
  }) => {
    const base = apiBase(test.info());
    await createSubtask(base, seededProject.token, seededProject.projectId, seededProject.alpha.id, "G10 temp subtask");

    const before = await getTasks(base, seededProject.token, seededProject.projectId);
    const alphaBefore = byTitle(before, "Alpha");
    expect(alphaBefore?.parentTaskId).toBeNull();
    const candidateParent = globalTopLevel(before).find((t) => t.title !== "Alpha");
    expect(candidateParent, "need another top-level task to attempt as parent").toBeTruthy();

    await openTasksPage(page, seededProject.customerName);
    await clickTaskRow(page, seededProject.projectId, "Alpha");
    const dialog = page.getByRole("dialog", { name: "Edit task" });
    await expect(dialog).toBeVisible();

    // T10 stabilization: CSS `:has()`, not `.filter({ has: dialog.getByRole
    // ("option", ...) }) — see the first "subtask re-parent" test above for
    // why the getByRole form hangs indefinitely on this page.
    const parentSelect = dialog.locator('div.flex.items-center.gap-3:has(span:text-is("Parent")) select');
    await parentSelect.selectOption(String(candidateParent!.id));

    await dialog.getByRole("button", { name: "Save", exact: true }).click();

    const alert = dialog.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/subtask/i);
    // Dialog stays open (TaskFormModal's catch branch never calls
    // requestClose on error) — no mutation applied.
    await expect(dialog).toBeVisible();

    const after = await getTasks(base, seededProject.token, seededProject.projectId);
    const alphaAfter = byTitle(after, "Alpha");
    expect(alphaAfter?.parentTaskId).toBeNull();
  });

  // R3: cross-view parity (risk register R3). By this point in the file, many
  // Kanban reorders + cross-column drags have already run against this
  // project — pure read-side proof that List renders the same global order
  // Kanban's drags produced, no new drag needed.
  test("R3: cross-view parity — List view's rendered top-level order matches the API global order", async ({
    page,
    seededProject,
  }) => {
    const base = apiBase(test.info());
    const tasks = await getTasks(base, seededProject.token, seededProject.projectId);
    const expectedOrder = globalTopLevel(tasks).map((t) => t.title);
    expect(expectedOrder.length).toBeGreaterThan(0);

    await page.goto(`/projects/${seededProject.projectId}/list`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const positioned: Array<{ title: string; y: number }> = [];
    for (const title of expectedOrder) {
      const box = await page.getByText(title, { exact: true }).first().boundingBox();
      expect(box, `${title} row not found in List view`).toBeTruthy();
      positioned.push({ title, y: box!.y });
    }
    const renderedOrder = [...positioned].sort((a, b) => a.y - b.y).map((p) => p.title);
    expect(renderedOrder).toEqual(expectedOrder);
  });

  test("no page errors during drag interactions", async ({ page, seededProject }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await openKanban(page, seededProject.projectId);
    const grip = await gripFor(page, "Gamma", "Drag to reorder");
    const alpha = await page.getByText("Alpha", { exact: true }).first().boundingBox();
    if (grip && alpha) {
      await mouseDrag(page, center(grip), { x: alpha.x + 60, y: alpha.y + 8 });
    }

    expect(errors, errors.join(" || ")).toHaveLength(0);
  });
});

test.describe("kanban drag & drop — mobile (touch)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "touch drag cases run on the mobile project only");
    await loginViaUi(page);
  });

  test("touch reorder within TODO: drag Alpha to column background below all cards -> appended to end", async ({
    page,
    seededProject,
  }) => {
    // Mobile swipeable-columns layout: columns are horizontal pages below
    // `md`, and the TODO column (index 0) is visible by default, so no swipe
    // is needed to reach it. Deterministic drop target per dnd-kit's
    // arrayMove semantics: dropping on the column's empty background (below
    // every card) always resolves to "append to end" — same behavior as a
    // card-drop resolving to `isColumnId(overId)` in computeCardDrop. Picking
    // a between-cards drop target (e.g. onto "Beta") is comparatively
    // brittle since the exact landing index depends on collision-detection
    // internals; appending to the end is the one outcome dnd-kit guarantees.
    await openKanban(page, seededProject.projectId);

    const grip = await gripFor(page, "Alpha", "Drag to reorder");
    const gamma = await page.getByText("Gamma", { exact: true }).first().boundingBox();
    expect(grip, "grip for Alpha not found").toBeTruthy();
    expect(gamma, "Gamma card not found").toBeTruthy();

    const from = center(grip!);
    // Drop well below the last card (Gamma) in the TODO column, onto the
    // column's empty background area.
    const to = { x: gamma!.x + 40, y: gamma!.y + gamma!.height + 80 };
    await touchDrag(page, from, to);

    const tasks = await getTasks(apiBase(test.info()), seededProject.token, seededProject.projectId);
    const a = byTitle(tasks, "Alpha");
    expect(a?.status).toBe("TODO");
    // Model-correct assertion: Alpha must be last within the TODO column's
    // order, not merely at some absolute index.
    const order = columnOrder(tasks, "TODO");
    expect(order[order.length - 1]).toBe("Alpha");
    // `position` is a GLOBAL index (unified-task-ordering), not a per-column
    // count, so this only holds because this fixture's TODO block happens
    // to sit globally contiguous before the lone IN_PROGRESS task (Delta) —
    // kept as a secondary check, not the model-correct one above.
    const todoTasks = tasks.filter((t) => t.status === "TODO" && t.parentTaskId === null);
    expect(a?.position).toBe(todoTasks.length - 1);
  });

  test("mobile action sheet: card menu moves card to Done", async ({ page, seededProject }) => {
    await openKanban(page, seededProject.projectId);

    const gamma = page.getByText("Gamma", { exact: true }).first();
    const gb = await gamma.boundingBox();
    const menus = page.locator('[aria-label="Card options"]');
    const n = await menus.count();

    let opened = false;
    for (let i = 0; i < n && gb; i++) {
      const mb = await menus.nth(i).boundingBox();
      if (mb && Math.abs(mb.y - gb.y) < 40) {
        await menus.nth(i).click();
        opened = true;
        break;
      }
    }
    if (!opened && n > 0) {
      await menus.first().click();
      opened = true;
    }
    expect(opened, "no card options menu found").toBe(true);

    const sheet = page.getByText("Move to", { exact: false }).first();
    await expect(sheet).toBeVisible({ timeout: 3000 });

    await page.getByText("Done", { exact: true }).last().click();
    await page.waitForTimeout(1000);

    const tasks = await getTasks(apiBase(test.info()), seededProject.token, seededProject.projectId);
    const moved = tasks.some(
      (x) => x.parentTaskId === null && x.status === "DONE" && ["Gamma", "Alpha"].includes(x.title),
    );
    expect(moved).toBe(true);
  });

  test("no page errors during mobile drag/action-sheet interactions", async ({ page, seededProject }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await openKanban(page, seededProject.projectId);
    const grip = await gripFor(page, "Alpha", "Drag to reorder");
    const beta = await page.getByText("Beta", { exact: true }).first().boundingBox();
    if (grip && beta) {
      await touchDrag(page, center(grip), { x: beta.x + 40, y: beta.y + 20 });
    }

    expect(errors, errors.join(" || ")).toHaveLength(0);
  });
});
