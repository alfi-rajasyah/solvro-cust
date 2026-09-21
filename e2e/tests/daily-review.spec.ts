import type { Locator, Page } from "@playwright/test";
import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { createTask, isoDateOffset } from "../fixtures/seed";

// Daily Review v2 (docs/plans/daily-review-v2-spec.md §9; weekly sync tables
// per docs/archive/plans/weekly-sync-tables.md): one end-to-end pass through the
// rewritten /daily-review page — a project note, an operations note, Mark
// reviewed, an overdue-task status change, the Reflection sync modal's
// draft/health/Mark-done cycle and the resulting collapsed group summary,
// the two read-only surfaces that consume the same data (CustomerDetail's
// "Weekly updates" list, the project overview's "Notes" panel), and week
// navigation. Runs under both Playwright projects (desktop + mobile) per
// playwright.config.ts.
//
// The 5 stats-bar tiles (StatsBar.tsx) are GLOBAL aggregates across every
// ACTIVE project/customer the logged-in user can see — for the admin
// fixture used here (ADMIN role = ["*"] wildcard, backend/prisma/seed.ts)
// that's every ACTIVE project/customer in the whole shared dev DB
// (routes/dailyReview.ts's `viewAll` branch), not just this spec's own
// fixture data. Asserting a literal "1" or "1 / 1" would be flaky against a
// dev stack that already has other ACTIVE projects/reviews/notes from
// manual QA, other test runs, or a concurrently-running agent. Every tile
// assertion below instead reads a BASELINE before this spec's customer/
// project enter scope (the seeded project starts PLANNING/uncustomered, so
// it contributes nothing to any tile yet) and asserts the exact DELTA this
// spec's own actions produce — the same defensive-against-shared-DB-
// pollution approach pipeline-board.spec.ts uses for its column-value-sum
// assertions (a fresh API read rather than a hardcoded total).
//
// Note for whoever re-runs this spec repeatedly against the same dev DB:
// unlike other fixtures (which leave their seeded project PLANNING and so
// invisible to Daily Review), this spec flips its project ACTIVE and its
// customer's `tamId` to the admin permanently — there is no DELETE
// endpoint for either, so each run leaves one more ACTIVE project/customer
// in scope forever. The baseline-delta approach above is exactly what
// keeps the assertions correct regardless of how much of that accumulates.
//
// e2e/ is its own standalone TS project with no dependency on frontend/src
// (confirmed precedent: pipeline-board.spec.ts's header comment) — the ISO
// week arithmetic for the Prev/Next assertion below is a small local
// re-derivation for the common (non-year-boundary) case, not an import of
// lib/isoWeek.ts.

test.describe.configure({ mode: "serial" });

async function readCount(page: Page, testId: string): Promise<number> {
  const el = page.getByTestId(testId);
  await expect(el).toBeVisible();
  const text = (await el.textContent())?.trim() ?? "";
  const n = Number(text);
  if (Number.isNaN(n)) throw new Error(`stat "${testId}": expected a number, got "${text}"`);
  return n;
}

interface Fraction {
  count: number;
  total: number;
}

async function readFraction(page: Page, testId: string): Promise<Fraction> {
  const el = page.getByTestId(testId);
  await expect(el).toBeVisible();
  const text = (await el.textContent())?.trim() ?? "";
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (!m) throw new Error(`stat "${testId}": expected "count / total", got "${text}"`);
  return { count: Number(m[1]), total: Number(m[2]) };
}

/**
 * Fills `textbox` with `body` and saves with the ⌘/Ctrl+Enter chord;
 * falls back to the explicit "Save note" button scoped to `container` if
 * the chord doesn't register within a short window — the dispatch brief
 * calls this out as a known gap on the touch-emulated mobile project.
 */
async function saveNote(container: Locator, textbox: Locator, body: string): Promise<void> {
  await textbox.fill(body);
  await textbox.press("Meta+Enter");
  const saved = container.getByText(body, { exact: false }).first();
  const appeared = await saved
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    await container.getByRole("button", { name: "Save note" }).first().click();
    await expect(saved).toBeVisible();
  }
}

/**
 * Polls until `customerName`'s group header chevron (CustomerGroup.tsx:
 * `aria-expanded`, collapsed by the auto-collapse rule once every project
 * is reviewed today and the weekly update is DONE) reports `aria-expanded=
 * "false"`, then confirms the header row carries the "Done" weekly-status
 * pill — both facts checked in one poll so they can't race the
 * invalidation-driven re-render that produces them together. Scoped to the
 * customer's own h2 (not the first collapsed toggle on the page) because a
 * dev DB this spec has run against before can already have other
 * customers' groups sitting collapsed.
 */
async function waitForCollapsedDone(page: Page, customerName: string): Promise<void> {
  const heading = page.getByRole("heading", { level: 2, name: customerName });
  const toggle = heading.getByRole("button", { expanded: false });
  await expect
    .poll(
      async () => {
        if ((await toggle.count()) === 0) return false;
        const text = (await heading.textContent().catch(() => null)) ?? "";
        return text.includes("Done");
      },
      { timeout: 15_000, message: `waiting for "${customerName}"'s collapsed row to show Done` },
    )
    .toBe(true);
}

test.describe("Daily Review v2", () => {
  test("project note, operations note, review, overdue task, weekly update", async (
    { page, seededProject },
    testInfo,
  ) => {
    const { token, userId, projectId } = seededProject;
    const base = apiBase(testInfo);
    const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    await loginViaUi(page);

    // --- Baseline: our project is still PLANNING/uncustomered at this
    // point, so it contributes nothing to any stats-bar tile yet — see
    // header comment.
    await page.goto("/daily-review", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const baseReviewed = await readFraction(page, "stat-reviewed-today");
    const baseWeekly = await readFraction(page, "stat-weekly-updates");
    const baseOverdue = await readCount(page, "stat-overdue-tasks");
    const baseNotes = await readCount(page, "stat-notes-this-week");

    // --- Fixture: a fresh customer (tamId = the admin fixture user), the
    // seeded project reassigned to it and flipped ACTIVE, one overdue task.
    const customerName = `Daily Review Co ${stamp}`;
    const customerRes = await fetch(`${base}/api/customers`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        name: customerName,
        description: "e2e daily review fixture",
        tamId: userId,
      }),
    });
    expect(customerRes.ok, `create customer: ${customerRes.status}`).toBeTruthy();
    const customer = (await customerRes.json()) as { id: number };

    const projectRes = await fetch(`${base}/api/projects/${projectId}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ status: "ACTIVE", customerId: customer.id }),
    });
    expect(projectRes.ok, `patch project: ${projectRes.status}`).toBeTruthy();
    const project = (await projectRes.json()) as { name: string };
    const projectName = project.name;

    const overdueTitle = `Overdue task ${stamp}`;
    await createTask(base, token, projectId, {
      title: overdueTitle,
      status: "TODO",
      dueDate: isoDateOffset(-2),
    });

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    // ------------------------------------------------------------------
    // 1. Page title, week label, our customer group + project card.
    // ------------------------------------------------------------------
    await expect(page.getByRole("heading", { level: 1, name: "Daily Review" })).toBeVisible();
    await expect(page.getByText(/^Week \d+$/)).toBeVisible();

    const customerHeading = page.getByRole("heading", { level: 2, name: customerName });
    await expect(customerHeading).toBeVisible();
    const customerSection = customerHeading.locator("xpath=ancestor::section[1]");
    const projectCard = customerSection.locator("article").filter({ hasText: projectName });
    await expect(projectCard.getByRole("link", { name: projectName })).toBeVisible();

    // ------------------------------------------------------------------
    // 1b. Folds. The attention row's "Hide lists" folds the overdue/open-
    //     risk lists to a one-line count summary; the header chevron folds
    //     the whole card body (note editor included) to the header row,
    //     which keeps the name link. Both default expanded.
    // ------------------------------------------------------------------
    const overdueRow = projectCard.locator("li").filter({ hasText: overdueTitle });
    await expect(overdueRow).toBeVisible();
    await projectCard.getByRole("button", { name: "Hide lists" }).click();
    await expect(overdueRow).toBeHidden();
    await projectCard.getByRole("button", { name: "Show lists" }).click();
    await expect(overdueRow).toBeVisible();

    await projectCard.getByRole("button", { name: "Collapse project" }).click();
    await expect(page.getByLabel(`Note for ${projectName}`)).toBeHidden();
    await expect(projectCard.getByRole("link", { name: projectName })).toBeVisible();
    await projectCard.getByRole("button", { name: "Expand project" }).click();
    await expect(page.getByLabel(`Note for ${projectName}`)).toBeVisible();

    // ------------------------------------------------------------------
    // 2. Today's project note, saved with ⌘/Ctrl+Enter (Save-button
    //    fallback on mobile) — appears as a saved row; "Notes this week"
    //    increments by 1.
    // ------------------------------------------------------------------
    const projectNoteBody = `Daily project note ${stamp}`;
    const projectNoteInput = page.getByLabel(`Note for ${projectName}`);
    await saveNote(projectCard, projectNoteInput, projectNoteBody);
    await expect(page.getByTestId("stat-notes-this-week")).toHaveText(String(baseNotes + 1));

    // ------------------------------------------------------------------
    // 3. Operations note — a required Title plus a body; the saved row
    //    shows both; "Notes this week" increments again.
    // ------------------------------------------------------------------
    const operationsCard = customerSection.locator("article").filter({ hasText: "issues outside a project" });
    const opsNoteTitle = `Ops title ${stamp}`;
    const opsNoteBody = `Ops incident ${stamp}`;
    await operationsCard.getByLabel("Title").fill(opsNoteTitle);
    const opsNoteInput = page.getByLabel(`Operations note for ${customerName}`);
    await saveNote(operationsCard, opsNoteInput, opsNoteBody);
    await expect(operationsCard.getByText(opsNoteTitle)).toBeVisible();
    await expect(operationsCard.getByText(opsNoteBody)).toBeVisible();
    await expect(page.getByTestId("stat-notes-this-week")).toHaveText(String(baseNotes + 2));

    // ------------------------------------------------------------------
    // 4. Mark reviewed — "Reviewed HH:MM" badge; "Reviewed today" tile.
    // ------------------------------------------------------------------
    await projectCard.getByRole("button", { name: "Mark reviewed" }).click();
    await expect(projectCard.getByText(/Reviewed \d{2}:\d{2}/)).toBeVisible();
    await expect(page.getByTestId("stat-reviewed-today")).toHaveText(
      `${baseReviewed.count + 1} / ${baseReviewed.total + 1}`,
    );

    // ------------------------------------------------------------------
    // 5. Overdue task: flip its status to Done — the row disappears and
    //    "Overdue tasks" drops back to baseline.
    // ------------------------------------------------------------------
    await expect(page.getByTestId("stat-overdue-tasks")).toHaveText(String(baseOverdue + 1));
    const taskRow = projectCard.locator("li").filter({ hasText: overdueTitle });
    await taskRow.getByRole("combobox", { name: "Task status" }).click();
    await page.getByRole("option", { name: "Done", exact: true }).click();
    await expect(taskRow).toBeHidden();
    await expect(projectCard.getByText("Nothing overdue · no open risks")).toBeVisible();
    await expect(page.getByTestId("stat-overdue-tasks")).toHaveText(String(baseOverdue));

    // ------------------------------------------------------------------
    // 6. Weekly update: open Reflection sync, draft from this week's
    //    notes, pick Amber, Mark done — tile, then the group collapses to
    //    its summary row.
    // ------------------------------------------------------------------
    await customerSection.getByRole("button", { name: "Reflection sync" }).click();
    const reflectionDialog = page.getByRole("dialog", {
      name: new RegExp(`^Reflection sync — ${customerName}, week \\d+$`),
    });
    await expect(reflectionDialog).toBeVisible();
    // The blank starter card holds no text, so "Draft from this week" applies
    // straight away with no replace-confirm (ReflectionSyncModal.tsx's
    // requestDraft). No Mid-week highlights were saved in this flow, so the
    // draft falls back to the whole week (weeklyDraft.ts's
    // draftWeeklyAchievements) rather than just Thursday-Sunday — Achievement
    // 1 is always the project note (a customer's own projects draft before
    // its operations notes on the same day); the operations note lands in
    // whichever card follows it, titled with its "[<title>]" bracket
    // followed by its body.
    await reflectionDialog.getByRole("button", { name: "Draft from this week" }).click();
    const achievement1TitleValue = await reflectionDialog
      .getByLabel(`Achievement 1 title for ${customerName}`)
      .inputValue();
    expect(achievement1TitleValue).toContain(projectNoteBody);

    const achievementTitleValues = await reflectionDialog
      .getByLabel(new RegExp(`^Achievement \\d+ title for ${customerName}$`))
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    const opsCardTitle = achievementTitleValues.find((v) => v.includes(`[${opsNoteTitle}]`));
    expect(opsCardTitle, `card titles: ${achievementTitleValues.join(" | ")}`).toBeDefined();
    expect(opsCardTitle).toContain(opsNoteBody);

    await reflectionDialog.getByRole("radio", { name: "Amber" }).click();
    await reflectionDialog.getByRole("button", { name: "Mark done" }).click();
    await expect(reflectionDialog).toBeHidden();

    await expect(page.getByTestId("stat-weekly-updates")).toHaveText(
      `${baseWeekly.count + 1} / ${baseWeekly.total + 1}`,
    );
    await waitForCollapsedDone(page, customerName);

    // ------------------------------------------------------------------
    // 7. The customer name in the (now collapsed) group header links to
    //    /customers/:id — whose Weekly updates section lists Amber, Done,
    //    and Achievement 1's title (drafted from the project note above).
    // ------------------------------------------------------------------
    await customerHeading.getByRole("link", { name: customerName }).click();
    await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}$`));
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    const weeklySection = page
      .getByRole("heading", { name: "Weekly updates" })
      .locator("xpath=ancestor::section[1]");
    await expect(weeklySection.getByText("Amber", { exact: true })).toBeVisible();
    await expect(weeklySection.getByText("Done", { exact: true })).toBeVisible();
    await expect(weeklySection.getByText(projectNoteBody, { exact: false })).toBeVisible();

    // ------------------------------------------------------------------
    // 8. /projects/:id/overview — Notes panel shows today's project note.
    // ------------------------------------------------------------------
    await page.goto(`/projects/${projectId}/overview`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const notesPanel = page
      .getByRole("heading", { name: "Notes", exact: true })
      .locator("xpath=ancestor::section[1]");
    await expect(notesPanel.getByText(projectNoteBody)).toBeVisible();

    // ------------------------------------------------------------------
    // 8b. /overview — the "Recent notes" panel lists today's project note
    //     and the operations note (its title), newest first.
    // ------------------------------------------------------------------
    await page.goto("/overview", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const recentNotes = page
      .getByRole("heading", { name: "Recent notes" })
      .locator("xpath=ancestor::div[1]");
    await expect(recentNotes.getByText(projectNoteBody)).toBeVisible();
    await expect(recentNotes.getByText(opsNoteTitle)).toBeVisible();
    await expect(recentNotes.getByText(opsNoteBody)).toBeVisible();

    // ------------------------------------------------------------------
    // 9. Week navigation: Previous changes ?week=, Next returns to it.
    // ------------------------------------------------------------------
    await page.goto("/daily-review", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/[?&]week=\d{4}-W\d{2}/);
    const currentWeekKey = new URL(page.url()).searchParams.get("week")!;
    const currentWeekLabel = (await page.getByText(/^Week \d+$/).textContent())?.trim();

    // Exact-value check where it's safe without re-deriving isoWeek.ts's
    // year-boundary rollover rules (see header comment): a mid-year week
    // simply decrements. Near a year boundary, fall back to "changed".
    const weekMatch = /^(\d{4})-W(\d{2})$/.exec(currentWeekKey);
    const weekNum = weekMatch ? Number(weekMatch[2]) : null;
    const expectedPrevKey =
      weekMatch && weekNum !== null && weekNum > 1
        ? `${weekMatch[1]}-W${String(weekNum - 1).padStart(2, "0")}`
        : null;

    await page.getByRole("button", { name: "Previous week" }).click();
    if (expectedPrevKey) {
      await expect(page).toHaveURL(new RegExp(`week=${expectedPrevKey}(?:&|$)`));
    } else {
      await expect(page).not.toHaveURL(new RegExp(`week=${currentWeekKey}(?:&|$)`));
    }
    const prevWeekLabel = (await page.getByText(/^Week \d+$/).textContent())?.trim();
    expect(prevWeekLabel).not.toBe(currentWeekLabel);

    await page.getByRole("button", { name: "Next week" }).click();
    await expect(page).toHaveURL(new RegExp(`week=${currentWeekKey}(?:&|$)`));
    await expect(page.getByText(/^Week \d+$/)).toHaveText(currentWeekLabel ?? "");
  });
});
