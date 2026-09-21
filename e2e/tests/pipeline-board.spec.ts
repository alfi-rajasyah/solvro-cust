import type { Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, center, expect, gripFor, loginViaUi, mouseDrag, test } from "../fixtures/test";

// Pipeline module e2e coverage (M6.26) — the board + view-switcher on the
// same vendored dnd-kit engine `kanban-dnd.spec.ts` already proves for the
// Tasks board (`reui/kanban.tsx`; see that file's header comment). This spec
// reuses its proven house tools verbatim (`gripFor`/`center`/`mouseDrag`,
// `loginViaUi`, `ADMIN_EMAIL`/`ADMIN_PASSWORD` from `fixtures/test.ts`) but
// does NOT touch `fixtures/seed.ts`'s task-project fixture — Pipeline deals
// are a different resource entirely, so this file seeds its own opportunity
// fixtures via the API (own `beforeAll`/helpers below), modeled on
// `fixtures/seed.ts`'s own login()+stamped-title pattern without editing
// that shared file (a parallel e2e task owns the create/edit-form + import
// coverage in a sibling spec).
//
// Board structure recap (frontend/src/components/pipeline/adapter.ts,
// SolvroPipelineKanban.tsx): 9 `PipelineStage` columns, each rendered as
// `[data-slot="kanban-column"][data-value="<STAGE>"]` (reui/kanban.tsx) —
// the same data-slot convention kanban-dnd.spec.ts's own column-body drops
// (G6/G9b) key off. Deal cards carry the SAME `KanbanItemHandle
// aria-label="Drag to reorder"` grip `gripFor` already knows how to locate.
//
// Mobile drag coverage — deliberately SKIPPED here, not faked (dispatch
// brief: "skip what genuinely can't work, justify in a comment + report"):
// unlike kanban-v2's Tasks board (3 columns, a mobile "Card options" ->
// "Move to" action-sheet fallback for cross-column moves — see
// `kanban-v2/MobileMoveSheet.tsx`/`cards.tsx`), Pipeline's `OpportunityCard`
// has NO such action sheet — the drag handle is the only move affordance at
// any viewport. At the mobile project's 390px (iPhone 13) viewport, each of
// Pipeline's `w-[85vw]` columns is itself ~332px wide, so even two ADJACENT
// columns (~332+16+332=680px) never both fit on screen at once — a genuine
// cross-stage touch drag would need mid-gesture horizontal scrolling that
// this suite's `touchDrag` helper (a fixed linear touchmove path, see
// `fixtures/test.ts`) doesn't perform. kanban-dnd.spec.ts's own mobile
// section independently confirms this is the real constraint: its ONE touch
// case is a same-column reorder for exactly this reason, and its
// cross-column mobile case goes through the action-sheet UI instead of a
// drag gesture — an affordance Pipeline doesn't have. The underlying
// dnd-kit TouchSensor mechanics are already proven against this exact
// vendored engine by kanban-dnd.spec.ts's mobile project; re-proving that
// low-level mechanism isn't part of this spec's brief (none of its 5
// numbered scenarios call out a required mobile drag case). Every
// NON-drag scenario below (board render, view switching, keyboard nav)
// still runs on both the desktop and mobile projects.

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";

// Mirrors backend/src/lib/pipelineFormat.ts's `STAGE_ORDER`/`STAGE_LABELS`
// (frontend/src/lib/pipelineFormat.ts) — duplicated locally rather than
// imported since e2e/ is its own standalone TS project with no dependency
// on frontend/src (confirmed: no existing e2e spec imports frontend code).
const STAGE_ORDER = [
  "ASSESSMENT",
  "RFP",
  "POC",
  "TECHNICAL_CLARIFICATION",
  "DELIVER_PROPOSAL",
  "WAITING_RESPONSE",
  "WON",
  "DROP",
  "HOLD",
] as const;

const STAGE_LABELS: Record<(typeof STAGE_ORDER)[number], string> = {
  ASSESSMENT: "Assessment",
  RFP: "RFP",
  POC: "PoC",
  TECHNICAL_CLARIFICATION: "Technical Clarification",
  DELIVER_PROPOSAL: "Delivered Proposal",
  WAITING_RESPONSE: "Waiting Response",
  WON: "Won",
  DROP: "Drop",
  HOLD: "Hold",
};

// Verbatim port of frontend/src/lib/pipelineFormat.ts's `formatIDRCompact` —
// same "duplicate rather than cross-package-import" call as STAGE_LABELS
// above. Used to verify the board's per-column value sums against a
// fresh API read, so this assertion holds regardless of how many
// pre-existing opportunities the shared dev DB already has in any stage.
function formatIDRCompact(value: number): string {
  if (value >= 1_000_000_000) {
    return `Rp ${(value / 1_000_000_000).toFixed(1).replace(".", ",")}M`;
  }
  if (value >= 1_000_000) {
    return `Rp ${(value / 1_000_000).toFixed(0)}jt`;
  }
  return `Rp ${value.toLocaleString("id-ID")}`;
}

interface ApiDeal {
  id: string;
  title: string;
  customerName: string;
  stage: (typeof STAGE_ORDER)[number];
  dealValue: number;
  stageOrder: number;
  wonAt: string | null;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Request failed ${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const data = await json<{ token: string }>(res);
  return data.token;
}

async function createDeal(
  token: string,
  body: { title: string; customerName: string; stage: string; dealValue: number },
): Promise<ApiDeal> {
  const res = await fetch(`${BASE_URL}/api/opportunities`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json<ApiDeal>(res);
}

async function getDeal(token: string, id: string): Promise<ApiDeal> {
  const res = await fetch(`${BASE_URL}/api/opportunities/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return json<ApiDeal>(res);
}

async function getAllDeals(token: string): Promise<ApiDeal[]> {
  const res = await fetch(`${BASE_URL}/api/opportunities`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return json<ApiDeal[]>(res);
}

async function deleteDeal(token: string, id: string): Promise<void> {
  // Best-effort, but never silent — a failed teardown otherwise leaks
  // e2e-prefixed rows into the shared DB with no trace in the run output.
  try {
    const res = await fetch(`${BASE_URL}/api/opportunities/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) {
      console.warn(`cleanup: DELETE /opportunities/${id} returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`cleanup: DELETE /opportunities/${id} threw`, err);
  }
}

function column(page: Page, stage: string) {
  return page.locator(`[data-slot="kanban-column"][data-value="${stage}"]`);
}

/**
 * Drags `cardTitle`'s grip into `targetStage`'s column body. Scrolls the
 * target column into view first (the board is one horizontal-scroll row —
 * see SolvroPipelineKanban.tsx's header comment — so a far column can start
 * outside the desktop viewport), then drops just below the column's own
 * header (a fixed `+80` offset from its top) rather than near the bottom:
 * `mapCommitToMove` (commitMapper.ts) reads its destination stage off
 * `meta.overContainer`, which resolves correctly whether the drop lands on
 * the column's own empty space OR directly on an existing card — so exactly
 * where inside the column doesn't matter, only that the point stays inside
 * it. Anchoring near the top avoids ever needing to know (or scroll to) the
 * bottom of a column that may already hold many pre-existing dev-DB deals.
 */
async function dragCardIntoColumn(page: Page, cardTitle: string, targetStage: string): Promise<void> {
  const col = column(page, targetStage);
  await col.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  const grip = await gripFor(page, cardTitle, "Drag to reorder");
  const box = await col.boundingBox();
  expect(grip, `grip for "${cardTitle}" not found`).toBeTruthy();
  expect(box, `column ${targetStage} not found`).toBeTruthy();

  const target = { x: box!.x + box!.width / 2, y: box!.y + Math.min(80, box!.height - 10) };
  await mouseDrag(page, center(grip!), target);
}

test.describe("pipeline board", () => {
  let token: string;
  let createdIds: string[] = [];
  let deals: {
    assessment: ApiDeal;
    rfp: ApiDeal;
    poc: ApiDeal;
    tech: ApiDeal;
    proposal: ApiDeal;
    waiting: ApiDeal;
  };

  test.beforeAll(async () => {
    token = await login();

    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const prefix = `e2e-pipeline-board-${stamp}`;
    const customerName = `${prefix}-customer`;

    const mk = (suffix: string, stage: string, dealValue: number) =>
      createDeal(token, { title: `${prefix}-${suffix}`, customerName, stage, dealValue });

    // Six deals across six distinct non-terminal stages — each transaction
    // touches only its own stage's stageOrder count (backend/src/routes/
    // opportunities.ts's POST "/"), so concurrent creation across DIFFERENT
    // stages is race-free.
    const [assessment, rfp, poc, tech, proposal, waiting] = await Promise.all([
      mk("assessment", "ASSESSMENT", 15_000_000),
      mk("rfp", "RFP", 32_000_000),
      mk("poc", "POC", 8_000_000),
      mk("tech", "TECHNICAL_CLARIFICATION", 45_000_000),
      mk("proposal", "DELIVER_PROPOSAL", 12_000_000),
      mk("waiting", "WAITING_RESPONSE", 60_000_000),
    ]);

    deals = { assessment, rfp, poc, tech, proposal, waiting };
    createdIds = [assessment.id, rfp.id, poc.id, tech.id, proposal.id, waiting.id];
  });

  test.afterAll(async () => {
    if (!token) return;
    await Promise.all(createdIds.map((id) => deleteDeal(token, id)));
  });

  // ---------------------------------------------------------------------
  // 1. Board render — both projects.
  // ---------------------------------------------------------------------
  test("renders KPI bar, all 9 columns, seeded deals in the right columns, and column value sums", async ({
    page,
  }) => {
    await loginViaUi(page);
    await page.goto("/pipeline", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // KPI bar (PipelineKpiBar.tsx's 4 tiles).
    await expect(page.getByText("Total Pipeline", { exact: true })).toBeVisible();
    await expect(page.getByText("Won this month", { exact: true })).toBeVisible();
    await expect(page.getByText("Active PICs", { exact: true })).toBeVisible();

    // All 9 PipelineStage columns render, each with its label.
    for (const stage of STAGE_ORDER) {
      const col = column(page, stage);
      await expect(col).toBeVisible();
      await expect(col.getByText(STAGE_LABELS[stage], { exact: true })).toBeVisible();
    }

    // Seeded cards land in the column matching their seeded stage.
    const placements: Array<[ApiDeal, string]> = [
      [deals.assessment, "ASSESSMENT"],
      [deals.rfp, "RFP"],
      [deals.poc, "POC"],
      [deals.tech, "TECHNICAL_CLARIFICATION"],
      [deals.proposal, "DELIVER_PROPOSAL"],
      [deals.waiting, "WAITING_RESPONSE"],
    ];
    for (const [deal, stage] of placements) {
      await expect(column(page, stage).getByText(deal.title, { exact: true })).toBeVisible();
    }

    // Column value sums — computed from a fresh API read so this holds
    // regardless of whatever else the shared dev DB already has per stage.
    // `.first()`: the column header's own sum span (SolvroPipelineKanban.tsx)
    // renders BEFORE any card in DOM order, but a pre-existing dev-DB card
    // can coincidentally carry the exact same compact-formatted dealValue
    // text as the column's aggregate sum (confirmed live: an existing "Rp
    // 1,5M" card collided with a column total of the same formatted value) —
    // `.first()` deterministically resolves to the header instance either way.
    const allDeals = await getAllDeals(token);
    for (const stage of STAGE_ORDER) {
      const sum = allDeals.filter((d) => d.stage === stage).reduce((s, d) => s + d.dealValue, 0);
      await expect(
        column(page, stage).getByText(formatIDRCompact(sum), { exact: true }).first(),
      ).toBeVisible();
    }
  });

  // ---------------------------------------------------------------------
  // 2. Cross-stage drag (non-terminal -> non-terminal) — desktop only
  //    (mouse PointerSensor; see this file's header comment for the mobile
  //    skip rationale).
  // ---------------------------------------------------------------------
  test("drag a card between two non-terminal stages: lands and persists after reload", async ({ page }) => {
    test.skip(
      test.info().project.name !== "desktop",
      "mouse drag cases run on the desktop project only (dnd-kit PointerSensor) — see file header for the mobile rationale",
    );
    await loginViaUi(page);
    await page.goto("/pipeline", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    await dragCardIntoColumn(page, deals.assessment.title, "RFP");

    // Lands immediately (client-side, before any reload).
    await expect(column(page, "RFP").getByText(deals.assessment.title, { exact: true })).toBeVisible();

    // Persists after reload — proves the server round-trip actually
    // happened, not just the optimistic local write.
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await expect(column(page, "RFP").getByText(deals.assessment.title, { exact: true })).toBeVisible();

    const updated = await getDeal(token, deals.assessment.id);
    expect(updated.stage).toBe("RFP");
  });

  // ---------------------------------------------------------------------
  // 3. Drag into WON: confirm dialog, cancel path, confirm path — desktop
  //    only (same rationale as #2).
  // ---------------------------------------------------------------------
  test("drag into WON: confirmation dialog, cancel restores origin, confirm marks Won", async ({ page }) => {
    test.skip(
      test.info().project.name !== "desktop",
      "mouse drag cases run on the desktop project only (dnd-kit PointerSensor) — see file header for the mobile rationale",
    );
    await loginViaUi(page);
    await page.goto("/pipeline", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // --- Cancel path -----------------------------------------------------
    await dragCardIntoColumn(page, deals.waiting.title, "WON");

    const confirmDialog = page.getByRole("dialog", { name: "Mark opportunity as Won?" });
    await expect(confirmDialog).toBeVisible();

    await confirmDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirmDialog).not.toBeVisible();

    // Card back at origin — no optimistic write ever fired for the WON
    // confirm path (SolvroPipelineKanban.tsx's handleValueCommit only calls
    // moveOpportunity.mutate for the NON-confirm path), so this is provable
    // both immediately and after a reload.
    await expect(
      column(page, "WAITING_RESPONSE").getByText(deals.waiting.title, { exact: true }),
    ).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await expect(
      column(page, "WAITING_RESPONSE").getByText(deals.waiting.title, { exact: true }),
    ).toBeVisible();

    const afterCancel = await getDeal(token, deals.waiting.id);
    expect(afterCancel.stage).toBe("WAITING_RESPONSE");
    expect(afterCancel.wonAt).toBeNull();

    // --- Confirm path ------------------------------------------------------
    await dragCardIntoColumn(page, deals.waiting.title, "WON");

    const confirmDialog2 = page.getByRole("dialog", { name: "Mark opportunity as Won?" });
    await expect(confirmDialog2).toBeVisible();
    await confirmDialog2.getByRole("button", { name: "Mark as Won", exact: true }).click();
    await expect(confirmDialog2).not.toBeVisible({ timeout: 10_000 });

    await expect(column(page, "WON").getByText(deals.waiting.title, { exact: true })).toBeVisible();

    const afterConfirm = await getDeal(token, deals.waiting.id);
    expect(afterConfirm.stage).toBe("WON");
    expect(afterConfirm.wonAt).not.toBeNull();

    // Open the deal — wonAt reflected (StageChip reads "Won") + the stage
    // change is logged as an activity row (POST /:id/move's
    // OpportunityActivity write, backend/src/routes/opportunities.ts).
    await page.goto(`/pipeline/${deals.waiting.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await expect(page.getByText("Won", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Moved from Waiting Response to Won/)).toBeVisible();
  });

  // ---------------------------------------------------------------------
  // 4. View switching — both projects (no drag involved).
  // ---------------------------------------------------------------------
  test("view switcher: List/Swimlane/Quarter render seeded deals, ?view= updates, survives reload", async ({
    page,
  }) => {
    await loginViaUi(page);
    await page.goto("/pipeline", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const group = page.locator('div[role="group"]');
    const listBtn = group.getByRole("button").filter({ hasText: "List" });
    const swimlaneBtn = group.getByRole("button").filter({ hasText: "Swimlane" });
    const quarterBtn = group.getByRole("button").filter({ hasText: "Quarter" });

    await listBtn.click();
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(/[?&]view=list/);
    await expect(listBtn).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(deals.rfp.title, { exact: true }).first()).toBeVisible();

    await swimlaneBtn.click();
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(/[?&]view=swimlane/);
    await expect(swimlaneBtn).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(deals.poc.title, { exact: true }).first()).toBeVisible();

    await quarterBtn.click();
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(/[?&]view=quarter/);
    await expect(quarterBtn).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(deals.tech.title, { exact: true }).first()).toBeVisible();

    // Switcher survives reload — `?view=` in the URL is what Pipeline.tsx's
    // own useState initializer reads on mount (Pipeline.tsx).
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/[?&]view=quarter/);
    await expect(page.getByText(deals.tech.title, { exact: true }).first()).toBeVisible();
  });

  // ---------------------------------------------------------------------
  // 5. Keyboard: a card's title link navigates to /pipeline/:id — both
  //    projects.
  // ---------------------------------------------------------------------
  test("keyboard: a card's title link is focusable and Enter navigates to the detail page", async ({ page }) => {
    await loginViaUi(page);
    await page.goto("/pipeline", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // OpportunityCard.tsx renders the title as a real `<a>` (`<Link>`) —
    // reachable by Tab, unlike the card's own onClick div. `.press()`
    // focuses the element before dispatching the key (Playwright's
    // documented behavior for element-scoped `press`), which is the
    // meaningful assertion here: this is a native anchor sitting in normal
    // tab order, so a real Tab sequence would reach it the same way: no
    // bespoke keydown handler to fake.
    const titleLink = page.getByRole("link", { name: deals.proposal.title, exact: true });
    await expect(titleLink).toBeVisible();
    await titleLink.press("Enter");

    await page.waitForURL(new RegExp(`/pipeline/${deals.proposal.id}`), { timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`/pipeline/${deals.proposal.id}`));
  });
});
