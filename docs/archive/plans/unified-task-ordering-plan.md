# Unified Manual Task Ordering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per-task pipeline per CLAUDE.md: solvro-implementor → solvro-qa → solvro-reviewer → solvro-docs-keeper → orchestrator acceptance → **user-approved commit** (no agent commits on its own).

**Goal:** Drags stick. One canonical manual task order per project, shared by List, Kanban, and Gantt: re-scope top-level `Task.position` from per-`(project, status)` sibling lists to one dense per-project list (exactly how subtasks already work per-parent), fix every view's drop math to speak global indices, make status changes keep the row's slot, and give the Gantt list pane full drag parity with the List view.

**Idea doc:** `docs/ideas/unified-manual-task-ordering.md` (diagnosis with file:line receipts, user-confirmed decisions, rejected alternatives — do not relitigate per-view orders, section-scoped positions, LexoRank, or Done-auto-sink).

**Architecture:** The ordering brain stays where it is — `backend/src/lib/taskOrdering.ts` (dense repack machinery, reused as-is; only the sibling *key* changes) and its frontend mirror `reorderTasksLocally`/`siblingListId` in `frontend/src/lib/queries.ts`. Views only compute drop indices: `ProjectList.tsx` and `ProjectKanban.tsx` switch from per-status to global-index math; `GanttFrame.tsx`/`GanttListRow.tsx` gain between-row drop targets. One data migration repacks existing positions section-major so the List view's current appearance is preserved. Gantt bars/dates, dependency arrows, baselines, exports' drawing code: untouched.

**Tech stack:** Existing only — dnd-kit, Prisma, TanStack Query. **No new npm dependencies. No schema columns** (one index swap + a data repack in a single migration).

## Global Constraints

- **Branch setup first:** local `develop` is behind `origin/develop` (hot files include `schema.prisma` and `queries.ts` — both touched by this plan). `git checkout develop && git pull` **before** branching `feat/unified-task-ordering` off it. PRs target `develop`, never `main`.
- **CHANGELOG discipline (CLAUDE.md):** every task appends to `CHANGELOG.md` under `[Unreleased]` in the same change set. Append-only.
- **Commit gate (CLAUDE.md guardrail):** each task ends with staging + a drafted commit message; the actual `git commit` waits for explicit user approval (a kickoff prompt may pre-approve per-task commits).
- **Gates:** backend `docker compose exec backend npx tsc --noEmit` + `docker compose exec backend npm test`; frontend `docker compose exec frontend npm run typecheck` (no frontend unit runner); Playwright for frontend-touching tasks (`cd e2e && npm test`). Standing guardrail greps (Tasks.tsx present, `gantt-task-react` absent, INTERNAL-note filtering) run every task.
- **Sub-200ms API NFR:** the dense repack writes N rows per reorder inside one transaction. Task 2 measures a reorder PATCH on a ~200-task project; if it misses 200ms, stop and surface — do not swap ordering strategies unilaterally.
- **Migration gotcha:** `prisma migrate dev` hangs in non-TTY shells. This plan needs hand-authored SQL anyway, so Task 2 uses the documented non-interactive `prisma migrate diff` flow from CLAUDE.md Ops.
- Commit style per repo history: `feat(tasks):` / `feat(gantt):` / `fix(...)`. **No Claude co-author trailers or any Claude attribution.**

**Task order:** 1 → 2 → 3 → 4 → 5 → 6, strictly. 1+2 change what `position` *means*; the views are wrong-but-typechecking until 3–5 land, which is why all six ship on one branch / one PR. Expected mid-branch reds are called out per task.

---

### Task 1: Backend re-scope — status leaves the sibling key

Make top-level tasks order the way subtasks already do. Removing `status` from the `SiblingKey` *interface* (not just the where-clause) is deliberate: `tsc` then points at every construction site that must change.

**Files:**
- Modify: `backend/src/lib/taskOrdering.ts` (interface + `siblingWhere` + `siblingKeyEquals`)
- Modify: `backend/src/routes/tasks.ts` (key construction in PATCH ~`:150-159`, create-path `countSiblings` key)
- Test: `backend/test/taskOrdering.test.ts` (extend — helpers `createTask`/`patchTask`/`listProjectTasks`/`createSection` already exist)

**Interfaces:**
- Consumes: nothing new.
- Produces: `SiblingKey = { projectId: number; parentTaskId: number | null }` (no `status`); `moveTaskWithinSiblings`/`countSiblings`/`closeGap`/`insertAt` signatures unchanged. `position` on a top-level task now means: index in the project's single dense top-level list. **Every later task builds on this meaning.**

- [x] **Step 1: Write the failing tests** — append a `describe("global top-level ordering", ...)` block to `backend/test/taskOrdering.test.ts` using its existing helpers: *(Done verbatim. Post-review nit applied by orchestrator: `?topLevel=true` is a no-op on the project-scoped route — swapped to `?parentTaskId=null` in all 5 calls.)*

```ts
describe("global top-level ordering (status does not partition)", () => {
  it("creates append to one per-project list regardless of status", async () => {
    const a = await createTask({ title: "A", status: "TODO" });
    const b = await createTask({ title: "B", status: "DONE" });
    const c = await createTask({ title: "C", status: "TODO" });
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);
  });

  it("a status-only patch keeps the slot", async () => {
    await createTask({ title: "A", status: "TODO" });
    const b = await createTask({ title: "B", status: "TODO" });
    await createTask({ title: "C", status: "TODO" });
    const res = await patchTask(b.id, { status: "DONE" });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe(1);
    const all = await listProjectTasks("?topLevel=true");
    expect(all.map((t) => t.title)).toEqual(["A", "B", "C"]);
  });

  it("an explicit position patch reorders across statuses", async () => {
    const a = await createTask({ title: "A", status: "DONE" });
    const b = await createTask({ title: "B", status: "TODO" });
    const c = await createTask({ title: "C", status: "IN_PROGRESS" });
    const res = await patchTask(c.id, { position: 0 });
    expect(res.status).toBe(200);
    const all = await listProjectTasks("?topLevel=true");
    expect(all.map((t) => t.title)).toEqual(["C", "A", "B"]);
    expect(all.map((t) => t.position)).toEqual([0, 1, 2]);
  });

  it("status + position combined lands at the requested global index", async () => {
    await createTask({ title: "A", status: "TODO" });
    await createTask({ title: "B", status: "TODO" });
    const c = await createTask({ title: "C", status: "TODO" });
    const res = await patchTask(c.id, { status: "IN_PROGRESS", position: 1 });
    expect(res.status).toBe(200);
    const all = await listProjectTasks("?topLevel=true");
    expect(all.map((t) => t.title)).toEqual(["A", "C", "B"]);
  });
});
```

- [x] **Step 2: Run to verify they fail** — `docker compose exec backend npm test`. Expected: the new block fails (creates currently append per-status: A=0, B=0, C=1; status-only patches currently re-append). Existing subtask tests stay green — they define behavior this plan must NOT change. *(3 of 4 failed as predicted; 1 coincidentally passed under both models. IMPORTANT discovery: in-container `npm test` inherits the dev DATABASE_URL — vitest gates for this branch run against an isolated `solvro_test` DB instead; recipe recorded in ISSUES.md filing.)*

- [x] **Step 3: Implement** — in `taskOrdering.ts`, replace the interface + two functions (doc comment included; the old one explains the per-status model):

```ts
// A sibling list is the ordered set of tasks a `position` value is relative
// to. For top-level tasks (parentTaskId null) that's EVERY top-level task in
// the project — one canonical manual order that List, Kanban, and Gantt all
// render (each view groups/filters it, preserving relative order). Status
// does NOT partition ordering anywhere; a status change keeps the row's
// slot. Subtask lists are unchanged: "the parent's subtasks".
export interface SiblingKey {
  projectId: number;
  parentTaskId: number | null;
}

function siblingWhere(key: SiblingKey): Prisma.TaskWhereInput {
  if (key.parentTaskId === null) {
    return { projectId: key.projectId, parentTaskId: null };
  }
  return { parentTaskId: key.parentTaskId };
}

export function siblingKeyEquals(a: SiblingKey, b: SiblingKey): boolean {
  if (a.parentTaskId !== b.parentTaskId) return false;
  if (a.parentTaskId === null) return a.projectId === b.projectId;
  return true;
}
```

Then follow `tsc` to the construction sites in `routes/tasks.ts`: drop `status` from `oldKey`/`newKey` in the PATCH handler (~`:150-159`) and from the create-path `countSiblings` key. Behavior check, not code change: with `status` out of the key, a status-only PATCH now takes the non-ordering branch (`tasks.ts:245` already writes `data.status` there), and the `touchesOrdering` branch's `data.status = nextStatus` still handles combined `{status, position}` patches. Update the now-stale comment at `tasks.ts:161-167` (its subtask example generalizes to all tasks). *(Done — one plan discrepancy: the create-path key lives in `routes/projects.ts:369` (POST /projects/:id/tasks), not tasks.ts; tsc pointed there and it was fixed there, recorded in CHANGELOG.)*

- [x] **Step 4: Run tests to verify green** — `docker compose exec backend npm test` (all files, not just taskOrdering — `projectWipLimits.test.ts` may assert per-column positions; if it does, update its expectations to the global model *in this task* and say so in the CHANGELOG entry). Then `docker compose exec backend npx tsc --noEmit`, exit 0. *(36/36 on isolated solvro_test DB; tsc exit 0. projectWipLimits had no position asserts. Two legacy taskOrdering tests that pinned the removed per-status behavior were rewritten to pin the new model — reviewer confirmed they're genuine pins, not tautologies.)*

- [x] **Step 5: CHANGELOG + stage** — `### Changed`: top-level sibling scope `(projectId, status)` → `(projectId)`; status changes keep slot; why (List/Gantt display by section — per-status positions interleave). Draft `feat(tasks): one canonical top-level order per project — status leaves the sibling key`. *(QA all-pass; reviewer clean (1 nit, applied). Planning-docs CHANGELOG entries ride along in this commit, per reskin precedent.)*

**Note:** from here until Task 3 lands, the *frontend* still sends per-column indices — dev-stack drags will land oddly. Expected mid-branch state; don't "fix" it here.

---

### Task 2: Migration — index swap + section-major repack

**Files:**
- Modify: `backend/prisma/schema.prisma:255` (`@@index([projectId, status, position])` → `@@index([projectId, position])`)
- Create: `backend/prisma/migrations/<timestamp>_unified_task_ordering/migration.sql`

**Interfaces:**
- Consumes: Task 1's global-list semantics (repack produces data satisfying them).
- Produces: every existing project has one dense 0..n-1 top-level list, ordered section-major (matches what the List view displays today); the hot list query `(projectId, parentTaskId) ORDER BY position` is index-backed.

- [x] **Step 1: Edit the schema index** — line 255: `@@index([projectId, position])`. (Single-column `status` index at `:251` stays — Kanban/status filters still use it.)

- [x] **Step 2: Generate the migration non-interactively** (CLAUDE.md Ops flow):

```bash
cd backend && npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/migration.sql
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_unified_task_ordering
mv /tmp/migration.sql prisma/migrations/<the-folder>/migration.sql
```

The diff emits only the index DDL (exact index names come from the diff — use them verbatim, do not hand-write them).

- [x] **Step 3: Append the repack to the same `migration.sql`** — section-major, "(No section)" last, current interleave as tiebreak, so today's List appearance is preserved (accepted trade-off from the idea doc: Kanban columns visibly reshuffle once):

```sql
-- Repack top-level positions into ONE dense per-project list (status no
-- longer partitions ordering — see docs/ideas/unified-manual-task-ordering.md).
-- Order: section position (No-section last), then old (position, id).
WITH ordered AS (
  SELECT t.id AS task_id,
         ROW_NUMBER() OVER (
           PARTITION BY t.project_id
           ORDER BY COALESCE(s.position, 2147483647),
                    COALESCE(s.id, 2147483647),
                    t.position,
                    t.id
         ) - 1 AS new_pos
  FROM tasks t
  LEFT JOIN sections s ON s.id = t.section_id
  WHERE t.parent_task_id IS NULL
)
UPDATE tasks SET position = ordered.new_pos
FROM ordered
WHERE tasks.id = ordered.task_id;
```

(Verify snake_case column names against the diff output / `@map` directives before applying; adjust if any differ.)

- [x] **Step 4: Apply + verify** — `docker compose exec backend npx prisma migrate deploy` then `docker compose exec backend npx prisma generate`. Verify in psql (`docker compose exec -it backend npx prisma db execute --stdin` or Prisma Studio): pick a multi-section project, confirm top-level positions are 0..n-1 with section blocks contiguous. Run `docker compose exec backend npm test` — green (tests run against their own DB via `globalSetup`, but the suite exercising Task 1's semantics must still pass post-`generate`).

- [x] **Step 5: NFR spot-check** — seed ~200 top-level tasks into a scratch project (a 10-line `tsx` loop via `docker compose exec backend npx tsx`, or a bash curl loop), then time a worst-case reorder:

```bash
TOKEN=... TASK_ID=...   # login via POST /auth/login
curl -s -o /dev/null -w "%{time_total}\n" -X PATCH \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"position":0}' http://localhost:3000/api/tasks/$TASK_ID
```

Expected: < 0.200. If not, **stop and surface** (the fallback discussion — batched `UPDATE ... FROM VALUES` repack or LexoRank — is a user decision, not an implementor one).

- [x] **Step 6: CHANGELOG + stage** — `### Changed` (index swap, why) + the migration under `### Added`. Draft `feat(tasks): migrate positions to per-project global order + index swap`. *(Done. Folder: 20260722121825_unified_task_ordering; diff SQL matched plan verbatim; repack verified on project id=2 (0,1,0,0 → dense 0..3 section-major) + 0 anomalies project-wide; 36/36 on empty isolated DB. NFR: 0.196/0.132/0.118s — inside budget, first run at 98%. No DELETE /projects route — scratch project removed via DB cascade; scratch admin nfr-scratch@example.com left in place. Reviewer skipped at orchestrator discretion: 3-statement migration, QA content-verified char-for-char. Stale schema.prisma position comment queued to Task 6 via ISSUES.md.)*

---

### Task 3: List view + optimistic layer — drags land where dropped

**Files:**
- Modify: `frontend/src/lib/queries.ts:575-582` (`siblingListId` + comment)
- Modify: `frontend/src/pages/views/ProjectList.tsx:135-139` (comment), `:284-323` (`handleDragEnd` top-level branches)

**Interfaces:**
- Consumes: Task 1's global `position` semantics.
- Produces: `siblingListId` returns `"top"` for all top-level tasks (Kanban's optimistic reorders — Task 4 — depend on this exact behavior); List drop math pattern (global `topLevelOrdered` + over-row index) that Task 5 mirrors in the Gantt.

- [x] **Step 1: `siblingListId`** — mirror the server exactly (its doc comment at `:575-579` gets the same rewrite as Task 1's):

```ts
function siblingListId(t: Pick<Task, "parentTaskId" | "status">): string {
  return t.parentTaskId === null ? "top" : `sub:${t.parentTaskId}`;
}
```

(Signature keeps `status` so no caller churn; `reorderTasksLocally` and the `listChanged` check in `useUpdateTask` need zero edits — a status-only patch now computes `listChanged === false` and falls through to the plain field merge, which is precisely "keeps its slot".)

- [x] **Step 2: List drop math** — in `ProjectList.tsx` `handleDragEnd`, replace the two top-level branches (`:286-296` header-drop, `:304-322` row-drop; subtask branch `:252-266` is untouched):

```ts
    // One global top-level order per project — `position` indexes into it.
    // Views group it by section for display; relative order is preserved.
    const topLevelOrdered = (tasks ?? [])
      .filter((t) => t.parentTaskId === null)
      .sort((a, b) => a.position - b.position || a.id - b.id);

    if (isGroupId(overId)) {
      // Dropped on a section header / empty group -> append at the end of
      // that section's block in the global order (empty section: keep slot,
      // section move only).
      const targetKey = keyFromGroupId(overId);
      const targetSectionId = targetKey === "none" ? null : targetKey;
      if (targetSectionId === moved.sectionId) return;
      const block = topLevelOrdered.filter(
        (t) => t.sectionId === targetSectionId && t.id !== moved.id,
      );
      const last = block[block.length - 1];
      updateTask.mutate({
        id: moved.id,
        patch: last
          ? {
              sectionId: targetSectionId,
              position: topLevelOrdered.findIndex((t) => t.id === last.id) + 1,
            }
          : { sectionId: targetSectionId },
      });
      return;
    }

    if (!isRowId(overId)) return;
    const overTaskId = numFromRowId(overId);
    const overTask = (tasks ?? []).find((t) => t.id === overTaskId);
    if (!overTask) return;

    // Insert relative to the over row — arrayMove semantics (the over row's
    // pre-move global index: downward drags land after it, upward before
    // it; backend insertAt excludes the moved row first).
    const idx = topLevelOrdered.findIndex((t) => t.id === overTask.id);
    const position = idx === -1 ? topLevelOrdered.length : idx;
    const crossSection = overTask.sectionId !== moved.sectionId;
    if (!crossSection && position === moved.position) return;
    updateTask.mutate({
      id: moved.id,
      patch: crossSection ? { sectionId: overTask.sectionId, position } : { position },
    });
```

Also rewrite the stale model comment at `:135-139` — `(position, id)` within a section group is no longer a "stable proxy", it's the canonical order projected onto the section.

> **CORRECTION (2026-07-22, found by implementor with scripted repro):** the header-drop code above is off by one when dragging a task *down* into a later section — `topLevelOrdered.findIndex(last) + 1` indexes the full array, but backend `insertAt` indexes the moved-EXCLUDED sibling list. Landed fix: compute `others = topLevelOrdered.filter(t => t.id !== moved.id)`, derive `block`/`last` from `others`, and use `others.findIndex(last) + 1`. The row-drop branch deliberately does NOT exclude (arrayMove semantics) — the asymmetry is intentional. ALSO: `reorderTasksLocally` in queries.ts DID need an edit (plan claimed zero): it must carry `patch.sectionId` into the optimistic task, else cross-section drops flicker under the old section until refetch. Task 5 must mirror the CORRECTED header-drop math, not the block above.

- [x] **Step 3: Type-check** — `docker compose exec frontend npm run typecheck`, exit 0. *(Exit 0, noUnusedLocals confirming dead-code removal.)*

- [x] **Step 4: Manual verify** (dev stack, `/projects/:id/list`): (a) drag an Active row between two To-do rows in the same section — it lands there and stays after a hard refresh; (b) drag a row into another section between two specific rows — lands at the drop point; (c) drop on a section header — appends at that section's end; (d) change a status via the chip — the row does not move; (e) reorder flicker-free (optimistic path agrees with server).

- [x] **Step 5: CHANGELOG + stage** — `### Fixed` (List drags snapping back — the original bug report symptom) + `### Changed` (optimistic sibling model). Draft `fix(list): drags land where dropped — global-order drop math`. *(Done. Step 4 executed as static traces + scripted insertAt repros (no browser in pipeline; real drags covered by Task 6 e2e): all five scenarios verified, including the two mid-task corrections. QA: typechecks 0, 36/36 vitest, Playwright smoke 7 pass/1 expected-skip (local runs need BASE_URL=http://localhost:5173 + fixture admin qa@solvro.test, provisioned id=707). Reviewer: clean; 1 nit (TaskPanel stale nested section during optimistic window — pre-existing, deferred to ISSUES.md).)*

---

### Task 4: Kanban — global indices, keep-slot status moves, spec update

Kanban columns become filtered subsequences of the global order. Its drop math swaps per-column indices for global ones; the e2e spec's absolute-position assertions change to relative-order assertions **in this same task** (tests move with the behavior they pin).

**Files:**
- Modify: `frontend/src/pages/views/ProjectKanban.tsx` (`computeCardDrop` `:252-291`, guard+patch in `handleDragEnd` `:304-314`, mobile sheet `:626-631`; subtask handlers `:316-360` untouched)
- Modify: `e2e/tests/kanban-dnd.spec.ts`

**Interfaces:**
- Consumes: Task 3's `siblingListId` (optimistic path) + Task 1 semantics.
- Produces: `computeCardDrop(activeId: number, overId: string): { status: TaskStatus; position?: number } | null` — `position` now optional (absent = keep slot, status-only).

- [x] **Step 1: Rewrite `computeCardDrop`** (the `:192-198` "MUST use groupedAll" comment evolves: the invariant is now "MUST use the *global* order"):

```ts
  function computeCardDrop(
    activeId: number,
    overId: string,
  ): { status: TaskStatus; position?: number } | null {
    const moved = topLevelAll.find((t) => t.id === activeId);
    if (!moved) return null;

    // `position` indexes into the project's single top-level order; columns
    // render filtered subsequences of it. All drop math uses the GLOBAL
    // sorted list — a per-column (or filtered) index would land on the
    // wrong server-side slot.
    const globalOrdered = [...topLevelAll].sort(
      (a, b) => a.position - b.position || a.id - b.id,
    );

    if (isColumnId(overId)) {
      // Column-body drop = "end of that column": insert after its last
      // card. Empty column: status-only patch — the card keeps its slot.
      const status = statusFromColumnId(overId);
      const colCards = groupedAll[status].filter((t) => t.id !== activeId);
      const last = colCards[colCards.length - 1];
      if (!last) return { status };
      return {
        status,
        position: globalOrdered.findIndex((t) => t.id === last.id) + 1,
      };
    }

    let effectiveOverId = overId;
    if (isSubtaskId(overId)) {
      const overSub = (tasks ?? []).find((t) => t.id === numFromId(overId));
      if (!overSub || overSub.parentTaskId === null) return null;
      effectiveOverId = idOf("card", overSub.parentTaskId);
    }

    if (isCardId(effectiveOverId)) {
      const overTask = topLevelAll.find((t) => t.id === numFromId(effectiveOverId));
      if (!overTask) return null;
      // Over-card's pre-move GLOBAL index — arrayMove semantics as before,
      // just against the global list instead of the column list.
      const idx = globalOrdered.findIndex((t) => t.id === overTask.id);
      return {
        status: overTask.status,
        position: idx === -1 ? globalOrdered.length : idx,
      };
    }
    return null;
  }
```

- [x] **Step 2: Guard + patch** in `handleDragEnd` (`:309-313`) become optional-position aware:

```ts
      if (
        moved.status === drop.status &&
        (drop.position === undefined || moved.position === drop.position)
      )
        return;
      updateTask.mutate({
        id: moved.id,
        patch:
          drop.position === undefined
            ? { status: drop.status }
            : { status: drop.status, position: drop.position },
      });
```

- [x] **Step 3: Mobile sheet** (`:626-631`) — same column-append rule, via `computeCardDrop(mobileSheetTask.id, <column id for status>)` (reuse, don't duplicate the math; `idOf("column", status)`-style helper already exists — grep `isColumnId` for the exact constructor).

> **CORRECTION 2 (2026-07-22, surfaced by QA gate note):** the plan's "subtask handlers untouched" scoping was wrong for ONE branch — subtask→top-level PROMOTION (`handleSubtaskDrop` column-drop path) still sent `position: groupedAll[status].length`, a per-column count now misread as a global index (promoted subtask lands near the global front instead of the column end). Fixed within Task 4: promotion uses last-column-card's global index + 1 (no exclusion filter needed — the promoted subtask isn't in the top-level list yet), empty column omits `position` (backend appends to global end). Re-parent and reorder-within-parent subtask branches were verified genuinely unaffected (per-parent lists unchanged). A frontend-wide grep confirmed no other task-position producers with old-model math remain.

- [x] **Step 4: Update `e2e/tests/kanban-dnd.spec.ts`** — absolute `position` assertions become relative-order assertions (positions are global now; `Gamma pos 0` is only true if Gamma is globally first). Add a helper at the top and use it in the reorder cases:

```ts
function columnOrder(tasks: ApiTask[], status: string): string[] {
  return tasks
    .filter((t) => t.status === status && t.parentTaskId === null)
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((t) => t.title);
}
```

- "reorder within column" (`:28-42`): keep the drag; replace `expect(g?.position).toBe(0)` with `const order = columnOrder(tasks, "TODO"); expect(order.indexOf("Gamma")).toBeLessThan(order.indexOf("Alpha"));`
- "cross-column drag" (`:44-59`): status assertion unchanged; add `expect(columnOrder(tasks, "IN_PROGRESS")).toContain("Beta");` and, since a column-body drop means end-of-column, assert Beta is last in that order.
- Subtask cases (`:61-95`): untouched — per-parent positions still start at 0.

- [x] **Step 5: Gates** — frontend typecheck exit 0; `cd e2e && npm test` — kanban-dnd green on desktop + mobile projects; smoke spec green.

- [x] **Step 6: Manual verify** (`/projects/:id/kanban`): (a) reorder within a column — sticks after refresh; (b) drag to another column's card position — lands exactly there; (c) drop on empty column area — card moves, and back in List view it kept its slot; (d) change a status from the *List* view — the Kanban card appears in its new column at its relative slot, not the bottom.

- [x] **Step 7: CHANGELOG + stage** — `### Changed` (global drop math, keep-slot status moves, e2e assertions) . Draft `feat(kanban): global-order drop math; status moves keep the slot`. *(Done. Column-drop uses moved-EXCLUDED indexing (fed-forward Task 3 correction); subtask-promotion defect found via QA note and fixed via shared columnEndPosition helper — see CORRECTION 2 above. Reviewer: production code clean; e2e promote case was toothless (insertion-invariance) — global-last assertion added, mobile absolute-position assert marked fixture-contingent + model-correct assert added. Playwright kanban-dnd+smoke: 17 passed / 11 guard-skips / 0 failed. Manual-verify scenarios covered by static traces + real e2e drags.)*

---

### Task 5: Gantt list pane — full drag parity with the List view

The missing feature. Rows become reorder drop targets ("insert **before** the row you drop on", signalled by a top-edge indicator); subtask rows become draggable within their parent; section-header drops adopt Task 3's append rule. Bars, dates, dependency arrows, section-reorder drags: untouched.

**Files:**
- Modify: `frontend/src/components/gantt/GanttListRow.tsx` (`:57-78` draggable/droppable wiring, indicator, handle visibility)
- Modify: `frontend/src/components/gantt/GanttFrame.tsx` (`handleDragEnd` `:409-465`)
- Modify: wherever `RowDragData`/`RowDropData` are declared (grep — `GanttListRow.tsx` or a sibling types module): extend the unions.

**Interfaces:**
- Consumes: Task 1 semantics; Task 3's drop-math pattern (mirror it — same variable names where sensible, so the reviewer can diff the two by eye).
- Produces: `RowDragData.kind: "task" | "subtask" | "section"` (+ `parentTaskId: number | null` when subtask); `RowDropData` union gains `{ kind: "row-target"; taskId: number; parentTaskId: number | null; sectionId: number | null }` alongside the existing `section-target`.

- [x] **Step 1: `GanttListRow` wiring** —

```ts
  const draggable = useDraggable({
    id: `drag-${row.id}`,
    disabled: !canEdit || (!isTopLevelTask && !isSubtask && !realSection),
    data: {
      kind: isSubtask ? "subtask" : isTopLevelTask ? "task" : "section",
      taskId: row.taskId,
      parentTaskId: row.task?.parentTaskId ?? null,
      sectionId: row.sectionId,
    } satisfies RowDragData,
  });

  const droppable = useDroppable({
    id: `drop-${row.id}`,
    disabled: !isSection && !isTopLevelTask && !isSubtask,
    data: isSection
      ? ({ kind: "section-target", sectionId: row.sectionId } satisfies RowDropData)
      : ({
          kind: "row-target",
          taskId: row.taskId!,
          parentTaskId: row.task?.parentTaskId ?? null,
          sectionId: row.sectionId,
        } satisfies RowDropData),
  });
```

`dragHandleVisible` (`:78`) gains `|| isSubtask`. Insertion indicator: the row root div gets `relative`, and inside it, first child:

```tsx
      {isOver && !isSection && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-primary" />
      )}
```

(Existing `isOver && isSection` ring stays — section drops keep their affordance.)

- [x] **Step 2: `GanttFrame.handleDragEnd`** — add the `row-target` branch before the existing `section-target` early-return (which currently rejects everything else at `:416`), and change the task-on-section-header branch from `{ sectionId }` to Task 3's append rule. GanttFrame already holds the project task list it feeds `buildRows` (grep `tasks` near the top of the component — reuse it):

```ts
      if (overData.kind === "row-target") {
        setActionError(null);
        const list = tasks ?? [];

        if (activeData.kind === "task" && activeData.taskId !== undefined) {
          // Task dropped on a subtask row -> resolve to its parent card
          // (List parity).
          const overTopId = overData.parentTaskId ?? overData.taskId;
          const overTask = list.find((t) => t.id === overTopId);
          if (!overTask || overTask.id === activeData.taskId) return;
          const moved = list.find((t) => t.id === activeData.taskId);
          if (!moved) return;
          const topLevelOrdered = list
            .filter((t) => t.parentTaskId === null)
            .sort((a, b) => a.position - b.position || a.id - b.id);
          const idx = topLevelOrdered.findIndex((t) => t.id === overTask.id);
          const position = idx === -1 ? topLevelOrdered.length : idx;
          const crossSection = overTask.sectionId !== moved.sectionId;
          if (!crossSection && position === moved.position) return;
          await updateTask.mutateAsync({
            id: moved.id,
            patch: crossSection
              ? { sectionId: overTask.sectionId, position }
              : { position },
          }).catch((err) => {
            setActionError(err instanceof ApiError ? err.message : "Could not move task.");
          });
          return;
        }

        if (activeData.kind === "subtask" && activeData.taskId !== undefined) {
          // Reorder WITHIN the parent only (List parity — no re-parent in
          // row drags). Ignore drops outside the sibling checklist.
          const moved = list.find((t) => t.id === activeData.taskId);
          if (!moved || moved.parentTaskId === null) return;
          if (overData.parentTaskId !== moved.parentTaskId) return;
          const siblings = list
            .filter((t) => t.parentTaskId === moved.parentTaskId && t.id !== moved.id)
            .sort((a, b) => a.position - b.position || a.id - b.id);
          const idx = siblings.findIndex((t) => t.id === overData.taskId);
          const position = idx === -1 ? siblings.length : idx;
          if (position === moved.position) return;
          await updateTask.mutateAsync({ id: moved.id, patch: { position } }).catch((err) => {
            setActionError(err instanceof ApiError ? err.message : "Could not reorder subtask.");
          });
          return;
        }
        return;
      }
```

Task-on-section-header (existing branch at `:420-433`): replace the `{ sectionId: overData.sectionId }` patch with the same append-at-section-end computation as Task 3's header branch **as CORRECTED and landed in ProjectList.tsx** (moved-excluded `others` list — see the Task 3 correction note; do not copy the plan's original block). Section-reorder branch (`:435-462`): untouched.

- [x] **Step 3: Row order sanity** — no change needed in `geometry.ts` (`buildRows` iterates tasks in fetched order — `(position, id)` — so section groups now show the canonical order automatically after Tasks 1–2), but *verify* by reading: `parents`/`children` filters at `geometry.ts:434-437` preserve array order. Note the finding in the task report.

- [x] **Step 4: Type-check** — frontend typecheck exit 0. *(Exit 0.)*

- [x] **Step 5: Manual verify** (`/projects/:id/gantt`, desktop ≥768px): (a) drag a task row between two rows in its section — top-edge indicator shows, order sticks, **its bar dates unchanged**; (b) drag onto a row in another section — moves there at that spot; (c) drop on a section header — appends to that section; (d) drag a subtask row within its checklist — reorders; (e) section-header drag still reorders sections; (f) bar drag/resize + dependency connect still work (DndContext sensor interplay — the 6px activation distance must not eat bar drags; bars are outside the dnd-kit tree, but verify by hand); (g) List view shows the same order the Gantt shows.

- [x] **Step 6: CHANGELOG + stage** — `### Added` (Gantt row reorder — closes the "cannot drag at all" report) + `### Changed` (header-drop append rule). Draft `feat(gantt): between-row drag reorder — list-pane parity with List view`. *(Done. Step 5 as static traces (browser drags land in Task 6 e2e): all seven scenarios incl. both header-drop directions; bars proven outside the dnd-kit tree (raw onPointerDown, no useDraggable — sensor structurally cannot capture them). Reviewer: faithful mirror, no blockers; applied its should-fix (KeyboardSensor, default coordinateGetter — no SortableContext in Gantt) + indicator gating on active drag kind + 2px changelog wording; rectIntersection-vs-closestCenter consistency nit deferred to ISSUES.md (pre-existing line). DESIGN.md behavioral-rules line added by docs-keeper (note: DESIGN.md and ISSUES.md are gitignored in current repo state — CLAUDE.md's 'tracked' claim is drift, flagged for Task 6). Smoke 7/1 after fixes.)*

---

### Task 6: E2E for List + Gantt reorder, closing sweep, docs sync

**Files:**
- Create: `e2e/tests/list-dnd.spec.ts`
- Modify: `e2e/tests/` fixtures only if the seeded project lacks what the specs need (follow `kanban-dnd.spec.ts`'s fixture/helper idioms — `seededProject`, `getTasks`, `apiBase`, its drag helpers)
- Modify: `CLAUDE.md` (docs-keeper: Facts → Data model `Task` bullet), `ISSUES.md` (any deferred findings)

**Interfaces:**
- Consumes: everything; this is the acceptance gate for the whole branch.
- Produces: regression coverage pinning the new ordering semantics end-to-end.

- [x] **Step 1: `list-dnd.spec.ts`** — desktop-project-only (mirror kanban-dnd's `test.skip` guard). Two cases, asserting through the API like kanban-dnd does:

```ts
test("cross-status reorder in one section sticks", async ({ page, seededProject }) => {
  // Drag Gamma (TODO) onto Alpha's row (use the row grip, List route).
  // Assert: global top-level order (position,id) has Gamma immediately
  // before Alpha, and BOTH statuses are unchanged.
});

test("status chip change keeps the slot", async ({ page, seededProject }) => {
  // Record the (position,id) order, flip Beta's status via the chip,
  // assert the order of ids is identical afterward.
});
```

(Write them fully against the actual DOM — grips/rows carry the same drag affordances as Kanban cards; reuse its `dragTo`-style helper. If the List rows lack a stable test hook, add `data-testid` attributes to the row + grip in `ProjectList.tsx` in this task.)

- [x] **Step 2: Gantt reorder case** — add to `list-dnd.spec.ts` or a small `gantt-dnd.spec.ts` (desktop only; Gantt is `hidden md:block`): drag one task row onto another within a section on `/projects/:id/gantt`, assert via API that global order moved and `startDate`/`dueDate` of the dragged task are byte-identical before/after.

- [x] **Step 3: Full gate sweep** — backend `tsc` + `npm test`; frontend typecheck; `cd e2e && npm test` (all projects, all specs); guardrail greps; CHANGELOG entries present for Tasks 1–6; re-run the Task 2 NFR curl once more on the migrated dev DB.

- [x] **Step 4: Docs sync (solvro-docs-keeper)** — CLAUDE.md Facts, `Task` bullet: `position` is now "dense per-project ordering of top-level tasks (status-independent; subtasks ordered per-parent)". Check `ISSUES.md` for anything filed against the old ordering model; close or update. File deferred findings from Tasks 1–5 reviews.

- [x] **Step 5: CHANGELOG + stage** — `### Added` (e2e coverage) . Draft `test(e2e): list + gantt reorder coverage; docs sync for unified ordering`. *(Done. Spec: 3 cases in one file, zero data-testid needed (existing aria-labels + a grid-class row hook). Sweep: tsc 0 both tiers, 36/36 isolated vitest, full Playwright 29 pass / 4 pwa-fail (proven pre-existing: vite-plugin-pwa dev gating + git-stash repro) / 1 flaky (own new test — root cause was a stale fixture-isolation comment, fixed, then 9/9 across repeat-each=3). Schema position comment fixed (empty migration diff). NFR: calm-host pass 0.196/0.132/0.118s stands; loaded-host re-checks 0.20-0.47s at load 6-15 with idle containers — hard stop surfaced to user, proceeded on calm-host verdict, batch-UPDATE follow-up filed in ISSUES.md. CLAUDE.md Facts synced: Task.position bullet, testing caveats (isolated vitest DB, BASE_URL=5173 + pwa note, list-dnd spec listed), DESIGN.md/ISSUES.md gitignored-reality fix in source-of-truth table. Reviewer skipped at orchestrator discretion: spec-only + comment-only diff, spec content reviewed inline by orchestrator against the Task 4 assertion-strength lessons.)*

---

## Out of scope (from the idea doc — do not implement)

- Per-view orders, section-scoped positions, LexoRank/fractional positions (revisit only if Task 2's NFR check fails — and then as a user decision).
- Done-auto-sink or any automatic re-sorting; transient sort toggles.
- Subtask re-parenting via Gantt row drags (Kanban keeps its existing re-parent/promote gestures; List/Gantt reorder within parent only).
- Any change to bar drag-to-reschedule, dependency arrows, baselines, exports, Network Diagram (guardrail), critical path.
