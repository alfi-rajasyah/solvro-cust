import type { Page } from "@playwright/test";
import { apiBase, expect, loginViaUi, test } from "../fixtures/test";

// Weekly Sync page (docs/archive/plans/weekly-sync-tables.md §4 "Weekly Sync page",
// T6; e2e task T8): two passes through the new /weekly-sync page.
//
// The first test drives the row/group/count mechanics on both Playwright
// projects (desktop + mobile): a seeded customer with no update is hidden
// from the Reflection tab until the "Show them" toggle lists the customers
// without an update, where its row sits under "Other customers"; saving two
// achievements — one with a Need-manager-decision — through the Reflection
// sync modal (reused from Daily Review, T5; one row per achievement per
// docs/archive/plans/weekly-sync-achievement-rows.md) pins the row under "Needs a
// manager decision" and bumps the tab's decision count; the row then
// carries both achievement titles as its own rows and stays listed on a
// fresh page load (toggle off); and the Mid-week tab hides the same
// customer again (no mid-week save happened) until the toggle shows it as
// "Not filled".
//
// The second test is the "Copy as table" clipboard round-trip, split out on
// its own (rather than a tail appended to the first test) so a mid-test
// `test.skip()` on the clipboard-only part doesn't mark the whole first
// test's row/group/count assertions as "skipped" in the report on mobile —
// the mobile project's CDP-emulated Chromium doesn't reliably grant
// clipboard-read/clipboard-write, so only this second test skips there.
//
// The third test (docs/archive/plans/weekly-sync-highlight-rows.md §5) drives the
// Mid-week form's highlight rows (T5/T6): two highlights on one customer —
// one with a Risk/Action and no Detail, one with a Detail and no Risk/
// Action — saved, read back on the block (title/risk/action text, the
// "Saved" stamp, exactly one "Has detail" note icon) and on a fresh page
// load. Its own clipboard tail uses a mid-test `test.skip()` rather than a
// fourth test file split: unlike the first test's row/group/count
// mechanics, the save/read-back assertions ahead of it are this test's own
// point (not a shared setup step other assertions build on), so a
// "skipped" mobile report line costs nothing extra there.
//
// No DELETE endpoint exists for customers/projects (same shared-dev-DB
// posture as daily-review.spec.ts's header comment — nothing here is torn
// down afterwards), so every assertion below is either scoped to the test's
// own customer id (the group-membership checks, the row text) or a delta
// off a baseline read before that test's own save (the decision count),
// never a hardcoded total. All three tests share the worker-scoped
// `seededProject` fixture's underlying project (re-pointing it at their own
// fresh customer via PATCH) — each test's assertions key off its own
// customer id, so a later test moving the project to its own customer
// doesn't disturb an earlier test's already-saved data.

test.describe.configure({ mode: "serial" });

/**
 * Parses the Reflection tab's label ("Reflection", "Reflection · 1
 * decision", "Reflection · 3 decisions") into its decision count — 0 when
 * the " · N decisions" suffix is absent (WeeklySync.tsx).
 */
function parseDecisionCount(label: string): number {
  const m = /^Reflection(?: · (\d+) decisions?)?$/.exec(label.trim());
  if (!m) throw new Error(`unexpected Reflection tab label: "${label}"`);
  return m[1] ? Number(m[1]) : 0;
}

/**
 * Walks the direct children of `customerId`'s row's parent container (the
 * Weekly Sync table body — the header row, group-header rows, and
 * per-customer rows are all plain `<div>` siblings there, see
 * WeeklySync.tsx's `HeaderRow`/`GroupHeader`/`SyncRow`/`MidweekBlock`) in DOM order,
 * tracking the most recently seen group-header text, and returns whichever
 * group label was current when the target row is reached. Returns null if
 * the row isn't found under either group (e.g. the Mid-week tab, which has
 * no groups at all).
 */
async function groupContainingRow(page: Page, customerId: number): Promise<"decision" | "other" | null> {
  const row = page.getByTestId(`weekly-sync-row-${customerId}`);
  const container = row.locator("xpath=..");
  const children = container.locator("> div");
  const count = await children.count();
  let currentGroup: "decision" | "other" | null = null;
  for (let i = 0; i < count; i++) {
    const child = children.nth(i);
    const testId = await child.getAttribute("data-testid");
    if (testId === `weekly-sync-row-${customerId}`) return currentGroup;
    if (testId?.startsWith("weekly-sync-row-")) continue; // another customer's row — not a group header
    const text = (await child.textContent()) ?? "";
    if (/Needs a manager decision/.test(text)) currentGroup = "decision";
    else if (/Other customers/.test(text)) currentGroup = "other";
  }
  return null;
}

/**
 * Creates a fresh customer (tamId = the admin fixture user) and re-points
 * the worker-scoped fixture's project at it, ACTIVE — same pattern
 * daily-review.spec.ts uses, so the customer lands in the admin's Daily
 * Review / Weekly Sync scope.
 */
async function seedActiveCustomer(
  base: string,
  token: string,
  userId: number,
  projectId: number,
  namePrefix: string,
): Promise<{ id: number; name: string }> {
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const name = `${namePrefix} ${stamp}`;

  const customerRes = await fetch(`${base}/api/customers`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name, description: "e2e weekly sync fixture", tamId: userId }),
  });
  expect(customerRes.ok, `create customer: ${customerRes.status}`).toBeTruthy();
  const customer = (await customerRes.json()) as { id: number };

  const projectRes = await fetch(`${base}/api/projects/${projectId}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ status: "ACTIVE", customerId: customer.id }),
  });
  expect(projectRes.ok, `patch project: ${projectRes.status}`).toBeTruthy();

  return { id: customer.id, name };
}

/**
 * The current ISO week key, derived the same way daily-review.spec.ts does
 * (its step 9): land on /daily-review with no `?week=` and read back
 * whatever week it resolves to, rather than re-deriving ISO week arithmetic
 * locally. DailyReview.tsx's default is the plain current ISO week (no
 * Monday-shift — that shift is Weekly Sync's own D8 rule for its default,
 * not something to reproduce here).
 */
async function currentWeekKey(page: Page): Promise<string> {
  await page.goto("/daily-review", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/[?&]week=\d{4}-W\d{2}/);
  return new URL(page.url()).searchParams.get("week")!;
}

test.describe("Weekly Sync page", () => {
  test("customer row, Reflection sync save, group pin, mid-week not filled", async (
    { page, seededProject },
    testInfo,
  ) => {
    const { token, userId, projectId } = seededProject;
    const base = apiBase(testInfo);

    await loginViaUi(page);

    const customer = await seedActiveCustomer(base, token, userId, projectId, "Weekly Sync Co");
    const weekKey = await currentWeekKey(page);

    // ------------------------------------------------------------------
    // 1. Open the Weekly Sync page on this week's Reflection tab — our
    //    fresh customer (no weekly update yet) is hidden until the "Show
    //    them" toggle lists the customers without an update; then it sits
    //    under "Other customers" and contributes nothing to the decision
    //    count yet.
    // ------------------------------------------------------------------
    await page.goto(`/weekly-sync?week=${weekKey}&tab=reflection`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await expect(page.getByRole("heading", { level: 1, name: "Weekly Sync" })).toBeVisible();

    const reflectionTab = page.getByTestId("weekly-sync-tab-reflection");
    const baseDecisionCount = parseDecisionCount((await reflectionTab.textContent()) ?? "");

    const row = page.getByTestId(`weekly-sync-row-${customer.id}`);
    const hiddenToggle = page.getByTestId("weekly-sync-hidden-toggle");
    await expect(row).toBeHidden();
    await expect(hiddenToggle).toHaveText("Show them");
    await hiddenToggle.click();
    await expect(row).toBeVisible();
    await expect.poll(() => groupContainingRow(page, customer.id)).toBe("other");

    // ------------------------------------------------------------------
    // 2. Click the row to open its Reflection sync modal (reused from
    //    Daily Review); fill Achievement 1's title and a manager decision,
    //    add a second achievement and fill its title, pick Green, Save
    //    draft.
    // ------------------------------------------------------------------
    await row.click();
    const dialog = page.getByRole("dialog", {
      name: new RegExp(`^Reflection sync — ${customer.name}, week \\d+$`),
    });
    await expect(dialog).toBeVisible();

    const achievement1Text = `Weekly achievement ${customer.name}`;
    const achievement2Text = `Second achievement ${customer.name}`;
    const decisionText = `Need a call on renewal ${customer.name}`;
    await dialog.getByLabel(`Achievement 1 title for ${customer.name}`).fill(achievement1Text);
    await dialog.getByLabel(`Achievement 1 need manager decision for ${customer.name}`).fill(decisionText);
    await dialog.getByRole("button", { name: "Add achievement" }).click();
    await dialog.getByLabel(`Achievement 2 title for ${customer.name}`).fill(achievement2Text);
    await dialog.getByRole("radio", { name: "Green" }).click();
    await dialog.getByRole("button", { name: "Save draft" }).click();
    await expect(dialog).toBeHidden();

    // ------------------------------------------------------------------
    // 3. The row now pins under "Needs a manager decision", the tab's
    //    decision count is +1, and both achievement titles are visible on
    //    the row (one row per achievement, D1). `expect.poll` rather than a
    //    fixed wait: the post-save refetch (React Query invalidation) can
    //    take longer than any single guessed timeout, and a plain one-shot
    //    read of `groupContainingRow` would otherwise race it.
    // ------------------------------------------------------------------
    await expect.poll(() => groupContainingRow(page, customer.id)).toBe("decision");
    await expect(reflectionTab).toHaveText(new RegExp(`Reflection · ${baseDecisionCount + 1} decisions?$`));
    await expect(row.getByText(achievement1Text)).toBeVisible();
    await expect(row.getByText(achievement2Text)).toBeVisible();

    // ------------------------------------------------------------------
    // 3b. A fresh page load starts with the toggle off — the row now
    //     carries a Reflection update, so it stays listed (and pinned)
    //     without the toggle. A reload rather than clicking "Hide them":
    //     on a fresh database this customer may be the only one without
    //     an update, in which case the count line is gone after the save.
    // ------------------------------------------------------------------
    await page.goto(`/weekly-sync?week=${weekKey}&tab=reflection`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await expect(row).toBeVisible();
    await expect.poll(() => groupContainingRow(page, customer.id)).toBe("decision");

    // ------------------------------------------------------------------
    // 4. Mid-week tab: no mid-week save happened, so this same customer is
    //    hidden here until the toggle shows it — as "Not filled".
    // ------------------------------------------------------------------
    await page.getByTestId("weekly-sync-tab-midweek").click();
    await expect(row).toBeHidden();
    await expect(hiddenToggle).toHaveText("Show them");
    await hiddenToggle.click();
    await expect(row.getByText("Not filled")).toBeVisible();
  });

  test("copy as table puts the Reflection table on the clipboard", async (
    { page, context, seededProject },
    testInfo,
  ) => {
    test.skip(
      testInfo.project.name === "mobile",
      "clipboard permissions are not granted in the CDP-emulated mobile project",
    );

    const { token, userId, projectId } = seededProject;
    const base = apiBase(testInfo);

    await loginViaUi(page);

    const customer = await seedActiveCustomer(base, token, userId, projectId, "Weekly Sync Copy Co");
    const weekKey = await currentWeekKey(page);

    await page.goto(`/weekly-sync?week=${weekKey}&tab=reflection`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await expect(page.getByRole("heading", { level: 1, name: "Weekly Sync" })).toBeVisible();

    // Seed one saved Reflection row through the same modal the first test
    // uses, so the copy below has real Reflection data to carry. The fresh
    // customer has no update yet, so the toggle has to list it first.
    const row = page.getByTestId(`weekly-sync-row-${customer.id}`);
    await expect(row).toBeHidden();
    await page.getByTestId("weekly-sync-hidden-toggle").click();
    await expect(row).toBeVisible();
    await row.click();
    const dialog = page.getByRole("dialog", {
      name: new RegExp(`^Reflection sync — ${customer.name}, week \\d+$`),
    });
    await expect(dialog).toBeVisible();

    const achievementText = `Weekly achievement ${customer.name}`;
    await dialog.getByLabel(`Achievement 1 title for ${customer.name}`).fill(achievementText);
    await dialog.getByRole("radio", { name: "Green" }).click();
    await dialog.getByRole("button", { name: "Save draft" }).click();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(500);
    await expect(row.getByText(achievementText)).toBeVisible();

    // A fresh load (toggle off) — the copy below reads the rows on screen,
    // and this customer now has a Reflection update, so it stays listed.
    await page.goto(`/weekly-sync?week=${weekKey}&tab=reflection`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await expect(row.getByText(achievementText)).toBeVisible();

    // ------------------------------------------------------------------
    // Copy as table: grant clipboard permissions, click, assert the
    // status line, then read the clipboard back and check it carries the
    // customer name and the achievement text.
    // ------------------------------------------------------------------
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    const copyButton = page.getByTestId("weekly-sync-copy");
    await expect(copyButton).toBeVisible();
    await copyButton.click();
    await expect(page.getByTestId("weekly-sync-copied")).toContainText("Copied");
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain(customer.name);
    expect(clipboardText).toContain(achievementText);
  });

  test("mid-week highlight rows: add, save, read back, and copy", async (
    { page, context, seededProject },
    testInfo,
  ) => {
    const { token, userId, projectId } = seededProject;
    const base = apiBase(testInfo);

    await loginViaUi(page);

    const customer = await seedActiveCustomer(base, token, userId, projectId, "Weekly Sync Highlights Co");
    const weekKey = await currentWeekKey(page);

    const highlight1Title = `Server request ${customer.name}`;
    const highlight1Risk = `Vendor delay ${customer.name}`;
    const highlight1Action = `Chase vendor ${customer.name}`;
    const highlight2Title = `Remote trading test ${customer.name}`;
    const highlight2Detail = `Six functions still open ${customer.name}`;

    // ------------------------------------------------------------------
    // 1. Mid-week tab: the fresh customer has no update yet, so its block
    //    is hidden until "Show them" lists it — one dash row, "Not filled".
    // ------------------------------------------------------------------
    await page.goto(`/weekly-sync?week=${weekKey}&tab=midweek`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await expect(page.getByRole("heading", { level: 1, name: "Weekly Sync" })).toBeVisible();

    const row = page.getByTestId(`weekly-sync-row-${customer.id}`);
    const hiddenToggle = page.getByTestId("weekly-sync-hidden-toggle");
    await expect(row).toBeHidden();
    await expect(hiddenToggle).toHaveText("Show them");
    await hiddenToggle.click();
    await expect(row).toBeVisible();
    await expect(row.getByText("Not filled")).toBeVisible();

    // ------------------------------------------------------------------
    // 2. Click the block to open the Mid-week sync modal (MidweekSyncModal
    //    .tsx). A fresh customer's `weeklyUpdate` is null, so `initialState`
    //    opens the form with ONE blank highlight card already present
    //    (never zero — an empty form with nothing to type into would be
    //    worse) — fill Highlight 1's title/risk/action directly (no detail).
    //    Add a second highlight, fill its title, open ITS OWN "Add detail"
    //    link (scoped to its card's `midweek-highlight-2` test id — both
    //    cards render an "Add detail" link until opened, so an unscoped
    //    click would be ambiguous) and fill the detail; pick Amber.
    // ------------------------------------------------------------------
    await row.click();
    const dialog = page.getByRole("dialog", {
      name: new RegExp(`^Mid-week sync — ${customer.name}, week \\d+$`),
    });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(`Highlight 1 title for ${customer.name}`).fill(highlight1Title);
    await dialog.getByLabel(`Highlight 1 risk for ${customer.name}`).fill(highlight1Risk);
    await dialog.getByLabel(`Highlight 1 action for ${customer.name}`).fill(highlight1Action);

    await dialog.getByRole("button", { name: "Add highlight" }).click();
    const highlight2TitleInput = dialog.getByLabel(`Highlight 2 title for ${customer.name}`);
    await highlight2TitleInput.fill(highlight2Title);
    const highlight2Block = dialog.getByTestId("midweek-highlight-2");
    await highlight2Block.getByRole("button", { name: "Add detail" }).click();
    await dialog.getByLabel(`Highlight 2 detail for ${customer.name}`).fill(highlight2Detail);

    await dialog.getByRole("radio", { name: "Amber" }).click();
    await dialog.getByRole("button", { name: "Save mid-week" }).click();
    await expect(dialog).toBeHidden();

    // ------------------------------------------------------------------
    // 3. The block now carries both highlight rows — `expect.poll` because
    //    the post-save refetch (React Query invalidation) can lag behind
    //    the modal closing.
    // ------------------------------------------------------------------
    await expect.poll(async () => (await row.getByText(highlight1Title).count()) > 0).toBe(true);
    await expect(row.getByText(highlight2Title)).toBeVisible();
    await expect(row.getByText(highlight1Risk)).toBeVisible();
    await expect(row.getByText(highlight1Action)).toBeVisible();
    await expect(row.getByText(/^Saved /)).toBeVisible();
    await expect(row.locator('[aria-label="Has detail"]')).toHaveCount(1);
    await expect(row.getByText("Not filled")).toHaveCount(0);

    // ------------------------------------------------------------------
    // 4. A fresh page load starts with the toggle off — the block now
    //    carries a Mid-week update, so it stays listed without the toggle.
    // ------------------------------------------------------------------
    await page.goto(`/weekly-sync?week=${weekKey}&tab=midweek`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await expect(row).toBeVisible();
    await expect(row.getByText(highlight1Title)).toBeVisible();
    await expect(row.getByText(highlight2Title)).toBeVisible();

    // ------------------------------------------------------------------
    // 5. Copy as table (desktop only — the mobile project's CDP-emulated
    //    Chromium doesn't reliably grant clipboard-read/clipboard-write,
    //    same reason the second test skips there): both highlight titles,
    //    the detail text, and the customer name (repeated once per
    //    highlight row, D8) round-trip through the clipboard's text/plain
    //    payload.
    // ------------------------------------------------------------------
    test.skip(
      testInfo.project.name === "mobile",
      "clipboard permissions are not granted in the CDP-emulated mobile project",
    );

    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    const copyButton = page.getByTestId("weekly-sync-copy");
    await expect(copyButton).toBeVisible();
    await copyButton.click();
    await expect(page.getByTestId("weekly-sync-copied")).toContainText("Copied");
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain(highlight1Title);
    expect(clipboardText).toContain(highlight2Title);
    expect(clipboardText).toContain(highlight2Detail);
    const nameOccurrences = clipboardText.split(customer.name).length - 1;
    expect(nameOccurrences).toBeGreaterThanOrEqual(2);
  });
});
