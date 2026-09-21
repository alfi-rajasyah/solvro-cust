# Implementation Plan: Vendored ReUI Sortable — Subtask & Section Drag Reorder

**Branch:** `feat/reui-sortable` — cut from up-to-date `origin/develop` (`git fetch origin` first; local develop is known to lag); merges into `develop` via PR
**Phase = branch = one PR into `develop`.** Tasks = commits. No commit/PR without explicit user approval.
**Idea doc:** `docs/ideas/vendored-reui-sortable.md` (decisions there are settled — don't re-ask).

## Overview

Two reorder surfaces are below par: TaskPanel subtasks move only via up/down buttons (`TaskPanel.tsx:184` `moveSubtask`), and sections cannot be reordered at all despite full schema + API readiness (`Section.position`, `backend/src/routes/sections.ts:25` accepts `position`). This phase vendors ReUI's Sortable component (Base-UI native — zero new deps, zero Radix patching) into `frontend/src/components/reui/sortable.tsx` and wires those two consumers. The List view's existing task-drag (`ProjectList.tsx`) is explicitly untouched — Sortable is single-list and cannot express its cross-section global-position moves.

Verified at planning time (2026-07-30):

- ReUI Sortable deps = `@base-ui/react`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` — all four already in `frontend/package.json`. Expected `package.json` diff: none.
- Sortable API: `Sortable` root (`value`/`onValueChange`/`getItemValue` required; `onValueCommit(value, {event, activeIndex, overIndex, previousValue})` is the persistence seam; `strategy` defaults `"vertical"`; dnd-kit passthroughs `onDragStart/End/Cancel`, `accessibility`, `modifiers`), `SortableItem` (`value`, `disabled`), `SortableItemHandle`. Registry: `@reui/sortable`, docs https://reui.io/docs/components/base/sortable.
- Backend `PATCH /sections/:id` writes raw `position` — no sibling re-pack (unlike tasks, where `taskOrdering.ts` `insertAt` keeps sibling lists dense 0..n-1 in a transaction).
- `GET /projects/:id/sections` orders `[{position: "asc"}, {id: "asc"}]` (`routes/projects.ts:418-421`).
- Frontend hooks exist: `useProjectSections` (`queries.ts:827`), `useUpdateSection` (`queries.ts:857`, optimistic map + PATCH `/sections/:id`).
- TaskPanel subtasks: flat sibling list ordered by `position`; `moveSubtask` PATCHes `{position: target}` and the tasks backend re-packs — the single-PATCH contract Sortable slots into directly.

## Architecture Decisions

- **Vendor via the ReUI CLI** (`npx shadcn@latest add @reui/sortable` from `frontend/`), landing `frontend/src/components/reui/sortable.tsx`. Any hand edit gets a `// SOLVRO PATCH` marker (CLI re-pulls strip local edits — frontend/CLAUDE.md). `package.json` must come out unchanged; if the CLI touches it, revert and investigate before proceeding.
- **Section reorder UX is a "Reorder sections" modal, not draggable group headers.** `ProjectList.tsx:400` already wraps the whole list in a `DndContext`; Sortable creates its own `DndContext`, and nesting them is a dnd-kit footgun (inner context captures pointer events). A modal (via `Modal.tsx`, edge-to-edge on phone) keeps ProjectList's drag system untouched and works on mobile, where List is the Gantt fallback.
- **Backend takes over dense sibling re-pack for sections.** When a `PATCH /sections/:id` body contains `position`, re-pack the project's section list dense 0..n-1 inside a `prisma.$transaction`, mirroring `taskOrdering.ts` `insertAt` semantics (exclude self, clamp, splice, rewrite indices). Keeps the one-PATCH-per-move contract identical to tasks; the frontend never fans out N PATCHes.
- **TaskPanel goes drag-only** (user decision 2026-07-30): delete `moveSubtask` and the up/down buttons; keyboard reorder comes from the dnd-kit keyboard sensor (focus handle → Space → arrows). Matches ProjectList, which has no buttons.
- **Persistence seam is `onValueCommit`** — `overIndex` becomes the `position` patch; `previousValue` is the rollback snapshot. Never `onDragEnd` (fires before the reorder is applied).
- **Out of scope:** any change to ProjectList task-drag, `kanban-v2/`, `gantt-v2/`, or the vendored `reui/kanban.tsx`; no new e2e specs (gates' Playwright smoke covers regressions; a dedicated drag e2e is deferred — record in the phase report if wanted later).

## Task List

### Wave 1 — parallel (independent)

#### Task 1: Vendor `reui/sortable.tsx`

**Description:** Pull ReUI Sortable into `frontend/src/components/reui/sortable.tsx` via the CLI (or manual copy from the registry source if the CLI misplaces it — final path is non-negotiable). Verify: imports are Base-UI (`@base-ui/react/*`) + dnd-kit only — no `radix-ui` anywhere; keyboard sensor wired (dnd-kit `KeyboardSensor` with sortable coordinates); default `strategy` is `"vertical"`; exports `Sortable`, `SortableItem`, `SortableItemHandle`. Mark any hand edit `// SOLVRO PATCH`. No consumers in this task.

**Acceptance criteria:**
- [ ] `frontend/src/components/reui/sortable.tsx` exists; `grep -ri radix` on it is empty
- [ ] `frontend/package.json` byte-identical to before the task
- [ ] `docker compose exec frontend npm run typecheck` green

**Verification:** `.claude/scripts/gates.sh` green; **instant opus review (spine: vendored `reui/`)** before Wave 2 starts.
**Dependencies:** None
**Files:** `frontend/src/components/reui/sortable.tsx`
**Size:** S

#### Task 2: Backend — dense sibling re-pack for section `position`

**Description:** In `backend/src/routes/sections.ts` PATCH: when `body.position !== undefined`, run a `prisma.$transaction` that re-packs the owning project's sections dense 0..n-1 with the moved section at the clamped requested index (mirror `taskOrdering.ts` `insertAt`: fetch siblings excluding self ordered `[{position:"asc"},{id:"asc"}]`, clamp, splice, rewrite). `name`/`color`-only patches keep the current single-update path. `ensureSectionVisible` stays first. Add vitest coverage: move within list (both directions), clamp beyond end, position-only patch leaves names untouched, name-only patch leaves order untouched, dense 0..n-1 invariant after every move.

**Acceptance criteria:**
- [ ] After any sequence of position PATCHes, the project's sections read back dense 0..n-1 in intended order
- [ ] Position PATCH on a section in an invisible project still 404s (existing `ensureSectionVisible` path covered by a test)
- [ ] New tests green on the isolated test DB

**Verification:** vitest via the isolated-DB invocation in `backend/CLAUDE.md` (never plain `npm test`); `.claude/scripts/gates.sh` green. Not a spine file — phase review covers it.
**Dependencies:** None
**Files:** `backend/src/routes/sections.ts`, backend test file (locate/extend the existing route-test pattern)
**Size:** M

### Checkpoint A (gate for Wave 2)
- [ ] Task 1 instant opus review clear; gates green on both tasks

### Wave 2 — parallel (disjoint files)

#### Task 3: TaskPanel subtask drag

**Description:** In `frontend/src/components/TaskPanel.tsx`: wrap the subtask `<ul>` (`:487`) in `Sortable` (`value` = the ordered `subtasks` array, `getItemValue` = `String(s.id)`); each `<li>` becomes `SortableItem` with a `SortableItemHandle` (drag grip, `material-symbols-outlined` `drag_indicator` to match ProjectList's handle iconography — check its row handle at `ProjectList.tsx:703` and reuse the pattern); `disabled={!canEdit}`. Persist via `onValueCommit`: `updateTask.mutate({ id: movedId, patch: { position: overIndex } })` — identical contract to the deleted `moveSubtask`. Delete `moveSubtask` (`:184`) and both arrow buttons (`:519-536`). DONE-toggle button and title layout unchanged.

**Acceptance criteria:**
- [ ] Pointer drag reorders and persists (survives refetch); backend re-pack keeps order dense
- [ ] Keyboard reorder works: Tab to handle → Space → arrows → Space
- [ ] `moveSubtask` and the up/down buttons are gone; `read-only` (`!canEdit`) users cannot drag
- [ ] Subtask DONE toggle and add-subtask form behave exactly as before

**Verification:** `.claude/scripts/gates.sh` green (includes Playwright smoke on frontend diffs).
**Dependencies:** Task 1
**Files:** `frontend/src/components/TaskPanel.tsx`
**Size:** S

#### Task 4: "Reorder sections" modal in the List view

**Description:** New `frontend/src/components/SectionReorderModal.tsx`: `Modal.tsx` wrapper containing a `Sortable` list of the project's sections (name + color dot + handle), fed by `useProjectSections`. On `onValueCommit`, PATCH only the moved section: `useUpdateSection(projectId).mutate({ id: movedId, patch: { position: overIndex } })` — backend (Task 2) re-packs siblings; on settle, invalidate `queryKeys.projectSections(projectId)` so the full re-packed order refetches (extend `useUpdateSection` if its current invalidation doesn't already do this). Extend the `Section` interface (`queries.ts:31`) and `CreateSectionInput`/patch typing with `position` if absent. Entry point in `ProjectList.tsx`: a "Reorder sections" affordance beside the existing add-section form (`:438` area), visible only when ≥2 sections exist and the user `canEdit`. Verify the grouped List view derives group order from the sections query (position asc) — if group order is derived some other way, fix it here so the modal's result is visible.

**Acceptance criteria:**
- [ ] Reordering in the modal reorders the List view's section groups after settle
- [ ] Exactly one PATCH per drop (network tab / mutation spy), carrying `{position: overIndex}`
- [ ] Ungrouped-tasks pseudo-group position is unaffected
- [ ] Modal is edge-to-edge and usable at 375px
- [ ] Keyboard reorder works inside the modal

**Verification:** `.claude/scripts/gates.sh` green. `queries.ts` is a spine file → **instant opus review** of this task's diff.
**Dependencies:** Tasks 1 + 2
**Files:** `frontend/src/components/SectionReorderModal.tsx` (new), `frontend/src/pages/views/ProjectList.tsx` (entry point only — no drag-logic changes), `frontend/src/lib/queries.ts`
**Size:** M

### Phase close
- [ ] One `solvro-reviewer` phase review on the combined diff (frontend touched → it reads `docs/DESIGN.md` live)
- [ ] CHANGELOG: each implementor reports entry text; orchestrator appends serially under `[Unreleased]`
- [ ] docs-keeper only if a trigger fires (none expected: no `index.css`/env/compose changes planned)
- [ ] Stage, draft commit messages + PR body targeting `develop`, assign `alfi-rajasyah` — then STOP for user approval

## Risks

- **Sortable's drop animation vs DESIGN.md:** check the vendored kanban's overlay treatment; if Sortable's defaults clash, patch with `// SOLVRO PATCH` and flag for phase review.
- **`useUpdateSection` optimistic map** (`queries.ts:868`) patches one section only — after a position move the *other* sections' positions are stale until refetch. Acceptable: the modal's Sortable holds local order during the session; the invalidation on settle reconciles. Do not build N-section optimistic rewrites.
- **CLI side effects:** `npx shadcn@latest add` may rewrite `components.json` or add deps. Task 1's acceptance pins `package.json`; treat any other unrequested diff the same way.
