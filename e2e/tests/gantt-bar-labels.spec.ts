import { test, expect, loginViaUi, apiBase } from "../fixtures/test";
import { isoDateOffset } from "../fixtures/seed";

// Regression for GH #58: label placement is decided by measured text fit —
// inside iff the full name fits the bar — instead of the old 90px bar-width
// threshold that split typical week-zoom charts arbitrarily.
//
// Adapted for the ReUI-engined Gantt (Plan B Task 8): the old engine measured
// fit with an offscreen canvas and exposed the result as a sibling
// `[data-label-for]` floated element vs. plain inline text. The new engine
// (SolvroBar.tsx) measures the REAL rendered DOM (a ResizeObserver + an
// invisible measurer span) and reports the same fit/no-fit decision via a
// `data-label-outside` attribute on the bar's own content span
// (`[data-task-id="<id>"]`) — present (as `data-label-outside=""`) iff the
// name floats outside; absent iff it renders inline. The floated label
// itself now lives at `[data-slot="solvro-bar-label-outside"]` inside that
// same span (not a page-level `[data-label-for]` sibling).
//
// `toContainText`/`toHaveAttribute` are used instead of `getByText` because
// the span always carries an invisible measurer copy of the title (used to
// compute fit) alongside the real visible label — `getByText` would match
// both nodes and trip Playwright's strict-mode single-match requirement.

test.describe("gantt bar labels — desktop", () => {
  test.beforeEach(async () => {
    test.skip(
      test.info().project.name !== "desktop",
      "Gantt is desktop-only (hidden md:block)",
    );
  });

  test("short name inside a wide bar; long name floats outside a narrow bar", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId, alpha } = seededProject;
    const base = apiBase(test.info());
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    // 1-day bar (~20px at default Week zoom) with a name that can never fit.
    // Dated relative to today (isoDateOffset — see fixtures/seed.ts) so it
    // lands inside the ReUI Gantt's initial ~1-week rendered window instead
    // of a stale hardcoded date drifting out of it (Plan B Task 8 finding).
    const longName = `Unfittably long task name for the label rule ${stamp}`;
    const res = await fetch(`${base}/api/projects/${projectId}/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: longName,
        status: "TODO",
        startDate: isoDateOffset(3),
        dueDate: isoDateOffset(3),
      }),
    });
    expect(res.ok).toBe(true);
    const narrow = (await res.json()) as { id: number };

    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/gantt`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // Alpha: 5-day bar (~100px) vs "Alpha" (~27px @11px font) → INSIDE: no
    // `data-label-outside` attribute, no floated label child, and the name
    // is present in the span's rendered text.
    const alphaSpan = page.locator(`[data-task-id="${alpha.id}"]`);
    await expect(alphaSpan).toBeVisible();
    await expect(alphaSpan).not.toHaveAttribute("data-label-outside");
    await expect(alphaSpan).toContainText("Alpha");
    await expect(alphaSpan.locator('[data-slot="solvro-bar-label-outside"]')).toHaveCount(0);

    // The 1-day task → OUTSIDE: `data-label-outside` present, and the name
    // renders in the floated label slot instead.
    const narrowSpan = page.locator(`[data-task-id="${narrow.id}"]`);
    // React serializes a `data-*` prop set to boolean `true` as the literal
    // string "true" (not an empty string) — SolvroBar.tsx's
    // `data-label-outside={!fits || undefined}`.
    await expect(narrowSpan).toHaveAttribute("data-label-outside", "true");
    const outsideLabel = narrowSpan.locator('[data-slot="solvro-bar-label-outside"]');
    await expect(outsideLabel).toBeVisible();
    await expect(outsideLabel).toContainText(longName);
  });
});
