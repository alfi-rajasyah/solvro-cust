import { test, expect, loginViaUi, apiBase, mouseDrag, gripFor, center } from "../fixtures/test";
import { getTasks, isoDateOffset, type SeededTask } from "../fixtures/seed";
import type { Locator, Page } from "@playwright/test";

// Plan B Task 8 — new-engine parity coverage for the ReUI-engined Gantt
// (SolvroGantt.tsx / GanttOverlay.tsx / SolvroBar.tsx). Every behavior here
// was hand-rolled DOM/geometry in the old engine (frontend/src/components/
// gantt/) and is now a mix of the vendored ReUI engine's own DOM contract
// (`[data-slot="gantt-bar"]`, `[data-slot="gantt-resize-handle"]`,
// `[data-slot="gantt-row-grip"]`) and Solvro's own additions on top
// (`[data-task-id]`, `[data-milestone]`, `[data-rollup]`,
// `[data-connector-id]`, `[data-connect-dot]`, `[data-baseline-rect]`).
//
// Every task created in these tests is dated relative to "today"
// (isoDateOffset — fixtures/seed.ts) rather than a fixed calendar date: the
// engine anchors its initial rendered window on `new Date()` and does not
// expand it to fit a project's actual data on mount (see the finding
// recorded in task-b8-report.md and the doc comment on isoDateOffset) — a
// hardcoded date drifts out of that window as wall-clock time passes.
//
// Each test seeds its own dedicated task(s)/section via the API (same
// convention as gantt-legend.spec.ts/gantt-bar-labels.spec.ts) rather than
// mutating the shared seededProject's alpha/beta/gamma/delta — the worker
// fixture is shared across every test in this FILE (one seeded project per
// file, per test.ts's own comment), so self-contained fixtures keep tests
// order-independent.

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// SeededTask's `startDate`/`dueDate` fall under its `[key: string]: unknown`
// index signature (the interface only declares id/title/status/position/
// parentTaskId explicitly) — a non-null assertion on `unknown` narrows to
// `{}` in TS, which has no `.slice`. These tests read real date strings back
// from the API, so a small local cast keeps that at the read site instead
// of sprinkling `as string` everywhere.
function dateOf(task: SeededTask, field: "startDate" | "dueDate"): string {
  return task[field] as string;
}

interface CreateTaskInput {
  title: string;
  status?: string;
  startDate?: string | null;
  dueDate?: string | null;
  isMilestone?: boolean;
  sectionId?: number;
}

async function createTask(
  base: string,
  token: string,
  projectId: number,
  input: CreateTaskInput,
): Promise<SeededTask> {
  const res = await fetch(`${base}/api/projects/${projectId}/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.text();
  expect(res.ok, `createTask(${input.title}) failed: ${res.status} ${body}`).toBe(true);
  return JSON.parse(body) as SeededTask;
}

/**
 * A dedicated fresh project (own customer lookup, same convention as
 * fixtures/seed.ts's seedFixture) rather than reusing the shared
 * seededProject — used ONLY by the visual checklist test, so its
 * screenshots show a small, clean row set instead of every task the
 * file's earlier tests have accumulated in the shared project by that
 * point in the run.
 */
async function createIsolatedProject(
  base: string,
  token: string,
  name: string,
): Promise<number> {
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const customers = (await fetch(`${base}/api/customers`, { headers: H }).then((r) =>
    r.json(),
  )) as Array<{ id: number }>;
  const customerId = customers[0]?.id;
  expect(customerId, "no customer available to attach an isolated project to").toBeTruthy();
  const res = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name, customerId }),
  });
  const body = await res.text();
  expect(res.ok, `createIsolatedProject failed: ${res.status} ${body}`).toBe(true);
  return (JSON.parse(body) as { id: number }).id;
}

async function createSection(
  base: string,
  token: string,
  projectId: number,
  name: string,
): Promise<{ id: number; name: string }> {
  const res = await fetch(`${base}/api/projects/${projectId}/sections`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(res.ok, `createSection(${name}) failed`).toBe(true);
  return (await res.json()) as { id: number; name: string };
}

async function gotoSeededGantt(page: Page, projectId: number): Promise<void> {
  await page.goto(`/projects/${projectId}/gantt`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
}

/** The bar's WRAPPER button (`[data-slot="gantt-bar"]`, vendored), located
 * from Solvro's own content span (`[data-task-id]`) inside it. */
function barButton(page: Page, taskId: number): Locator {
  return page
    .locator(`[data-task-id="${taskId}"]`)
    .locator('xpath=ancestor::*[@data-slot="gantt-bar"]');
}

async function dotCenter(
  page: Page,
  taskId: number,
  side: "left" | "right",
): Promise<{ x: number; y: number }> {
  const dot = page.locator(`[data-task-id="${taskId}"] [data-connect-dot][data-connect-side="${side}"]`);
  const box = await dot.boundingBox();
  expect(box, `connect dot (${side}) for task ${taskId} not found`).toBeTruthy();
  return center(box!);
}

/** Right dot of the predecessor's bar → left dot of the successor's bar. */
async function dragBetweenDots(page: Page, predTaskId: number, succTaskId: number): Promise<void> {
  const from = await dotCenter(page, predTaskId, "right");
  const to = await dotCenter(page, succTaskId, "left");
  await mouseDrag(page, from, to);
}

/**
 * A hoverable point ON a connector's rendered path, in page coordinates.
 * `.hover()`'s default (bounding-box center) can miss entirely: the route is
 * a stepped/axis-aligned polyline (GanttOverlay.tsx + connector-paths.ts),
 * and an "L" or "Z" shaped route's bbox center usually sits in the empty
 * middle of the box, not on the line itself. Instead this parses the
 * connector's own rendered `d` attribute and returns the midpoint of the
 * first vertical run (the segment `connector-paths.ts`'s "ax,ay" delete-×
 * anchor also sits on) — mapped to page coordinates via the ancestor
 * `<svg>`'s own bounding box, which already bakes in the overlay's
 * `translate(-scrollLeft, -scrollTop)` CSS transform (getBoundingClientRect
 * reflects transforms, so contentPoint + svgBox.topLeft = the real page
 * point regardless of scroll position).
 *
 * Finds the overlay's own `<svg>` via `page` rather than an
 * `ancestor::svg` XPath off the connector locator — SVG elements live in
 * the SVG XML namespace, and Chromium's XPath evaluator does not reliably
 * match a bare (unprefixed) `svg` step against namespaced elements, which
 * hung waiting for a match that was never going to resolve.
 */
async function connectorHoverPoint(page: Page, connector: Locator): Promise<{ x: number; y: number }> {
  const svg = page.locator('[data-slot="gantt-overlay"] svg').first();
  const svgBox = await svg.boundingBox();
  expect(svgBox, "connector overlay <svg> not found").toBeTruthy();
  // The visible path is the first <path> child; the (optional) transparent
  // hit-path is a sibling with a trimmed variant of the same route — the
  // full untrimmed `d` is simpler to reason about here.
  const d = await connector.locator("path").first().getAttribute("d");
  expect(d, "connector <path d> not found").toBeTruthy();
  const nums = (d!.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  let mid: [number, number] | null = null;
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i][0] - pts[i - 1][0]) < 0.5) {
      mid = [pts[i][0], (pts[i][1] + pts[i - 1][1]) / 2];
      break;
    }
  }
  if (!mid) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    mid = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  return { x: svgBox!.x + mid[0], y: svgBox!.y + mid[1] };
}

test.describe("gantt parity — ReUI engine (desktop)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      test.info().project.name !== "desktop",
      "Gantt is desktop-only (hidden md:block)",
    );
    await loginViaUi(page);
  });

  // App-bug finding, FIXED (task-b8-report.md's Finding #1; fix documented
  // in task-b8fix-report.md and CHANGELOG.md's 2026-07-25 entry): the engine
  // anchors its initial visible window on `new Date()` ("today") by default
  // — a fixed ~1-week span at the default Week scale — and never widens it
  // to fit the project's actual task dates on mount. A task dated even a
  // few weeks from today used to be simply absent from the DOM until the
  // user manually scrolled, with no on-screen affordance telling them data
  // existed off-screen. `SolvroGantt.tsx` now fires `apiRef.current?.goTo()`
  // once per project (see the `fitProjectIdRef` effect there) to re-anchor
  // the initial view onto today (if the project's tasks span today) or the
  // project's earliest task date otherwise — the old hand-rolled engine's
  // own parity behavior (it always derived its chart window from the
  // tasks' own min/max dates). Every other test in this file still dates
  // its own fixtures relative to today (isoDateOffset) rather than fixed
  // calendar dates — that's an independent, still-valid fixture hygiene
  // choice (see the file-header comment), not a workaround for this fix.
  //
  // Isolated project (not the shared `seededProject`), unlike every other
  // test in this file: `seededProject` is pre-seeded with alpha/beta/gamma/
  // delta dated near today (fixtures/seed.ts's seedFixture), so today
  // legitimately falls within the SHARED project's overall task range even
  // once this test's own far-past task is added — the fit effect correctly
  // (and, for this specific assertion, unhelpfully) chooses "today" as the
  // anchor in that case, since most of the project's data genuinely IS
  // current. A project containing ONLY the far-past task has no such
  // contamination — today falls OUTSIDE its range, so the fit anchors on
  // the task's own earliest date instead, which is the actual code path
  // this test means to exercise.
  test(
    "opening the Gantt shows an existing task's bar without manual scrolling, regardless of its dates",
    async ({ page, seededProject }) => {
      const { token } = seededProject;
      const base = apiBase(test.info());
      const s = stamp();
      const projectId = await createIsolatedProject(base, token, `FarPast ${s}`);
      const farPast = await createTask(base, token, projectId, {
        title: `FarPast ${s}`,
        status: "TODO",
        startDate: isoDateOffset(-40),
        dueDate: isoDateOffset(-36),
      });

      await gotoSeededGantt(page, projectId);

      await expect(barButton(page, farPast.id)).toBeVisible();
    },
  );

  test("(a) drag-move commits new dates and survives reload", async ({ page, seededProject }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();
    const startIso = isoDateOffset(0);
    const dueIso = isoDateOffset(4);
    const task = await createTask(base, token, projectId, {
      title: `DragMove ${s}`,
      status: "TODO",
      startDate: startIso,
      dueDate: dueIso,
    });

    await gotoSeededGantt(page, projectId);

    const bar = barButton(page, task.id);
    await bar.scrollIntoViewIfNeeded();
    const before = await bar.boundingBox();
    expect(before, "bar not found before drag").toBeTruthy();

    const from = { x: before!.x + before!.width / 2, y: before!.y + before!.height / 2 };
    const to = { x: from.x + Math.max(80, before!.width), y: from.y };

    const [patchRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/api/tasks/${task.id}`) && r.request().method() === "PATCH",
      ),
      mouseDrag(page, from, to),
    ]);
    expect(patchRes.ok()).toBe(true);

    const afterMutation = (await getTasks(base, token, projectId)).find((t) => t.id === task.id)!;
    const newStart = dateOf(afterMutation, "startDate");
    expect(newStart.slice(0, 10)).not.toBe(startIso);
    expect(new Date(newStart).getTime()).toBeGreaterThan(new Date(startIso).getTime());

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const afterReload = await barButton(page, task.id).boundingBox();
    expect(afterReload, "bar not found after reload").toBeTruthy();
    expect(afterReload!.x).toBeGreaterThan(before!.x + 40);
  });

  test("(b) resize-end changes dueDate, leaves startDate untouched", async ({ page, seededProject }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();
    const startIso = isoDateOffset(0);
    const dueIso = isoDateOffset(3);
    const task = await createTask(base, token, projectId, {
      title: `Resize ${s}`,
      status: "TODO",
      startDate: startIso,
      dueDate: dueIso,
    });

    await gotoSeededGantt(page, projectId);

    const bar = barButton(page, task.id);
    await bar.scrollIntoViewIfNeeded();
    const handle = bar.locator('[data-slot="gantt-resize-handle"][data-edge="end"]');
    const handleBox = await handle.boundingBox();
    expect(handleBox, "end resize handle not found").toBeTruthy();

    const from = { x: handleBox!.x + handleBox!.width / 2, y: handleBox!.y + handleBox!.height / 2 };
    const to = { x: from.x + 60, y: from.y };

    const [patchRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/api/tasks/${task.id}`) && r.request().method() === "PATCH",
      ),
      mouseDrag(page, from, to),
    ]);
    expect(patchRes.ok()).toBe(true);

    const after = (await getTasks(base, token, projectId)).find((t) => t.id === task.id)!;
    const unchangedStart = dateOf(after, "startDate");
    const newDue = dateOf(after, "dueDate");
    expect(unchangedStart.slice(0, 10)).toBe(startIso);
    expect(newDue.slice(0, 10)).not.toBe(dueIso);
    expect(new Date(newDue).getTime()).toBeGreaterThan(new Date(dueIso).getTime());
  });

  test("(c) connector create via dot-drag + delete via hover ×; HARD type; persists across reload", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();
    // Non-overlapping dates so the route is the simple forward-nudge case
    // (connector-paths.ts) — a single, unambiguous vertical run to hover.
    const pred = await createTask(base, token, projectId, {
      title: `ConnPred ${s}`,
      status: "TODO",
      startDate: isoDateOffset(0),
      dueDate: isoDateOffset(1),
    });
    const succ = await createTask(base, token, projectId, {
      title: `ConnSucc ${s}`,
      status: "TODO",
      startDate: isoDateOffset(4),
      dueDate: isoDateOffset(5),
    });

    await gotoSeededGantt(page, projectId);
    // Scroll BOTH rows into view — later runs in this file accumulate
    // top-level tasks in the shared seeded project, so relying on pred's
    // scroll alone to also happen to reveal succ (adjacent-ish today) is
    // fragile; see the (g) test's comment for the concrete failure mode.
    await barButton(page, pred.id).scrollIntoViewIfNeeded();
    await barButton(page, succ.id).scrollIntoViewIfNeeded();

    const [createRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/projects/${projectId}/dependencies`) &&
          r.request().method() === "POST",
      ),
      dragBetweenDots(page, pred.id, succ.id),
    ]);
    expect(createRes.ok()).toBe(true);
    const created = (await createRes.json()) as { id: number; type: string };

    const connector = page.locator(`[data-connector-id="${created.id}"]`);
    await expect(connector).toHaveAttribute("data-connector-type", "HARD");

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const reloadedConnector = page.locator(`[data-connector-id="${created.id}"]`);
    await expect(reloadedConnector).toHaveAttribute("data-connector-type", "HARD");

    const hoverPoint = await connectorHoverPoint(page, reloadedConnector);
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    const deleteBtn = page.getByRole("button", { name: /delete dependency/i });
    await expect(deleteBtn).toBeVisible();

    const [deleteRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/api/dependencies/${created.id}`) && r.request().method() === "DELETE",
      ),
      deleteBtn.click(),
    ]);
    expect(deleteRes.ok()).toBe(true);
    await expect(page.locator(`[data-connector-id="${created.id}"]`)).toHaveCount(0);

    // Round-trip: gone server-side too, not just optimistically hidden.
    const deps = await fetch(`${base}/api/projects/${projectId}/dependencies`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json() as Promise<Array<{ id: number }>>);
    expect(deps.some((d) => d.id === created.id)).toBe(false);
  });

  test("(d) baseline toggle shows/hides ghosts", async ({ page, seededProject }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();
    const task = await createTask(base, token, projectId, {
      title: `Baseline ${s}`,
      status: "TODO",
      startDate: isoDateOffset(0),
      dueDate: isoDateOffset(4),
    });

    // Lock via API (admin has project:write) rather than the UI's confirm
    // modal — this test is about the toggle/ghost rendering, not the lock
    // flow itself.
    const lockRes = await fetch(`${base}/api/projects/${projectId}/baseline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(lockRes.ok, "baseline lock failed").toBe(true);

    await gotoSeededGantt(page, projectId);

    // Since 2026-08-31 the lock/reset action lives in the Context panel, not
    // the toolbar: with the baseline locked above, the panel's Baseline
    // section must report the lock (no "Not yet") and offer the reset — the
    // admin has project:write, the gate POST /projects/:id/baseline uses.
    await page.getByRole("button", { name: /show project context/i }).click();
    const baselineSection = page
      .getByRole("heading", { name: "Baseline", exact: true })
      .locator("..");
    await expect(baselineSection).toBeVisible();
    await expect(baselineSection.getByText("Not yet")).toHaveCount(0);
    await expect(baselineSection.getByRole("button", { name: /reset baseline/i })).toBeVisible();
    await page.getByRole("button", { name: /hide project context/i }).click();
    await expect(baselineSection).toBeHidden();

    // Not shown until the toggle is clicked.
    await expect(page.locator("[data-baseline-rect]")).toHaveCount(0);

    // Match on the trailing capitalized "Baseline" word of the toggle's
    // accessible name (its Material Symbols icon is aria-hidden). (The "Lock baseline"/"Reset baseline"
    // button lives in the Context panel since 2026-08-31, not the toolbar.)
    const baselineToggle = page.getByRole("button", { name: /\bBaseline$/ });
    await baselineToggle.click();

    const ghost = page.locator(`[data-baseline-rect][data-baseline-task-id="${task.id}"]`);
    await expect(ghost).toBeVisible();

    await baselineToggle.click();
    await expect(page.locator("[data-baseline-rect]")).toHaveCount(0);
  });

  test("(e) milestone renders as a diamond", async ({ page, seededProject }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();
    const milestone = await createTask(base, token, projectId, {
      title: `Milestone ${s}`,
      status: "TODO",
      dueDate: isoDateOffset(2),
      isMilestone: true,
    });

    await gotoSeededGantt(page, projectId);

    const diamond = page.locator(`[data-task-id="${milestone.id}"][data-milestone]`);
    await expect(diamond).toBeVisible();
  });

  test("(f) rollup pill present on a section row", async ({ page, seededProject }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();
    const section = await createSection(base, token, projectId, `Rollup Section ${s}`);
    await createTask(base, token, projectId, {
      title: `RollupTask ${s}`,
      status: "TODO",
      startDate: isoDateOffset(0),
      dueDate: isoDateOffset(3),
      sectionId: section.id,
    });

    await gotoSeededGantt(page, projectId);

    const rollup = page.locator(`[data-gantt-row-id="section-${section.id}"] [data-rollup]`);
    await expect(rollup).toBeVisible();
  });

  test("(g) row reorder via grip commits the canonical order (List view shares it)", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();
    const taskA = await createTask(base, token, projectId, {
      title: `ReorderA ${s}`,
      status: "TODO",
      startDate: isoDateOffset(0),
      dueDate: isoDateOffset(2),
    });
    const taskB = await createTask(base, token, projectId, {
      title: `ReorderB ${s}`,
      status: "TODO",
      startDate: isoDateOffset(1),
      dueDate: isoDateOffset(3),
    });

    await gotoSeededGantt(page, projectId);

    // This file's earlier tests accumulate top-level tasks in the same
    // shared seeded project (one seededProject per file — fixtures/test.ts),
    // so by the time this test runs, taskA/taskB (created last) can be
    // scrolled below the fold. gripFor/boundingBox() read real layout
    // positions regardless of scroll — dragging to an off-screen point
    // landed the reorder in the wrong slot the first time this ran. Scroll
    // both rows into view before measuring.
    await page.getByText(taskB.title, { exact: true }).first().scrollIntoViewIfNeeded();
    await page.getByText(taskA.title, { exact: true }).first().scrollIntoViewIfNeeded();

    const grip = await gripFor(page, taskB.title, "Reorder");
    const overBox = await page.getByText(taskA.title, { exact: true }).first().boundingBox();
    expect(grip, `grip for ${taskB.title} not found`).toBeTruthy();
    expect(overBox, `row for ${taskA.title} not found`).toBeTruthy();

    await mouseDrag(page, center(grip!), { x: overBox!.x + 60, y: overBox!.y + 8 });

    const after = await getTasks(base, token, projectId);
    const order = after
      .filter((t) => t.parentTaskId === null)
      .sort((x, y) => x.position - y.position || x.id - y.id);
    const idxA = order.findIndex((t) => t.id === taskA.id);
    const idxB = order.findIndex((t) => t.id === taskB.id);
    expect(idxA, "taskA not found post-drag").toBeGreaterThanOrEqual(0);
    expect(idxB, "taskB not found post-drag").toBeGreaterThanOrEqual(0);
    // Insert-before semantics (SolvroGantt.tsx's handleResourceReorder,
    // mirroring the old engine's row-drop branch): B lands immediately
    // before A.
    expect(idxB).toBe(idxA - 1);

    // Same canonical order, read back from List view (one shared order —
    // CLAUDE.md's "one canonical manual order shared by List/Kanban/Gantt").
    await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const listBoxA = await page.getByText(taskA.title, { exact: true }).first().boundingBox();
    const listBoxB = await page.getByText(taskB.title, { exact: true }).first().boundingBox();
    expect(listBoxA, "List row for taskA not found").toBeTruthy();
    expect(listBoxB, "List row for taskB not found").toBeTruthy();
    expect(listBoxB!.y).toBeLessThan(listBoxA!.y);
  });

  test("(h) collapse a section: chevron + row visibility persist; export menu opens", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();
    const section = await createSection(base, token, projectId, `Collapse Section ${s}`);
    const task = await createTask(base, token, projectId, {
      title: `CollapseTask ${s}`,
      status: "TODO",
      startDate: isoDateOffset(0),
      dueDate: isoDateOffset(2),
      sectionId: section.id,
    });

    await gotoSeededGantt(page, projectId);

    // The collapse toggle's aria-label is the section's own resource title
    // (gantt-view.tsx's GanttTreeRow: `aria-label={row.resource.title}`,
    // which for a real section is `s.name` verbatim — adapter.ts's
    // buildResources).
    const toggle = page.getByRole("button", { name: section.name, exact: true });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText(task.title, { exact: true }).first()).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Collapsed rows stay in the DOM (hidden, not unmounted — confirmed via
    // screenshot: the section row itself renders a rollup pill in place of
    // the child rows), so `toHaveCount(0)` never passes here; check
    // visibility instead. `.first()` sidesteps strict-mode ambiguity since
    // `not.toBeVisible()` only needs ONE matched instance to prove hidden.
    await expect(page.getByText(task.title, { exact: true }).first()).not.toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText(task.title, { exact: true }).first()).toBeVisible();

    // Export menu trigger works. Download automation is intentionally
    // skipped (task brief: "skip export-download automation if flaky") —
    // parsing a downloaded .xlsx/.pdf in headless Chromium is heavy
    // machinery with its own flake surface, out of scope for this pass.
    const exportBtn = page.getByRole("button", { name: /export/i });
    await exportBtn.click();
    await expect(page.getByRole("button", { name: "Excel", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "PDF", exact: true })).toBeVisible();
    // Close the menu without triggering a download.
    await page.keyboard.press("Escape");
  });

  // Walkthrough finding F3 (task-b9f3-report.md): the zoom pills rendered
  // one level too fine — ReUI's scale NAMES are calendar-period names, not
  // column-GRAIN names (SolvroGantt.tsx's SCALES comment traces the actual
  // grain each scale renders). Each pill's label is now backed by a ReUI
  // scale one step coarser than its own name (Day→week, Week→month,
  // Month→quarter, Quarter→year) so the rendered columns match what each
  // label promises. Cheap regression net: every pill visually activates and
  // a task dated exactly "today" stays visible with no extra scrolling
  // across all four — the anchor DATE never moves on a scale change (only
  // Task 8's one-shot fit effect touches it), and every scale's window is
  // built from that same anchor, so it's guaranteed to be inside every
  // window. Screenshots captured alongside for visual re-verification.
  //
  // Isolated project (not the shared `seededProject`): this test needs
  // nothing the shared project already has, and a full-suite run observed
  // `list-dnd.spec.ts`'s "gantt row drag" test (a DIFFERENT file, but one
  // that — per playwright.config.ts's `workers: 1` — can share this exact
  // worker's `seededProject` when run in the same invocation) flaking on
  // an accumulated-row-count edge unrelated to this task's own change;
  // keeping this test off the shared project is a free reduction of that
  // contention, not a fix for it (see task-b9f3-report.md).
  test("(i) zoom pills render each label's column grain; bar stays visible across all four", async ({
    page,
    seededProject,
  }) => {
    const { token } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();
    const projectId = await createIsolatedProject(base, token, `ZoomPill ${s}`);
    const task = await createTask(base, token, projectId, {
      title: `ZoomPill ${s}`,
      status: "TODO",
      startDate: isoDateOffset(0),
      dueDate: isoDateOffset(3),
    });

    await gotoSeededGantt(page, projectId);

    for (const label of ["Day", "Week", "Month", "Quarter"] as const) {
      const pill = page.getByRole("button", { name: label, exact: true });
      await pill.click();
      await page.waitForTimeout(300);
      // Active-pill styling is the only signal available (no aria-pressed
      // on this toolbar) — matches SolvroGantt.tsx's `cn(...)` active class.
      await expect(pill).toHaveClass(/bg-primary/);
      await expect(barButton(page, task.id)).toBeVisible();
      await page.mouse.move(5, 5);
      await page.screenshot({ path: `test-results/scale-${label.toLowerCase()}.png` });
    }
  });

  // Walkthrough finding F6 (task-f6-report.md): the tree pane's fixed-width
  // "Resources" name cell truncates long task titles with no on-screen way
  // to widen it. Investigation found the vendored engine already ships a
  // controlled tree-panel width AND a built-in draggable splitter
  // (GanttTreePanelConfig, reui/gantt/gantt.tsx:1218-1231; splitter DOM +
  // pointer handling at reui/gantt/gantt-view.tsx:2260-2308,1043-1088) — no
  // vendored-file patch was needed. SolvroGantt.tsx now wires a persisted,
  // controlled `treePanel` (width/minWidth/maxWidth/nameColumnWidth/
  // onWidthChange) whose name-column width is the pane remainder after the
  // fixed Dates/color columns (issue #118), so those stay visible while every
  // pixel of splitter drag still lands on the title 1:1 and reveals more of
  // a truncated title.
  test("(j) tree-pane splitter widens the Resources column, reveals a truncated title, and persists across reload", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();
    // Long enough that it reliably overflows the DEFAULT 208px name column
    // (~120-140px of usable text room once padding/gutters are subtracted)
    // but comfortably fits once the column grows past ~500px — same shape
    // of title the walkthrough finding itself cited ("Finalize Eltrader A…").
    const longTitle = `Finalize Eltrader A Rollout Documentation ${s}`;
    const task = await createTask(base, token, projectId, {
      title: longTitle,
      status: "TODO",
      startDate: isoDateOffset(0),
      dueDate: isoDateOffset(3),
    });

    await gotoSeededGantt(page, projectId);

    // Scoped to the TREE pane specifically (not just the shared
    // data-gantt-row-id, which the hover-link effect also stamps onto the
    // row's timeline-pane twin) — renderResourceLabel's title-bearing span
    // only exists in the tree pane's name cell.
    const nameLabel = page
      .locator(
        `[data-slot="gantt-tree-pane"] [data-gantt-row-id="task-${task.id}"] span[title="${longTitle}"]`,
      )
      .first();
    await nameLabel.scrollIntoViewIfNeeded();
    await expect(nameLabel).toBeVisible();

    const isTruncated = () => nameLabel.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(await isTruncated(), "title should start truncated at the default tree width").toBe(
      true,
    );

    const treePane = page.locator('[data-slot="gantt-tree-pane"]');
    const paneBefore = await treePane.boundingBox();
    expect(paneBefore, "tree pane not found").toBeTruthy();

    await page.mouse.move(5, 5);
    await page.screenshot({ path: "test-results/f6-tree-before.png" });

    const splitter = page.locator('[data-slot="gantt-splitter"]');
    const splitterBox = await splitter.boundingBox();
    expect(splitterBox, "tree-pane splitter not found").toBeTruthy();
    await mouseDrag(page, center(splitterBox!), { x: splitterBox!.x + 300, y: center(splitterBox!).y });

    const paneAfter = await treePane.boundingBox();
    expect(paneAfter, "tree pane not found after drag").toBeTruthy();
    expect(paneAfter!.width).toBeGreaterThan(paneBefore!.width + 200);
    expect(await isTruncated(), "title should be fully visible after widening the tree pane").toBe(
      false,
    );

    await page.mouse.move(5, 5);
    await page.screenshot({ path: "test-results/f6-tree-after.png" });

    const persistedWidthAfterDrag = await page.evaluate(() =>
      // T2 fix round: the persistence effect now writes the live v3 key
      // (SolvroGantt.tsx's TREE_WIDTH_STORAGE_KEY) — see test (l) for the
      // v2 → v3 migration this key rename introduced.
      localStorage.getItem("solvro.gantt.treeWidth.v4"),
    );
    expect(persistedWidthAfterDrag).toBeTruthy();
    expect(Number(persistedWidthAfterDrag)).toBeGreaterThan(500);

    // F6 follow-up (2026-07-25, post-review) — double-click reset. The
    // splitter's own dblclick handler resets to whatever `treePanel.width`
    // currently evaluates to (gantt-view.tsx:2283-2286); SolvroGantt.tsx
    // freezes that prop at a mount-time snapshot (`initialTreeWidth`, never
    // updated) instead of the live drag-tracking state specifically so this
    // is a real "undo my drag(s) this page load" affordance rather than a
    // permanent no-op. Verified against `paneBefore` (this test's OWN
    // pre-drag measurement, taken above) rather than a hardcoded 288 —
    // immune to whatever width an earlier test in this file/run may have
    // left in localStorage (each Playwright test gets a fresh browser
    // context/localStorage by default, but self-referencing is still the
    // more direct proof of "resets to the page-load width" than a constant
    // would be), and it doubles as proof the derived name-column width
    // tracks the reset too (the title re-truncates).
    await splitter.dblclick();
    await page.waitForTimeout(300);

    const paneAfterReset = await treePane.boundingBox();
    expect(paneAfterReset, "tree pane not found after double-click reset").toBeTruthy();
    expect(Math.abs(paneAfterReset!.width - paneBefore!.width)).toBeLessThanOrEqual(2);
    expect(
      await isTruncated(),
      "title should re-truncate after the splitter resets to the page-load width",
    ).toBe(true);

    const persistedWidthAfterReset = await page.evaluate(() =>
      localStorage.getItem("solvro.gantt.treeWidth.v4"),
    );
    expect(persistedWidthAfterReset).toBeTruthy();
    expect(Math.abs(Number(persistedWidthAfterReset) - paneBefore!.width)).toBeLessThanOrEqual(2);

    // Widen again so the reload check below still exercises a real,
    // non-default persisted width (not just the reset value above).
    const splitterBoxAfterReset = await splitter.boundingBox();
    expect(splitterBoxAfterReset, "tree-pane splitter not found after reset").toBeTruthy();
    await mouseDrag(page, center(splitterBoxAfterReset!), {
      x: splitterBoxAfterReset!.x + 300,
      y: center(splitterBoxAfterReset!).y,
    });
    expect(await isTruncated(), "title should be fully visible again after re-widening").toBe(false);

    const persistedWidth = await page.evaluate(() =>
      localStorage.getItem("solvro.gantt.treeWidth.v4"),
    );
    expect(persistedWidth).toBeTruthy();
    expect(Number(persistedWidth)).toBeGreaterThan(500);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const paneAfterReload = await treePane.boundingBox();
    expect(paneAfterReload, "tree pane not found after reload").toBeTruthy();
    expect(paneAfterReload!.width).toBeGreaterThan(paneBefore!.width + 200);

    const nameLabelAfterReload = page
      .locator(
        `[data-slot="gantt-tree-pane"] [data-gantt-row-id="task-${task.id}"] span[title="${longTitle}"]`,
      )
      .first();
    await nameLabelAfterReload.scrollIntoViewIfNeeded();
    const stillNotTruncated = await nameLabelAfterReload.evaluate(
      (el) => el.scrollWidth <= el.clientWidth + 1,
    );
    expect(stillNotTruncated, "widened width (and full title) should survive reload").toBe(true);
  });

  // Issue #118 — the fixed Dates/color columns used to render past the tree
  // pane's right edge at every pane width (the name column absorbed the drag
  // delta on TOP of the engine's 208px default), so start/due dates were
  // invisible by default and widening never revealed them. Guard the fix's
  // invariant at the default width: both fixed columns end inside the pane,
  // and the DD/MM – DD/MM range renders untruncated.
  test("(k) tree-pane Dates column is visible and untruncated at the default width", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();
    const task = await createTask(base, token, projectId, {
      title: `Dates visible ${s}`,
      status: "TODO",
      startDate: isoDateOffset(0),
      dueDate: isoDateOffset(3),
    });

    await gotoSeededGantt(page, projectId);

    const treePane = page.locator('[data-slot="gantt-tree-pane"]');
    const paneBox = await treePane.boundingBox();
    expect(paneBox, "tree pane not found").toBeTruthy();
    const paneRight = paneBox!.x + paneBox!.width;

    const row = page.locator(
      `[data-slot="gantt-tree-pane"] [data-gantt-row-id="task-${task.id}"]`,
    );
    const datesCell = row.locator('[data-column="dates"]');
    await datesCell.scrollIntoViewIfNeeded();
    const datesBox = await datesCell.boundingBox();
    expect(datesBox, "dates cell not found").toBeTruthy();
    expect(datesBox!.x + datesBox!.width, "dates cell should end inside the pane").toBeLessThanOrEqual(paneRight + 1);

    const colorBox = await row.locator('[data-column="color"]').boundingBox();
    expect(colorBox, "color cell not found").toBeTruthy();
    expect(colorBox!.x + colorBox!.width, "color cell should end inside the pane").toBeLessThanOrEqual(paneRight + 1);

    const untruncated = await datesCell
      .locator("button")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(untruncated, "date range should render untruncated").toBe(true);
  });

  // Issue #118 follow-up, updated for T2's fix round (gantt visual refresh —
  // Status column (+ in-cell adornments) changed the name-column formula, forcing a new v3
  // key; see SolvroGantt.tsx's TREE_WIDTH_STORAGE_KEY block): pre-#118
  // persisted widths sized the name column as `stored − 80`; v3 sizes it as
  // `stored − 316`. A browser that only ever had the original v1 key (never
  // picked up the intermediate v2 one) migrates straight to v3 in one hop,
  // compounding both historical offsets (v1→v2's +76, then v2→v3's +134 —
  // the Status column plus the in-cell dot and "…" button adornments)
  // into a single +210.
  test("(l) legacy tree-width key migrates +210 into the v4 key", async ({
    page,
    seededProject,
  }) => {
    const { projectId } = seededProject;
    await page.addInitScript(() => {
      // only seed the LEGACY (v1) key — the v4 key must come from the migration
      if (localStorage.getItem("solvro.gantt.treeWidth.v4") === null) {
        localStorage.setItem("solvro.gantt.treeWidth", "400");
      }
    });
    await gotoSeededGantt(page, projectId);

    const paneBox = await page.locator('[data-slot="gantt-tree-pane"]').boundingBox();
    expect(paneBox, "tree pane not found").toBeTruthy();
    expect(Math.abs(paneBox!.width - 610), "pane should render at 400 + 210").toBeLessThanOrEqual(2);

    await page.waitForTimeout(300);
    const stored = await page.evaluate(() => ({
      v4: localStorage.getItem("solvro.gantt.treeWidth.v4"),
      v3: localStorage.getItem("solvro.gantt.treeWidth.v3"),
      v2: localStorage.getItem("solvro.gantt.treeWidth.v2"),
      legacy: localStorage.getItem("solvro.gantt.treeWidth"),
    }));
    expect(Number(stored.v4), "migrated width should persist to the v4 key").toBe(610);
    expect(stored.v3, "intermediate v3 key should stay untouched — v1 → v4 skips it").toBeNull();
    expect(stored.v2, "intermediate v2 key should stay untouched — v1 → v4 skips it").toBeNull();
    expect(stored.legacy, "legacy key should be left in place").toBe("400");
  });

  // T5 (gantt visual refresh) — row menu (Edit / Add subtask / Delete),
  // wired via the vendored engine's `renderResourceMenu` (gantt-view.tsx's
  // `data-slot="gantt-resource-menu"` marks the open ContextMenuContent).
  test("(m) row menu — Edit/Add subtask/Delete on a task row, none on a section row", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();
    const section = await createSection(base, token, projectId, `RowMenuSection ${s}`);
    const task = await createTask(base, token, projectId, {
      title: `RowMenu ${s}`,
      status: "TODO",
      startDate: isoDateOffset(0),
      dueDate: isoDateOffset(2),
      sectionId: section.id,
    });

    await gotoSeededGantt(page, projectId);
    const resourceMenu = page.locator('[data-slot="gantt-resource-menu"]');
    const taskRow = page.locator(
      `[data-slot="gantt-row-group"][data-gantt-row-id="task-${task.id}"]`,
    );
    const sectionRow = page.locator(
      `[data-slot="gantt-row-group"][data-gantt-row-id="section-${section.id}"]`,
    );
    const editItem = page.getByRole("menuitem", { name: "Edit" });
    const addSubtaskItem = page.getByRole("menuitem", { name: "Add subtask" });
    const deleteItem = page.getByRole("menuitem", { name: "Delete" });

    // Task row: right-click offers Edit / Add subtask / Delete. Proven
    // POSITIVE first — the section-row check right after only means
    // anything once we know right-click genuinely opens a menu somewhere
    // on this page (a bare "not visible" check on the section row alone
    // can't tell "correctly suppressed" apart from "menu wiring broken
    // everywhere").
    await taskRow.click({ button: "right" });
    await expect(resourceMenu).toBeVisible();
    await expect(editItem).toBeVisible();
    await expect(addSubtaskItem).toBeVisible();
    await expect(deleteItem).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(resourceMenu).not.toBeVisible();

    // No menu on a section row — `renderResourceMenu` returns null there,
    // so the row never gets a ContextMenu wrapper at all.
    await expect(sectionRow).toBeVisible();
    await sectionRow.click({ button: "right" });
    // Give a wrongly-mounted menu time to open before asserting absence —
    // an immediate toHaveCount(0) would pass even if the wiring were live.
    // The "…" block below re-proves the positive path right after this.
    await page.waitForTimeout(400);
    await expect(resourceMenu).toHaveCount(0);

    // Fix round (T5) — the hover-revealed "…" button opens the SAME menu
    // right-click does (user-requested: right-click alone was judged
    // undiscoverable). It dispatches a synthetic bubbling "contextmenu"
    // event rather than exposing any different affordance.
    await taskRow.hover();
    await taskRow.getByRole("button", { name: "Task actions" }).click();
    await expect(resourceMenu).toBeVisible();
    await expect(editItem).toBeVisible();
    await expect(addSubtaskItem).toBeVisible();
    await expect(deleteItem).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(resourceMenu).not.toBeVisible();

    // Edit opens the same modal a row click does (TaskFormModal, edit mode).
    await taskRow.click({ button: "right" });
    await editItem.click();
    const editDialog = page.getByRole("dialog", { name: "Edit task" });
    await expect(editDialog).toBeVisible();
    await expect(editDialog.locator('input[placeholder="Task title"]')).toHaveValue(task.title);
    await page.keyboard.press("Escape");
    await expect(editDialog).not.toBeVisible();
    await page.waitForTimeout(400); // drawer slide-out transition

    // Add subtask opens create, pre-parented to this row's task.
    await taskRow.click({ button: "right" });
    await addSubtaskItem.click();
    const createDialog = page.getByRole("dialog", { name: "New task" });
    await expect(createDialog).toBeVisible();
    const parentSelect = createDialog
      .locator('span:text-is("Parent")')
      .locator("xpath=following-sibling::div//select");
    await expect(parentSelect).toHaveValue(String(task.id));
    await page.keyboard.press("Escape");
    await expect(createDialog).not.toBeVisible();
    await page.waitForTimeout(400);

    // Delete goes through the shared ConfirmModal, never a bare
    // window.confirm — TaskPanel.tsx's own delete flow, mirrored here.
    await taskRow.click({ button: "right" });
    await deleteItem.click();
    const confirmDialog = page.getByRole("dialog", { name: "Delete task" });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Delete" }).click();
    await expect(confirmDialog).not.toBeVisible();
    await expect(taskRow).toHaveCount(0);
  });

  // ---- Browser checklist (B6 Opus review follow-up) — observational only;
  // screenshots for the report, plus light structural assertions so this
  // isn't a pure no-op. Do NOT fix app issues found here — report them. ----
  test("(checklist) visual review — connectors/milestones/resize/zoom/shading", async ({
    page,
    seededProject,
  }) => {
    const { token } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();
    // Own isolated project (not the shared seededProject) — by the time
    // this test runs, the shared project has accumulated every task from
    // tests (a)-(h) in this file, and scrolling far enough to reveal one
    // specific row turned out to scroll the row list past several other
    // unrelated tasks, making for a cluttered, unrepresentative screenshot.
    // A handful of rows in a dedicated project keeps everything reachable
    // without scrolling gymnastics.
    const projectId = await createIsolatedProject(base, token, `Checklist ${s}`);
    const pred = await createTask(base, token, projectId, {
      title: "ChecklistPred",
      status: "TODO",
      startDate: isoDateOffset(0),
      dueDate: isoDateOffset(1),
    });
    const succ = await createTask(base, token, projectId, {
      title: "ChecklistSucc",
      status: "IN_PROGRESS",
      startDate: isoDateOffset(3),
      dueDate: isoDateOffset(5),
    });
    const milestone = await createTask(base, token, projectId, {
      title: "ChecklistMilestone",
      status: "TODO",
      dueDate: isoDateOffset(4),
      isMilestone: true,
    });
    // Enough filler rows to force real vertical scroll within a 900px
    // viewport (a handful of rows all fit on screen with nothing to
    // scroll to, which defeated the point of shot (i) on the first pass).
    for (let i = 0; i < 18; i++) {
      await createTask(base, token, projectId, {
        title: `Filler ${i}`,
        status: "TODO",
        startDate: isoDateOffset(0),
        dueDate: isoDateOffset(2),
      });
    }
    // A HARD dependency, created directly via API (this test isn't
    // exercising the dot-drag gesture — that's covered in (c)).
    const depRes = await fetch(`${base}/api/projects/${projectId}/dependencies`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ predecessorTaskId: pred.id, successorTaskId: succ.id, type: "HARD" }),
    });
    expect(depRes.ok).toBe(true);
    // Second dependency with the MILESTONE as successor — checklist item
    // (ii) is specifically about where a connector anchors on a milestone
    // (the day-column edge vs. the diamond itself), which the pred→succ
    // dependency above (both regular bars) can't show.
    const milestoneDepRes = await fetch(`${base}/api/projects/${projectId}/dependencies`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        predecessorTaskId: succ.id,
        successorTaskId: milestone.id,
        type: "HARD",
      }),
    });
    expect(milestoneDepRes.ok).toBe(true);

    await gotoSeededGantt(page, projectId);
    // Neutral cursor position before every screenshot below — Chromium
    // applies `:hover` based on the real (Xvfb) cursor position on paint,
    // which a previous test's final mouse position can leak into a fresh
    // page load and make an unrelated row look hovered in a screenshot.
    await page.mouse.move(5, 5);

    // (iv) general overview at default (Week) zoom: solid fills, diamond,
    // labels, today line, weekend shading, tree pane.
    await page.screenshot({
      path: "test-results/checklist-01-overview-week.png",
      fullPage: false,
    });

    // (ii) milestone connector endpoints at Week zoom — anchor at the
    // day-box edge, not the diamond itself (per the B6 review finding).
    // ChecklistSucc → ChecklistMilestone is the dependency that actually
    // exercises this (the pred→succ one above connects two regular bars).
    const milestoneEl = page.locator("[data-milestone]").first();
    await expect(milestoneEl).toBeVisible();
    await milestoneEl.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/checklist-02-milestone-week-zoom.png" });

    // (iii) resize-handle ergonomics with the outside connect-dots.
    const bar = barButton(page, pred.id);
    await bar.hover();
    await page.waitForTimeout(250);
    await page.screenshot({ path: "test-results/checklist-03-resize-handles-and-dots-hover.png" });
    await page.mouse.move(5, 5);

    // (i) connector paths vs. the sticky date header when scrolled down.
    // ChecklistPred/ChecklistSucc (with the connector between them) are the
    // first two rows; 18 filler rows below force enough real vertical
    // scroll to push them mostly behind the header. Real wheel input, not
    // a direct `scrollTop` mutation — the pane's scrollbar is a custom
    // Base UI ScrollArea, and the visible scroll position is not
    // necessarily driven by the viewport DOM node's own native `scrollTop`
    // (confirmed by a throwaway diagnostic: mutating it directly was a
    // no-op here, while wheel input — the same technique that reliably
    // drove the earlier historical-task investigation — moves the actual
    // rendered position).
    const timelinePane = page.locator('[data-slot="gantt-timeline-pane"]');
    const paneBox = await timelinePane.boundingBox();
    expect(paneBox, "gantt timeline pane not found").toBeTruthy();
    await page.screenshot({ path: "test-results/checklist-04a-before-vertical-scroll.png" });
    await page.mouse.move(paneBox!.x + paneBox!.width / 2, paneBox!.y + paneBox!.height / 2);
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(300);
    await page.mouse.move(5, 5);
    await page.screenshot({ path: "test-results/checklist-04b-connectors-vs-sticky-header.png" });

    // App-bug finding, FIXED (task-b8-report.md's Finding #2; fix documented
    // in task-b8fix-report.md and CHANGELOG.md's 2026-07-25 entry): a
    // missing `flex flex-col` on ProjectDetail.tsx's Outlet wrapper broke
    // the h-full/flex-1 height chain SolvroGantt.tsx depends on — its own
    // child (ProjectGantt.tsx's wrapper) sat under a `display: block`
    // parent, where `flex-1`/`min-h-0` are inert, so the Gantt rendered at
    // its natural (unbounded) content height instead of being clipped to
    // the available viewport. With nothing to constrain it, the vendored
    // engine's own internal scroll area never detected overflow, and
    // `<main>` (Shell.tsx) — the first ACTUAL scrolling ancestor once the
    // Gantt's own bounds no longer clipped anything — took over scrolling
    // the whole page instead, dragging the toolbar and date-axis header out
    // of view along with the rows. Now that the chain is fixed, the
    // Gantt's own internal scroll area (not `<main>`) handles the row
    // overflow, so the toolbar and both header rows stay put.
    await expect(page.getByRole("button", { name: "Today" })).toBeVisible();
    await expect(page.locator('[data-slot="gantt-tree-header"]')).toBeVisible();
    await expect(page.locator('[data-slot="gantt-timeline-header"]')).toBeVisible();

    await expect(page.locator('[data-testid="solvro-gantt"]')).toBeVisible();
  });
});
