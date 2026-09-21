# Implementation Plan: Kanban → ReUI Engine Swap

> Source spec: `docs/ideas/kanban-reui-swap.md` (Direction A + risk register).
> Sequencing is risk-register-shaped: R7 mandates scenario table + mapper tests
> **before** any UI wiring, measurements at spike end, old board intact until a
> deliberate cutover. Plan drafted 2026-07-26; no code has been written.

## Overview

Replace the hand-rolled Kanban orchestration (`ProjectKanban.tsx`, 1,182 lines) with
the vendored ReUI Kanban engine plus a Solvro layer (`components/kanban-v2/`) on the
`gantt-v2/` precedent. Subtask dragging is retired from the board (modal path already
exists at `TaskFormModal.tsx:359`); the inline checklist keeps its toggle. The new
board runs in parallel at `/projects/:id/kanban2` until a deliberate cutover flips
the route.

## Architecture Decisions

1. **Parallel route, not in-place replacement.** New board mounts at
   `/projects/:id/kanban2` (route in `App.tsx` only — no tab in `ProjectDetail.tsx`).
   Old `ProjectKanban.tsx` is byte-for-byte untouched until cutover (R6/R7:
   rollback = don't flip the route).
2. **Copy, don't extract, the card visuals.** `TaskCard`/`SubtaskRow`/
   `MobileMoveSheet` are module-private in the old file; they get *copied* into
   `kanban-v2/cards.tsx` rather than exported from the old file. Deliberate temporary
   duplication — zero risk to the live board; the duplicate dies with the old file at
   cutover.
3. **Mapper is pure and dnd-free.** `commitMapper.ts` takes (unfiltered global task
   list, committed per-column arrays, filter state) → `{ status, position? } | null`
   (null = no-op, skip the PATCH). It imports nothing from dnd-kit — if a test ever
   needs to mock dnd internals, the abstraction is being fought (R1 early-warning).
   Position semantics follow `backend/src/lib/taskOrdering.ts` `insertAt`: index into
   the **moved-excluded** sibling list, derived neighbor-based from the committed
   arrangement (predecessor-in-column → its moved-excluded global index + 1; no
   predecessor → successor's moved-excluded global index; empty column → status-only).
4. **Frontend gets a unit test runner.** Frontend currently has typecheck only; the
   R2 mitigation (mapper tests before UI) requires Vitest in `frontend/` (new devDep +
   config). Smallest possible footprint: node environment, `src/**/*.test.ts` only.
5. **Single write path.** `onValueCommit` → mapper → existing `useUpdateTask`
   optimistic mutation (`queries.ts:655`). During a live drag, the adapter's local
   projection is authoritative and query-derived state is frozen (R5); sync resumes at
   rest. `restoreOnCancel` enabled.
6. **Patch policy (R1).** Vendor patches may *configure* (sensor timing, classNames),
   never add drag semantics. Budget reference: Gantt precedent is 3 sites. Every patch
   site gets a `// SOLVRO PATCH` marker + CHANGELOG entry in the same turn. A
   requirement inexpressible outside the vendor file falls back to Direction C **for
   that requirement**, not a project abort.
7. **e2e assertion style.** Keep the existing API-readback pattern (`getTasks` after
   gesture — asserts server state, stronger than payload sniffing). The one addition:
   request-**absence** assertions for no-op drops (drop-in-place must fire no PATCH).
8. **Promote-subtask affordance: modal only for MVP.** The "Promote to task" row-menu
   shortcut is deferred; R6's dogfood window decides whether it's needed (filed as a
   follow-up candidate for ISSUES.md at cutover, not built now).

## Dependency Graph

```
T1 scenario table ──┬─→ T5 adapter + mapper + unit tests ─→ T6 static board ─→ T7 drag wiring ─→ T8 filters/checklist ─→ T9 mobile
                    └─→ T2 e2e coverage audit ────────────────────────────────────────────────→ T10 e2e augmentation ─→ T11 cutover ─→ T12 docs sync
T3 vendor install ─────────────────────────────────────────→ T6
T4 frontend vitest ─→ T5
```

Parallelizable: T2 ∥ (T3, T4); T3 ∥ T4. Everything else is sequential along its chain.
High-risk work (mapper correctness) is front-loaded by design.

---

## Task List

### Phase 0 — Behavior spec (read-only groundwork)

#### Task 1: Scenario table — the old file is the spec

**Description:** Mine `ProjectKanban.tsx`'s comments and logic (lines 48–130 collision
rules, 192–340 global-order drop math, 381–426 subtask drops) plus
`taskOrdering.ts` `insertAt` semantics into a scenario table: *given* board state +
gesture → *expected* PATCH payload (or explicit no-op). Include filter-active
variants of every card-drop row and the retired-subtask rows marked "modal path".

**Acceptance criteria:**
- [ ] Every comment-documented behavior in the three line ranges has a row with an expected `{ status, position? }` or "no request"
- [ ] Each row's expected position is cross-checked against `insertAt`'s moved-excluded clamp semantics
- [ ] Filter-active variants exist for reorder, cross-column, and column-body drops

**Verification:** Human review of the table (CP0) — this is the spec of record for T5 and T10.
**Dependencies:** None.
**Files:** `docs/plans/kanban-reui-swap/scenarios.md` (new).
**Scope:** S (1 doc file).

#### Task 2: e2e coverage audit

**Description:** Matrix `e2e/tests/kanban-dnd.spec.ts`'s 10 existing cases against the
T1 table. Known-expected gaps to confirm: on-card insertion drop (spec deliberately
avoided it as brittle), drop-in-place no-op, filter-active drop, cross-view List
parity (R3). Flag the three subtask-drag cases for modal-path rewrite.

**Acceptance criteria:**
- [ ] Every T1 row is marked covered / gap / obsolete-gesture, appended to `scenarios.md`
- [ ] Gap list explicitly names the new e2e cases T10 must add

**Verification:** Table complete; no scenario row unclassified.
**Dependencies:** T1.
**Files:** `docs/plans/kanban-reui-swap/scenarios.md` (append).
**Scope:** S.

### Checkpoint 0 — after T1–T2
- [ ] User has reviewed the scenario table (it becomes binding on T5/T10)
- [ ] Gap list agreed; no code yet

### Phase 1 — Pure logic first (R7 sequencing)

#### Task 3: Vendor `@reui/kanban`

**Description:** `npx shadcn@latest add @reui/kanban` into `frontend/` (host + container
`npm i` per node-modules sync rule). Files must land in `components/reui/kanban/`.
Record the vendored file inventory. **Zero patches at install** — any immediate urge
to patch is recorded as a finding, not acted on.

**Acceptance criteria:**
- [ ] Vendored files present; no modifications (patch count = 0 recorded)
- [ ] No new runtime deps beyond the already-present dnd-kit/base-ui set
- [ ] CHANGELOG entry same turn

**Verification:** `docker compose exec frontend npm run typecheck` green; `git diff --stat` shows only vendored files + lockfile.
**Dependencies:** None (parallel with T1/T2/T4).
**Files:** `frontend/src/components/reui/kanban/*` (new), `frontend/package.json` if the CLI adds anything, `CHANGELOG.md`.
**Scope:** S.

#### Task 4: Frontend Vitest setup

**Description:** Add Vitest to `frontend/` devDeps with a minimal node-environment
config scoped to `src/**/*.test.ts`, plus an `npm test` script. Container + host
install both run.

**Acceptance criteria:**
- [ ] A trivial placeholder test passes in the container
- [ ] `npm run typecheck` unaffected
- [ ] CHANGELOG entry same turn

**Verification:** `docker compose exec frontend npm test` green.
**Dependencies:** None.
**Files:** `frontend/package.json`, `frontend/vitest.config.ts` (new), `CHANGELOG.md`.
**Scope:** S.

#### Task 5: Adapter + commit-mapper + unit tests

**Description:** `kanban-v2/adapter.ts` — project unfiltered global order + filter
state → `Record<TaskStatus, Task[]>` for ReUI's `value`. `kanban-v2/commitMapper.ts`
— committed arrangement → `{ status, position? } | null` per Architecture Decision 3,
including the no-op guard (`previousValue` deep-equal → null). Every T1 scenario row
becomes a unit test, written against the table **before** the implementation.

**Acceptance criteria:**
- [ ] All T1 scenario rows (including filter-active and no-op rows) pass as unit tests
- [ ] Neither module imports from `@dnd-kit/*` or the vendored kanban
- [ ] Empty-column drops produce status-only patches (no position field)

**Verification:** `docker compose exec frontend npm test` green; typecheck green.
**Dependencies:** T1, T4.
**Files:** `frontend/src/components/kanban-v2/adapter.ts`, `commitMapper.ts`, `adapter.test.ts`, `commitMapper.test.ts` (all new), `CHANGELOG.md`.
**Scope:** M (4–5 files).

### Checkpoint 1 — after T3–T5 (expressiveness gate)
- [ ] Mapper tests green against the full scenario table
- [ ] Zero vendor patches so far; nothing found that requires a *semantic* patch
- [ ] If any requirement can't be expressed outside the vendor file → stop, present the Direction-C-per-requirement tradeoff to the user before Phase 2

### Phase 2 — Vertical UI slices at `/kanban2` (old board untouched)

#### Task 6: Static board slice

**Description:** `SolvroKanban.tsx` renders the ReUI board from the adapter projection
at new route `/projects/:id/kanban2` (App.tsx route only, no tab). Copies of
`TaskCard`/`SubtaskRow` land in `kanban-v2/cards.tsx` (Decision 2). Includes WIP
chips, permission gating (`KanbanItem disabled` when `!task:write`), `?task=`
deep-link on card click, toolbar + Add-task modal. No drag persistence yet.

**Acceptance criteria:**
- [ ] `/kanban2` renders the three columns with parity visuals against `/kanban` side by side
- [ ] Card click opens the task panel via `?task=`; WIP over-limit chip shows amber
- [ ] Old file untouched (`git diff` clean on `ProjectKanban.tsx`)

**Verification:** Frontend typecheck green; manual side-by-side check dark + light.
**Dependencies:** T3, T5.
**Files:** `kanban-v2/SolvroKanban.tsx`, `kanban-v2/cards.tsx` (new), `frontend/src/App.tsx`, `CHANGELOG.md`.
**Scope:** M.

#### Task 7: Drag slice — the core

**Description:** Wire `value`/`onValueChange`/`onValueCommit`: local projection
authoritative during drag with query sync frozen (Decision 5), commit through
mapper → `useUpdateTask`, `restoreOnCancel` on. Covers same-column reorder,
cross-column move, column-body append, empty-column, drop-in-place no-op.

**Acceptance criteria:**
- [ ] Scenario-table card-drop rows behave correctly on `/kanban2` (manual, desktop)
- [ ] Drop-in-place fires no network request; one gesture fires exactly one PATCH
- [ ] Escape mid-drag restores the board with no request

**Verification:** Manual against scenario table with devtools network tab; typecheck; mapper tests still green.
**Dependencies:** T6.
**Files:** `kanban-v2/SolvroKanban.tsx`, possibly `kanban-v2/adapter.ts`, `CHANGELOG.md`.
**Scope:** S–M.

#### Task 8: Filters + subtask checklist + move sheet

**Description:** Port the assignee/priority filter popover; filtered projection feeds
ReUI's `value` while the mapper maps against the unfiltered global list (the
filter-active scenario rows). Subtask checklist renders with toggle only (no drag
surfaces). `MobileMoveSheet` ports using the mapper's column-append path.

**Acceptance criteria:**
- [ ] Filter-active drops land per scenario table (spot-check the three filter rows manually)
- [ ] Subtask toggle works; no drag handles render on subtask rows
- [ ] Move sheet moves a card to end-of-column, matching the mapper's column-body math

**Verification:** Manual + typecheck; mapper tests green.
**Dependencies:** T7.
**Files:** `kanban-v2/SolvroKanban.tsx`, `kanban-v2/cards.tsx`, `CHANGELOG.md`.
**Scope:** M.

#### Task 9: Mobile slice

**Description:** Port the scroll-snap pager (chevrons, dots, IntersectionObserver) around
ReUI's board. Verify touch drag inside the pager on the mobile e2e project. Only if
touch misfires: the one sanctioned sensor-tuning patch (restore 250 ms delay / 6 px
distance) with `// SOLVRO PATCH` marker + CHANGELOG entry.

**Acceptance criteria:**
- [ ] Pager swipes don't initiate card drags; touch-hold drag still works
- [ ] Patch count after this task ≤ 1, and any patch is configuration-only

**Verification:** `cd e2e && npm test -- --grep "mobile"` against `/kanban2` scratch spec or manual CDP run; typecheck.
**Dependencies:** T7.
**Files:** `kanban-v2/SolvroKanban.tsx`, possibly one vendored file (patch), `CHANGELOG.md`.
**Scope:** S–M.

#### Task 13: Modal subtask reorder controls (CP0 addition)

**Description:** `TaskFormModal`'s subtask panel (currently checkbox-only,
`TaskFormModal.tsx:422-454`) gains per-row up/down reorder controls persisting via
`useUpdateTask` position patches within the parent's per-parent sibling list. CP0
decision: this restores a modal-path replacement for retired board-level subtask
reorder (RG-1), so T10 rewrites the old "subtask reorder" e2e case to this path
instead of dropping it.

**Acceptance criteria:**
- [ ] Up/down controls reorder subtasks and persist (position patch per `taskOrdering.ts` per-parent list)
- [ ] Controls disabled at list boundaries; checkbox behavior unchanged

**Verification:** Frontend typecheck; manual reorder round-trip; e2e lands in T10 (modal helpers).
**Dependencies:** None (schedule within Phase 2; CHANGELOG serialized with other tasks).
**Files:** `frontend/src/components/TaskFormModal.tsx`, `CHANGELOG.md`.
**Scope:** S.

### Checkpoint 2 — spike verdict (after T6–T9, T13)
- [ ] Measurements recorded in `scenarios.md`: Solvro-owned LOC (kanban-v2 total) vs old file's 1,182; vendor patch count vs Gantt's 3
- [ ] Dogfood window on `/kanban2` (desktop + phone) — R6 watch: did you reach for subtask drag?
- [ ] User decides: proceed to cutover / adjust / fall back (register informs, doesn't veto)

### Phase 3 — Verification and cutover

#### Task 10: e2e augmentation

**Description:** Update `kanban-dnd.spec.ts` to a route constant targeting `/kanban2`,
rewrite the three subtask-drag cases to the modal path (promote via parent-selector
must still satisfy the global-end assertion), and add the T2 gap cases: on-card
insertion drop, drop-in-place fires **no** PATCH (request-absence assertion),
filter-active drop, cross-view List-order parity after a drag sequence (R3).

**Acceptance criteria:**
- [ ] Full spec green on desktop + mobile projects against the CI stack
- [ ] Every T2 gap case implemented; API-readback assertion style preserved

**Verification:** `cd e2e && npm test -- kanban-dnd` both projects, CI stack (`:8080`).
**Dependencies:** T2, T8, T9.
**Files:** `e2e/tests/kanban-dnd.spec.ts`, possibly `e2e/fixtures/*`, `CHANGELOG.md`.
**Scope:** M.

#### Task 11: Cutover

**Description:** One deliberate commit: `/projects/:id/kanban` route → `SolvroKanban`;
remove the `kanban2` route; delete `ProjectKanban.tsx` (git history preserves it);
flip the e2e route constant back to `/kanban`; add the kanban `// SOLVRO PATCH`
marker grep to solvro-qa's standing guardrail checks (R4).

**Acceptance criteria:**
- [ ] `/kanban` serves the new board; `/kanban2` is gone; old file deleted
- [ ] Full e2e suite green (not just kanban specs); solvro-qa grep updated
- [ ] CHANGELOG entry documents the cutover + final measurements

**Verification:** Full gate set — both typechecks, backend vitest, frontend vitest, `cd e2e && npm test`.
**Dependencies:** T10, CP2 user go-ahead.
**Files:** `frontend/src/App.tsx`, delete `frontend/src/pages/views/ProjectKanban.tsx`, `e2e/tests/kanban-dnd.spec.ts`, `.claude/agents/solvro-qa.md`, `CHANGELOG.md`.
**Scope:** M.

#### Task 12: Docs sync (docs-keeper)

**Description:** Dispatch solvro-docs-keeper: CLAUDE.md Facts (frontend conventions —
Kanban paragraph now describes the vendored engine + kanban-v2 layer), ISSUES.md
(file the deferred "Promote to task" affordance; prune anything the swap resolved),
verify the CHANGELOG trail.

**Acceptance criteria:**
- [ ] CLAUDE.md Facts match shipped reality; Guardrails untouched
- [ ] Deferred affordance filed in ISSUES.md

**Verification:** docs-keeper report; spot-read the updated Facts paragraph.
**Dependencies:** T11.
**Files:** `CLAUDE.md`, `ISSUES.md`.
**Scope:** S.

### Checkpoint 3 — complete
- [ ] All gates green; per-task pipeline (implementor → qa → reviewer → docs-keeper) ran per roster
- [ ] Branch `feat/kanban-reui-swap` (cut from fresh `origin/develop`); PR → `develop`, assigned to `alfi-rajasyah`
- [ ] Commit and PR only on explicit user approval (guardrail)

---

## Risks and Mitigations

The full register lives in `docs/ideas/kanban-reui-swap.md` — not duplicated here.
Plan-shaping consequences: R7 → Phase 0/1 precede all UI; R1 → Decision 6 patch
policy + CP2 measurements; R2 → T1/T5/T10 chain; R3 → T10 cross-view case;
R4 → T11 qa grep; R5 → Decision 5; R6 → parallel route + CP2 dogfood; R8 → T9.

## Open Questions (carried from the idea doc)

- Promote-affordance: resolved for MVP as modal-only (Decision 8); revisit at CP2.
- `c-kanban-6` reference example: pull via ReUI MCP during T7 as reading material —
  not installed into the repo.

## CP0 Decision Log (2026-07-26)

1. Scenario table + G1–G10 gap list **approved as binding** on T5/T10.
2. **G9 uses the priority filter** (identical hidden-cards code path, no new fixture
   surface); mapper unit tests stay filter-agnostic; assignee filter checked
   manually at CP2.
3. **RG-1: modal subtask reorder controls added as Task 13** (user chose to build
   the replacement now rather than rely on List-view reorder alone). T10's RG-1
   case is rewritten to the modal path, not dropped.
4. **RG-4 → backend vitest** (UI-unreachable except via race); **SC-4 folds into
   G3**; **SC-5 re-evaluated at T7**.
5. Idea-doc collision claim corrected (only failure mode 1 is subtask-specific);
   the surviving tall-card/drop-in-place hazard is covered by the mapper no-op
   guard + G3/G4.

## Phase 1 Review Addenda (2026-07-27)

6. **Cross-column drop-on-card semantics: WYSIWYG accepted.** The old board always
   landed a card *after* its target on downward drops (moved-inclusive index); ReUI
   commits the live-preview arrangement, which can be either side of the over-card
   depending on pointer position. Orchestrator decision: WYSIWYG is the intended
   semantics (it is the point of live preview); the mapper stays
   arrangement-faithful. CC-1/FA-2 tests cover BOTH reachable arrangements; T7 must
   capture real `onValueCommit` payloads for top-half vs bottom-half drops to
   confirm engine behavior matches.
   **RESOLVED at T7 (2026-07-27):** top-half and bottom-half drops produce the
   identical payload — the vendor's cross-column `handleDragOver` always splices
   the moved item at the over-card's index ("insert before"), so only one
   arrangement is reachable via this gesture. Dual unit tests retained as
   engine-independent mapper coverage. Also traced: drop-in-place DOES fire
   `onValueCommit`; the mapper's Guard 1 is what swallows it (live-verified: zero
   PATCH captured).
7. **Frontend vitest added to CI** (review finding: suite wasn't wired into
   `.github/workflows/ci.yml`) — R2's mitigation now runs on every push.
8. **T8 re-check (review finding 7):** the mapper's guard 1 compares the *filtered*
   arrangement; a filter-hidden no-op interacts with the vendor's own
   unchanged-commit early return (`reui/kanban.tsx:297-299`). Currently unreachable;
   verify at T8 that the move sheet / filtered drops can't synthesize a same-status
   commit that guard 1 wrongly swallows.

## Execution Notes

- Every task = one solvro-implementor dispatch; solvro-qa gates after each (frontend
  tasks add the Playwright smoke); solvro-reviewer on all but trivial tasks;
  docs-keeper at the end. Orchestrator (this session) sequences and accepts.
- CHANGELOG discipline applies to every task individually, same turn as the change.
- No commits or PRs without explicit user approval, per guardrail.
