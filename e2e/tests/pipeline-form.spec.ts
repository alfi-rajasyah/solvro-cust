import { test, expect, loginViaUi, apiBase, ADMIN_EMAIL, ADMIN_PASSWORD } from "../fixtures/test";
import type { Locator, Page } from "@playwright/test";

// M6.27 — e2e coverage for the Pipeline module's opportunity FORM/DETAIL/
// IMPORT surfaces (OpportunityFormModal.tsx, OpportunityDetail.tsx,
// PipelineImportDialog.tsx). Board drag + the other three views (List/
// Swimlane/Quarter) are covered by a sibling spec (M6.26) — out of scope
// here by design, so this file never touches the board's drag affordances.
//
// Every opportunity/role/user this file creates is seeded directly via the
// API (never by mutating the shared `seededProject` fixture, which is a
// Task/Project fixture unrelated to Pipeline) and torn down in a single
// `afterAll`, keyed off ids collected as each test runs — same
// "e2e-unique title, clean up after" convention as every other spec in this
// directory, just centralized here instead of per-test try/finally since
// nothing downstream depends on any one test's row surviving past this file.
//
// Desktop-only (per this task's dispatch brief): every `test.describe` below
// skips on the mobile project, mirroring the house `test.skip(test.info()
// .project.name !== "desktop", ...)` pattern (comments.spec.ts,
// kanban-dnd.spec.ts's mouse-drag describe, etc.) rather than asserting
// Pipeline-form behavior twice against two different form factors.

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const PREFIX = "E2E Pipeline Form";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Request failed ${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

interface ApiCtx {
  base: string;
  token: string;
}

function headers(ctx: ApiCtx): Record<string, string> {
  return { Authorization: `Bearer ${ctx.token}`, "Content-Type": "application/json" };
}

interface CreatedOpportunity {
  id: string;
  title: string;
  stage: string;
}

async function apiCreateOpportunity(
  ctx: ApiCtx,
  body: Record<string, unknown>,
): Promise<CreatedOpportunity> {
  const res = await fetch(`${ctx.base}/api/opportunities`, {
    method: "POST",
    headers: headers(ctx),
    body: JSON.stringify(body),
  });
  return json<CreatedOpportunity>(res);
}

async function apiDeleteOpportunity(ctx: ApiCtx, id: string): Promise<void> {
  // Best-effort, but never SILENT: a failed teardown otherwise leaks
  // e2e-prefixed rows into the shared DB with no trace in the run output.
  try {
    const res = await fetch(`${ctx.base}/api/opportunities/${id}`, {
      method: "DELETE",
      headers: headers(ctx),
    });
    if (!res.ok && res.status !== 404) {
      console.warn(`cleanup: DELETE /opportunities/${id} returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`cleanup: DELETE /opportunities/${id} threw`, err);
  }
}

async function apiFindOpportunityIdByTitle(ctx: ApiCtx, title: string): Promise<string | null> {
  const res = await fetch(`${ctx.base}/api/opportunities`, { headers: headers(ctx) });
  const list = await json<{ id: string; title: string }[]>(res);
  return list.find((o) => o.title === title)?.id ?? null;
}

// Collected across every test in this file, torn down once in `afterAll` —
// see this file's header comment for why a single pass beats per-test
// try/finally here.
const createdOpportunityIds: string[] = [];
let viewerUserId: number | null = null;
let viewerRoleId: number | null = null;
// Second role/user pair for the "assign PIC" flow below — kept separate
// from viewerUserId/viewerRoleId (a `pipeline:view`-only role) rather than
// turned into arrays, since the two roles need different permission sets
// and this reads more plainly than indexing into a shared array.
let assignerUserId: number | null = null;
let assignerRoleId: number | null = null;

test.afterAll(async ({ seededProject }, workerInfo) => {
  // Deliberately NOT `apiBase(testInfo)` (fixtures/test.ts) — that helper's
  // parameter type is the full per-test `TestInfo`, which `afterAll` never
  // receives (only the worker-scoped `WorkerInfo`); the two share the
  // `.project.use.baseURL` shape this file actually needs, so a tiny local
  // equivalent avoids a type mismatch for no behavioral difference.
  const base = new URL(workerInfo.project.use.baseURL ?? "http://localhost:8080").origin;
  const ctx: ApiCtx = { base, token: seededProject.token };

  for (const id of createdOpportunityIds) {
    await apiDeleteOpportunity(ctx, id);
  }
  if (viewerUserId !== null) {
    await fetch(`${ctx.base}/api/admin/users/${viewerUserId}`, {
      method: "DELETE",
      headers: headers(ctx),
    }).catch(() => {});
  }
  if (viewerRoleId !== null) {
    await fetch(`${ctx.base}/api/admin/roles/${viewerRoleId}`, {
      method: "DELETE",
      headers: headers(ctx),
    }).catch(() => {});
  }
  if (assignerUserId !== null) {
    await fetch(`${ctx.base}/api/admin/users/${assignerUserId}`, {
      method: "DELETE",
      headers: headers(ctx),
    }).catch(() => {});
  }
  if (assignerRoleId !== null) {
    await fetch(`${ctx.base}/api/admin/roles/${assignerRoleId}`, {
      method: "DELETE",
      headers: headers(ctx),
    }).catch(() => {});
  }
});

async function openPipeline(page: Page): Promise<void> {
  await page.goto("/pipeline", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
}

/** Locates the board's stage column by the vendored Kanban engine's own
 * `data-value` attribute (reui/kanban.tsx's `KanbanColumn`) — stable
 * regardless of the column's visible label text or DOM nesting. */
function stageColumn(page: Page, stage: string): Locator {
  return page.locator(`[data-slot="kanban-column"][data-value="${stage}"]`);
}

test.describe("Pipeline opportunity form — desktop", () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== "desktop", "Pipeline form flows asserted at desktop width");
  });

  test("creates an opportunity from the board and it persists across reload", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const ctx: ApiCtx = { base, token: seededProject.token };
    const title = `${PREFIX} Create ${stamp()}`;
    const customer = `${PREFIX} Create Co ${stamp()}`;

    await loginViaUi(page);
    await openPipeline(page);

    // .first(): on an EMPTY board (the CI stack's fresh DB) the board's
    // empty-state renders its own "New opportunity" CTA alongside the page
    // header's — both open the same modal, and strict mode otherwise fails.
    await page.getByRole("button", { name: "New opportunity" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New opportunity" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Customer").fill(customer);
    // Plain number — no thousands separators; the input is `type="number"`.
    await dialog.getByLabel("Deal value (IDR)").fill("150000000");
    await dialog.getByLabel("Stage").selectOption("RFP");
    await dialog.getByLabel("Win probability (%)").fill("42");

    await dialog.getByRole("button", { name: "Create opportunity" }).click();
    await expect(dialog).toBeHidden();

    // Register for cleanup IMMEDIATELY after creation — before any assertion
    // that could fail and leak this row into the shared DB.
    const id = await apiFindOpportunityIdByTitle(ctx, title);
    expect(id, "created opportunity should be findable via the API for cleanup").not.toBeNull();
    if (id) createdOpportunityIds.push(id);

    const column = stageColumn(page, "RFP");
    await expect(column.getByRole("link", { name: title })).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await expect(stageColumn(page, "RFP").getByRole("link", { name: title })).toBeVisible();
  });

  test("submitting an empty form shows an inline required error and keeps the modal open", async ({
    page,
  }) => {
    await loginViaUi(page);
    await openPipeline(page);

    // .first(): on an EMPTY board (the CI stack's fresh DB) the board's
    // empty-state renders its own "New opportunity" CTA alongside the page
    // header's — both open the same modal, and strict mode otherwise fails.
    await page.getByRole("button", { name: "New opportunity" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New opportunity" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Create opportunity" }).click();

    await expect(dialog.getByText("Title is required.")).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("editing a deal changes its title and clears win probability to the 50 default", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const ctx: ApiCtx = { base, token: seededProject.token };
    const originalTitle = `${PREFIX} Edit ${stamp()}`;
    const newTitle = `${originalTitle} renamed`;

    const created = await apiCreateOpportunity(ctx, {
      title: originalTitle,
      customerName: `${PREFIX} Edit Co ${stamp()}`,
      dealValue: 80000000,
      winProbability: 70,
      stage: "ASSESSMENT",
    });
    createdOpportunityIds.push(created.id);

    await loginViaUi(page);
    await page.goto(`/pipeline/${created.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit opportunity" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Title").fill(newTitle);
    await dialog.getByLabel("Win probability (%)").fill("");

    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole("heading", { level: 1, name: newTitle })).toBeVisible();
    // The clear-defaults behavior documented on OpportunityFormModal's
    // submit handler: an emptied win-probability field falls back to 50 on
    // PATCH (create-path parity), not 0.
    await expect(page.getByText("50%", { exact: true })).toBeVisible();
  });

  test("detail page: add an activity note (newest-first), add/edit/delete a link", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const ctx: ApiCtx = { base, token: seededProject.token };
    const created = await apiCreateOpportunity(ctx, {
      title: `${PREFIX} Detail Ops ${stamp()}`,
      customerName: `${PREFIX} Detail Ops Co ${stamp()}`,
    });
    createdOpportunityIds.push(created.id);

    await loginViaUi(page);
    await page.goto(`/pipeline/${created.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    // --- Activity: newest note first ---------------------------------
    const noteInput = page.getByPlaceholder("Add a note…");
    await noteInput.fill("First note");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("First note", { exact: true })).toBeVisible();
    // The composer clears itself on mutation success; filling before that
    // wipe lands leaves the input empty and the Add button disabled.
    await expect(noteInput).toHaveValue("");

    await noteInput.fill("Second note");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Second note", { exact: true })).toBeVisible();

    // Activity feed is `role="list"`/`role="listitem"` (OpportunityDetail.tsx's
    // ActivitySection) — the server orders activities `createdAt desc`, so
    // the most recently added note renders first. Scoped to the feed's own
    // list container: the link section on this same page also renders <li>
    // rows later in this test, and a page-wide listitem query would couple
    // this assertion to unrelated DOM order.
    const items = page.getByRole("list").filter({ hasText: "First note" }).getByRole("listitem");
    await expect(items.first()).toContainText("Second note");
    await expect(items.nth(1)).toContainText("First note");

    // --- Links: add, edit, delete -------------------------------------
    await page.getByRole("button", { name: "Add link" }).click();
    await page.getByPlaceholder("Label (e.g. Proposal)").fill("Proposal Doc");
    await page.getByPlaceholder("https://…").fill("https://example.com/proposal");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const link = page.getByRole("link", { name: "Proposal Doc", exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://example.com/proposal");

    const linkRow = page.locator("li").filter({ has: link });
    await linkRow.getByRole("button", { name: "Edit link" }).click();
    // Edit mode REPLACES the row's content (the <a> becomes two value-bound
    // inputs), so the `has: link` filter above matches nothing anymore —
    // re-anchor on the editing row via its Cancel control.
    const editRow = page
      .locator("li")
      .filter({ has: page.getByRole("button", { name: "Cancel", exact: true }) });
    await expect(editRow).toHaveCount(1);
    const rowInputs = editRow.locator("input");
    await rowInputs.nth(0).fill("Proposal Doc v2");
    await rowInputs.nth(1).fill("https://example.com/proposal-v2");
    await editRow.getByRole("button", { name: "Save", exact: true }).click();

    const updatedLink = page.getByRole("link", { name: "Proposal Doc v2", exact: true });
    await expect(updatedLink).toBeVisible();
    await expect(page.getByRole("link", { name: "Proposal Doc", exact: true })).toHaveCount(0);

    const updatedRow = page.locator("li").filter({ has: updatedLink });
    await updatedRow.getByRole("button", { name: "Delete link" }).click();
    const confirmDialog = page.getByRole("dialog", { name: "Delete link" });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(confirmDialog).toBeHidden();

    await expect(page.getByRole("link", { name: "Proposal Doc v2", exact: true })).toHaveCount(0);
    await expect(page.getByText("No links yet.")).toBeVisible();
  });
});

test.describe("Pipeline import — desktop", () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== "desktop", "Import dialog flow asserted at desktop width");
  });

  test("download template fires a download; CSV upload previews/imports valid rows and skips a duplicate", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const ctx: ApiCtx = { base, token: seededProject.token };
    const suffix = stamp();
    const validTitle = `${PREFIX} Import Valid ${suffix}`;
    const validCompany = `${PREFIX} Import Co ${suffix}`;
    // Same title+company as the valid row, different case — the server's
    // dedupe key is `${title}||${customerName}` lower-cased+trimmed
    // (backend/src/routes/opportunities.ts POST /import), so this exercises
    // the case-insensitive match, not just an exact-string one.
    const dupTitle = validTitle.toUpperCase();
    const dupCompany = validCompany.toUpperCase();
    const missingTitleCompany = `${PREFIX} Import Co B ${suffix}`;

    const header = [
      "Title",
      "Company",
      "Deal Value",
      "Stage",
      "PIC",
      "Deadline",
      "Product / Solution",
      "Win Probability",
      "Lead Source",
      "Activity Log",
    ];
    // Row 1: genuinely valid, new — imports.
    const validRow = [validTitle, validCompany, "125000000", "assessment", "", "", "ERP Rollout", "65", "", ""];
    // Row 2: missing Title — caught by the CLIENT-side parse (importParse.ts's
    // `parseImportRow`), never reaches the server at all.
    const missingTitleRow = ["", missingTitleCompany, "", "assessment", "", "", "", "", "", ""];
    // Row 3: passes every client-side check (importParse.ts has no dedupe
    // logic of its own — only the server does), but duplicates row 1's
    // title+company — the SERVER skips it as a duplicate.
    const dupRow = [dupTitle, dupCompany, "999000000", "rfp", "", "", "", "80", "", ""];
    const csv = [header, validRow, missingTitleRow, dupRow].map((r) => r.join(",")).join("\n");

    await loginViaUi(page);
    await openPipeline(page);

    await page.getByRole("button", { name: "Import" }).click();
    const dialog = page.getByRole("dialog", { name: "Import opportunities" });
    await expect(dialog).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download template" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("solvro-pipeline-import-template.xlsx");

    await dialog
      .locator('input[type="file"]')
      .setInputFiles({ name: "pipeline-import-fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") });

    // Preview step: 2 rows pass the client-side parse (valid + the
    // not-yet-known-duplicate), 1 fails it (missing title) — see the
    // per-row comments above for why the duplicate isn't caught here.
    await expect(dialog.getByText("2 valid", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText("1 invalid", { exact: true })).toBeVisible();

    const importButton = dialog.getByRole("button", { name: /Import 2 valid rows/ });
    await expect(importButton).toBeVisible();
    await importButton.click();

    await expect(dialog.getByText("Rows submitted")).toBeVisible({ timeout: 15_000 });

    // Register for cleanup as soon as the server import completed — before
    // the tile/board assertions below, so a failure can't leak the row.
    {
      const id = await apiFindOpportunityIdByTitle(ctx, validTitle);
      expect(id, "imported opportunity should be findable via the API for cleanup").not.toBeNull();
      if (id) createdOpportunityIds.push(id);
    }

    async function tile(label: string): Promise<string> {
      return (
        (await dialog
          .locator("p", { hasText: label })
          .locator("xpath=preceding-sibling::p[1]")
          .innerText()) ?? ""
      );
    }

    expect(await tile("Rows submitted")).toBe("2");
    expect(await tile("Imported")).toBe("1");
    expect(await tile("Skipped")).toBe("1");
    expect(await tile("Invalid")).toBe("0");
    // The row the client rejected before it ever left the browser (missing
    // title) — a separate tile from the server's own "Invalid" above, see
    // PipelineImportDialog.tsx's "Rejected before upload" comment.
    expect(await tile("Rejected before upload")).toBe("1");

    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();

    await expect(stageColumn(page, "ASSESSMENT").getByRole("link", { name: validTitle })).toBeVisible();
  });
});

test.describe("Pipeline permissions — desktop", () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== "desktop", "Toolbar affordance check asserted at desktop width");
  });

  test("a pipeline:view-only user sees the board but no create/import affordances", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const ctx: ApiCtx = { base, token: seededProject.token };
    const suffix = stamp().toUpperCase();
    const roleName = `E2E_PIPELINE_VIEWER_${suffix}`;
    const email = `e2e-pipeline-viewer-${stamp()}@solvro.test`;
    const password = "QaViewer1234!";

    const role = await json<{ id: number }>(
      await fetch(`${ctx.base}/api/admin/roles`, {
        method: "POST",
        headers: headers(ctx),
        body: JSON.stringify({ roleName, permissions: ["pipeline:view"] }),
      }),
    );
    // Fail fast with a diagnosis if role creation didn't take — a silent
    // failure here once let the user land on a default role and made the
    // Import-button assertion below fail mysteriously.
    expect(role.id, "viewer role was not created").toBeTruthy();
    viewerRoleId = role.id;

    const user = await json<{ id: number }>(
      await fetch(`${ctx.base}/api/admin/users`, {
        method: "POST",
        headers: headers(ctx),
        body: JSON.stringify({ email, username: `e2e-pl-viewer-${suffix}`, password, role: roleName }),
      }),
    );
    expect(user.id, "viewer user was not created").toBeTruthy();
    viewerUserId = user.id;

    await loginViaUi(page, email, password);
    await openPipeline(page);

    // pipeline:view alone clears PipelineGuard, so the board itself renders…
    await expect(page.getByRole("button", { name: "Kanban" })).toBeVisible();
    // …but pipeline:create gates BOTH toolbar buttons (Pipeline.tsx's
    // `canCreate` — Import is gated on the same permission as New
    // opportunity, not a separate one).
    // exact: true — getByRole's default substring matching caught a board
    // card's drag-handle button whose accessible name contained an imported
    // deal's title with the word "Import" in it (deals from the import test
    // above are still on the board until this file's afterAll cleanup).
    await expect(page.getByRole("button", { name: "New opportunity", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
  });
});

test.describe("Pipeline assign PIC — desktop", () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== "desktop", "Assign PIC dialog flow asserted at desktop width");
  });

  test("a pipeline:edit_own user can claim an unassigned deal via Assign PIC, unlocking Edit/Delete", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const ctx: ApiCtx = { base, token: seededProject.token };
    const suffix = stamp().toUpperCase();
    const roleName = `E2E_PIPELINE_ASSIGNER_${suffix}`;
    const email = `e2e-pipeline-assigner-${stamp()}@solvro.test`;
    const password = "QaAssigner1234!";
    const username = `e2e-pl-assigner-${suffix}`;

    const role = await json<{ id: number }>(
      await fetch(`${ctx.base}/api/admin/roles`, {
        method: "POST",
        headers: headers(ctx),
        body: JSON.stringify({
          roleName,
          permissions: ["pipeline:view", "pipeline:create", "pipeline:edit_own", "pipeline:delete_own"],
        }),
      }),
    );
    expect(role.id, "assigner role was not created").toBeTruthy();
    assignerRoleId = role.id;

    const user = await json<{ id: number }>(
      await fetch(`${ctx.base}/api/admin/users`, {
        method: "POST",
        headers: headers(ctx),
        body: JSON.stringify({ email, username, password, role: roleName }),
      }),
    );
    expect(user.id, "assigner user was not created").toBeTruthy();
    assignerUserId = user.id;

    // Admin-created, no `picId` — the deal this SA will claim through the
    // dialog rather than through Edit (Edit stays gated off until it has a
    // PIC — D1 in docs/plans/claim-unassigned-deals.md).
    const title = `${PREFIX} Assign ${stamp()}`;
    const created = await apiCreateOpportunity(ctx, {
      title,
      customerName: `${PREFIX} Assign Co ${stamp()}`,
    });
    createdOpportunityIds.push(created.id);

    await loginViaUi(page, email, password);
    await page.goto(`/pipeline/${created.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

    // Before assignment: no Edit/Delete (D1), Assign PIC is the one
    // affordance available, and the Details card reads "Unassigned".
    // Not `exact: true` here — these header buttons render a leading
    // material-symbols icon span (e.g. "person_add") ahead of the visible
    // label, and that glyph's ligature text folds into the accessible name
    // (so the real name is "person_add Assign PIC", not "Assign PIC"),
    // exactly like this file's earlier `getByRole("button", { name: "Edit" })`
    // (no exact) on the same header row.
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
    const assignButton = page.getByRole("button", { name: "Assign PIC" });
    await expect(assignButton).toBeVisible();

    // The Details card's PIC value sits in the sibling <div> right after the
    // "PIC" label <p> (MetaGrid's MetaItem) — anchoring off that label and
    // walking to its value sibling avoids also matching the Activity
    // section's later "Assigned to <username>" note, same
    // label-then-sibling-value pattern as this file's import-tile() helper.
    const picLabel = page.getByText("PIC", { exact: true });
    const picValue = picLabel.locator("xpath=following-sibling::div[1]");
    await expect(picValue).toContainText("Unassigned");

    await assignButton.click();
    const dialog = page.getByRole("dialog", { name: "Assign PIC" });
    await expect(dialog).toBeVisible();

    // The select preselects the caller (D2/D4) — asserted by value (the
    // user id) rather than the visible option text.
    const picSelect = dialog.getByLabel("PIC");
    await expect(picSelect).toHaveValue(String(user.id));

    await dialog.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(dialog).toBeHidden();

    // After assignment: the Details card shows the username, Edit/Delete
    // are now visible (the deal's own-rules unlock for its new PIC — D3),
    // and the activity feed recorded the assign note (D6).
    await expect(picValue).toContainText(username);
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(page.getByText(`Assigned to ${username}`, { exact: true })).toBeVisible();

    // Server-persisted, not just a client-side optimistic update.
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
  });
});
