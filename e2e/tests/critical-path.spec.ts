import { test, expect, loginViaUi, apiBase, openKanban } from "../fixtures/test";
import { createTask, isoDateOffset } from "../fixtures/seed";
import type { Page } from "@playwright/test";

// Critical Path mark (docs/plans/critical-path-mark.md, T4) — e2e coverage
// for the §3 DOM contract T3 implements in gantt-v2/: the bar wrapper span
// (`[data-task-id]`, task bars AND milestones) carries `data-critical-path`
// when the task is marked and lacks it otherwise; the task panel's toggle is
// a button named "Critical Path: Yes"/"Critical Path: No"; a marked Kanban
// card's text includes "Critical Path". Written against that contract ahead
// of T3 landing (parallel wave) — see the dispatch report for which cases
// pass now vs. only once T3 is integrated.
//
// Each test seeds its own dedicated task(s) via the API (gantt-parity.spec.ts's
// convention) rather than mutating the shared seededProject's alpha/beta/
// gamma/delta, and every date is relative to today (isoDateOffset) so the
// suite stays deterministic regardless of which day it runs — see
// fixtures/seed.ts's isoDateOffset doc comment for why a fixed calendar date
// would drift out of the Gantt's default rendered window.

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Navigates to the project's Gantt tab, optionally deep-linking the Task
 * panel open via `?task=<id>`. ProjectDetail.tsx reads `?task=` at the
 * outlet-WRAPPER level (it renders `<TaskPanel>` as a sibling of `<Outlet>`,
 * not inside any one tab's route component), so this opens the panel
 * alongside the Gantt itself — unlike a bar click, which opens TaskFormModal
 * ("Edit task", ProjectGantt.tsx's `onEditTask`) rather than TaskPanel. This
 * is the same deep-link mechanism date-picker.spec.ts's `openTaskPanel`
 * helper already exercises against the List route; using it here against
 * the Gantt route lets one page load carry both the bar (for the
 * `data-critical-path` assertion) and the panel toggle (for the click).
 */
async function gotoGantt(page: Page, projectId: number, taskId?: number): Promise<void> {
  const url = taskId ? `/projects/${projectId}/gantt?task=${taskId}` : `/projects/${projectId}/gantt`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
}

test.describe("critical path mark — Gantt + task panel (desktop)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "Gantt is desktop-only (hidden md:block)");
    await loginViaUi(page);
  });

  test("(1) a marked bar and milestone carry data-critical-path; an unmarked sibling does not", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();

    const marked = await createTask(base, token, projectId, {
      title: `CPMarked ${s}`,
      status: "TODO",
      startDate: isoDateOffset(0),
      dueDate: isoDateOffset(3),
      isCriticalPath: true,
    });
    // "without the flag" (T4 dispatch brief) — the key is omitted entirely,
    // exercising the backend's `?? false` default rather than an explicit
    // `false`.
    const unmarked = await createTask(base, token, projectId, {
      title: `CPUnmarked ${s}`,
      status: "TODO",
      startDate: isoDateOffset(0),
      dueDate: isoDateOffset(3),
    });
    const milestone = await createTask(base, token, projectId, {
      title: `CPMilestone ${s}`,
      status: "TODO",
      dueDate: isoDateOffset(2),
      isMilestone: true,
      isCriticalPath: true,
    });

    await gotoGantt(page, projectId);

    const markedBar = page.locator(`[data-task-id="${marked.id}"]`);
    await expect(markedBar).toBeVisible();
    await expect(markedBar).toHaveAttribute("data-critical-path");

    const unmarkedBar = page.locator(`[data-task-id="${unmarked.id}"]`);
    await expect(unmarkedBar).toBeVisible();
    await expect(unmarkedBar).not.toHaveAttribute("data-critical-path");

    const milestoneDiamond = page.locator(`[data-task-id="${milestone.id}"][data-milestone]`);
    await expect(milestoneDiamond).toBeVisible();
    await expect(milestoneDiamond).toHaveAttribute("data-critical-path");
  });

  test("(2) the task panel's Critical Path toggle flips the bar's data-critical-path attribute", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();

    const task = await createTask(base, token, projectId, {
      title: `CPToggle ${s}`,
      status: "TODO",
      startDate: isoDateOffset(0),
      dueDate: isoDateOffset(3),
      isCriticalPath: true,
    });

    await gotoGantt(page, projectId, task.id);

    const bar = page.locator(`[data-task-id="${task.id}"]`);
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("data-critical-path");

    const panel = page.getByRole("dialog", { name: "Task details" });
    await expect(panel).toBeVisible();

    const toggleOn = panel.getByRole("button", { name: "Critical Path: Yes" });
    await expect(toggleOn).toBeVisible();
    await toggleOn.click();

    // Optimistic patch (useUpdateTask spreads a single-field input straight
    // into the cache — queries.ts, §4 of the plan) — no reload needed.
    await expect(bar).not.toHaveAttribute("data-critical-path");
    const toggleOff = panel.getByRole("button", { name: "Critical Path: No" });
    await expect(toggleOff).toBeVisible();

    await toggleOff.click();

    await expect(bar).toHaveAttribute("data-critical-path");
    await expect(panel.getByRole("button", { name: "Critical Path: Yes" })).toBeVisible();
  });
});

test.describe("critical path mark — Kanban card (desktop + mobile)", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page);
  });

  test("(3) a marked task's card shows 'Critical Path'; an unmarked sibling's card does not", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    const s = stamp();

    const marked = await createTask(base, token, projectId, {
      title: `CPKanbanMarked ${s}`,
      status: "TODO",
      isCriticalPath: true,
    });
    // Omits the flag entirely, same as case (1)'s unmarked sibling.
    const unmarked = await createTask(base, token, projectId, {
      title: `CPKanbanUnmarked ${s}`,
      status: "TODO",
    });

    await openKanban(page, projectId);

    const markedCard = page
      .locator('[data-slot="kanban-item"]')
      .filter({ has: page.getByText(marked.title, { exact: true }) })
      .first();
    const unmarkedCard = page
      .locator('[data-slot="kanban-item"]')
      .filter({ has: page.getByText(unmarked.title, { exact: true }) })
      .first();

    await expect(markedCard).toBeVisible();
    // Non-exact: CriticalPathMark's chip (StatusChip.tsx's `Chip`) renders the
    // glyph span and the "Critical Path" text as adjacent children of the
    // SAME span with no wrapper around the text alone (`<span
    // aria-hidden>conversion_path</span>Critical Path`), so no element's own
    // text content is EVER exactly "Critical Path" — an `exact: true` match
    // finds nothing even when the chip is rendered. `.first()` sidesteps
    // strict-mode ambiguity from the substring matching several ancestor
    // spans at once.
    await expect(markedCard.getByText("Critical Path").first()).toBeVisible();

    await expect(unmarkedCard).toBeVisible();
    await expect(unmarkedCard.getByText("Critical Path")).toHaveCount(0);
  });
});
