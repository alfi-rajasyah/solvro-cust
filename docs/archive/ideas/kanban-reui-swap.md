# Kanban → ReUI Engine Swap

> Idea-refine session, 2026-07-26. Exploration only — no code changes yet.
> Direction confirmed by user: **A — full swap, subtask drag retired from the board.**
> Risk register added 2026-07-26 (interview session): informs the migration plan; it is
> **not** a go/no-go gate.

## Problem Statement

How might we align Solvro's Kanban with the vendored ReUI stack — gaining its drag
UX and shedding hand-rolled dnd plumbing — without breaking the global-task-order
model that List/Kanban/Gantt all share?

## Context (what the exploration found)

- Solvro's `ProjectKanban.tsx` (1,182 lines) and ReUI's Kanban sit on the **identical
  foundation**: `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` +
  `@base-ui/react`, all already in `frontend/package.json`. The swap replaces the
  orchestration layer, not the physics.
- ReUI Kanban is free; installs via `npx shadcn@latest add @reui/kanban` and vendors
  into `components/reui/kanban/` — same flow as the Gantt engine.
  API docs: <https://reui.io/docs/components/base/kanban>.
- **Data-model mismatch (the hard part):** ReUI wants `value: Record<columnId, items[]>`
  (independent per-column arrays); Solvro's canonical model is a single global
  top-level order where columns are filtered subsequences and status doesn't
  partition position (`ProjectKanban.tsx:192-340`, mirroring
  `backend/src/lib/taskOrdering.ts` insertAt semantics). An adapter must project
  global → per-column, and map `onValueCommit` per-column indexes back to global
  positions.
- **Subtask drag was the fatal blocker for a wholesale swap** — the custom
  `boardCollisionDetection` exists *primarily because* subtask droppables break
  bare `closestCorners`, and ReUI exposes no `collisionDetection` or `sensors` props.
  User rated board-level subtask drag "nice to have" → retiring it removes the
  blocker and most of the reason the collision complexity exists.
  *Correction (T1 finding, 2026-07-26):* of the two documented failure modes at
  `ProjectKanban.tsx:80-129`, only mode 1 (card-over-subtask-region) is
  subtask-specific; mode 2 (tall-card self-collision → drop-in-place must no-op) is
  generic and survives retirement — it is exactly R2's "spurious PATCH" hazard,
  mitigated by the mapper's `previousValue` no-op guard and the request-absence e2e
  cases. See `docs/plans/kanban-reui-swap/scenarios.md` §7.
- Fallback already exists: `TaskFormModal.tsx:359` has a parent-task selector —
  re-parenting and promote-to-top-level are available via the edit modal today.
  Retiring the board gesture loses a shortcut, not a capability.
- What ReUI genuinely does better: live cross-column preview during drag
  (`onValueChange` fires mid-drag), single-commit persistence (`onValueCommit` with
  `previousValue` snapshot), `restoreOnCancel` (Escape restores the board). Current
  board only shows a column ring highlight until drop.

## Recommended Direction

Vendor `@reui/kanban` and build a `components/kanban-v2/` Solvro layer on the
`gantt-v2/` precedent (SolvroKanban container + adapter + commit-mapper, preserving
Solvro card visuals). Retire subtask dragging from the board — the inline checklist
stays for status toggling; reorder/re-parent/promote route through the modal.

Honest caveat: the maintenance win is smaller than "1,182 lines → library." The
global-order math does not disappear — it moves into a well-unit-tested adapter,
exactly like the Gantt's `adapter.ts`. What disappears: collision detection, the
sensor/overlay/DndContext plumbing, and ~250 lines of subtask drop logic. The code
that remains is the essential complexity, isolated and testable.

### Directions considered and rejected

- **B. Full swap, subtask drag preserved via patches** — nest sortables inside
  vendored `KanbanItem`s, patch collision detection into the vendor file.
  Patch-as-architecture (not the Gantt's 3 small `// SOLVRO PATCH` sites); relocates
  all complexity into vendor-owned code and fails the maintenance goal. Killed.
- **C. No swap; port the UX ideas into the existing engine** — cheapest path to the
  UX win but serves neither consistency nor maintenance. Retained only as the
  fallback if the spike invalidates Assumption 1 or 2 below.

## Key Assumptions to Validate

- [ ] ReUI's default collision behavior handles a flat 3-column board acceptably —
      *spike on a branch, run the `kanban-dnd` e2e spec desktop + mobile*
- [ ] `onValueCommit` meta (per-column index + `previousValue`) maps to correct
      global positions in every current scenario, **including with filters active**
      (neighbor-based mapping against the unfiltered global list) — *unit-test the
      mapper against the scenarios encoded in the current file's comments before
      wiring any UI*
- [ ] Live-preview `onValueChange` doesn't fight TanStack Query optimistic updates
      mid-drag — *local board state while dragging, sync from query data at rest
      (the Gantt adapter's pattern)*
- [ ] ReUI's default touch activation works inside the mobile scroll-snap pager, or
      a 1-line sensor patch restores the current 250 ms delay / 6 px distance
      constraints — *mobile e2e project*

## MVP Scope

Fresh branch off `origin/develop`.

**In:**
- Vendor `@reui/kanban` → `components/reui/kanban/`
- New `components/kanban-v2/`: SolvroKanban container, adapter
  (global order → per-column arrays), commit-mapper (per-column index → global
  position) with unit tests
- Preserve: `TaskCard` visuals, WIP limits, assignee/priority filters, permission
  gating (`KanbanItem disabled` for non-writers), mobile pager + `MobileMoveSheet`,
  `?task=` deep link
- Retire: subtask drag surfaces (toggle checkbox stays)
- Gate: `kanban-dnd` e2e spec green, with subtask-drag scenarios rewritten to the
  modal path — same parity discipline as `gantt-parity`

**Out (Not Doing, and why):**
- Direction B (patch-preserved subtask drag) — see above
- Column reordering / custom columns — columns are the three fixed statuses;
  `KanbanColumnHandle` stays unused
- Touching `ProjectList` or Gantt dnd — the global-order backend contract is
  untouched; frontend orchestration only
- Backend changes — same `PATCH { status, position }` per drop

## Risk Register

Purpose: make the migration carefully thoughtful — each risk carries a likelihood, a
blast radius, an **early-warning signal** (how we'd notice before it's expensive), and a
mitigation that shapes the migration steps. Budgets appear below as mitigations, never
as gates. R1 and R2 are the headline risks and get the deepest treatment.

| ID | Risk | Likelihood | Blast radius |
|----|------|-----------|--------------|
| R1 | Complexity relocation: adapter + vendor patches regrow until Solvro-owned complexity ≈ what was deleted, now split across vendor files | **Med-High** | Maintenance motivation self-defeats; worse than status quo |
| R2 | Drag-behavior regression the e2e specs don't encode | Med | Daily-use surface degrades; trust in the board erodes |
| R3 | Wrong-position PATCHes corrupt the global order shared with List/Gantt | Low-Med | Silent cross-view data corruption, delayed discovery |
| R4 | shadcn CLI re-pull clobbers `// SOLVRO PATCH` sites in the vendored kanban | Low | Silent behavior loss long after the swap ships |
| R5 | Live-preview state fights TanStack optimistic updates mid-drag | Med | Flicker / rubber-banding; spurious server writes |
| R6 | Subtask-drag retirement hurts more than "nice to have" predicted | Low-Med | Daily-workflow friction; regret without a cheap path back |
| R7 | Spike momentum ships the migration ("we've come this far") | Med | Mitigations below get skipped under momentum |
| R8 | Touch drag misbehaves inside the mobile scroll-snap pager | Med | Mobile board unusable or twitchy; desktop-tested code hides it |

### R1 — Complexity relocation (deep)

**Mechanism.** ReUI's API deliberately exposes no `collisionDetection` or `sensors`
props. Every gap between its defaults and Solvro's needs invites "just one more patch,"
each individually justifiable. The failure is gradual — no single commit looks wrong.
The end state is the old 1,182 lines' complexity redistributed across
`components/reui/kanban/` (vendor-owned) and `kanban-v2/`, which is strictly worse
than today because vendor files are re-pull-clobberable (R4) and the logic no longer
lives in one place.

**Early-warning signals.**
- Vendor patch count exceeds the Gantt precedent (3 sites) during the spike itself.
- Any patch that adds or changes *drag semantics* rather than configuring
  (sensor timing, classNames, styling). Semantic patches are the regrowth mechanism.
- Adapter/commit-mapper unit tests start needing to mock dnd-kit internals — the sign
  the abstraction is being fought, not used.
- Solvro-owned layer LOC (container + adapter + mapper) trending toward the ~600+
  lines the swap is supposed to delete.

**Mitigations (shape the plan).**
- Patch policy written into the spike task: patches may **configure, never decide**.
  Any behavioral need goes in `kanban-v2/`; if it *can't* be expressed outside the
  vendor file, that requirement falls back to Direction C (port the UX, no swap) —
  fallback per requirement, not a project abort.
- Every patch site logged in CHANGELOG same-turn (existing discipline), so creep is
  visible in one place, not discovered by diffing vendor files.
- The LOC comparison (deleted vs. added Solvro-owned) is computed and recorded at
  spike end — measured once, honestly, while switching is still free.

### R2 — Behavioral regression beyond e2e coverage (deep)

**Mechanism.** The current board's correctness was earned through real-browser
debugging; the file's comments are a catalog of bugs that shipped-looking code had.
Known specific hazards for the ReUI defaults: the drop-back-in-place no-op (current
collision detection returns `[]` when the pointer is inside the card's original slot —
ReUI may read the same gesture as "append to column end" and fire a spurious PATCH);
the filter-active drop math (per-column visible index vs. unfiltered global position);
the tall-card short-drag self-collision; empty-column drops (status-only, no position).

**Early-warning signals.**
- Commit-mapper unit tests written *before any UI wiring* — each failure at this stage
  costs minutes, not a debugging session against a live board.
- Network-level assertions in e2e: a drop that renders correctly per-column can still
  send a wrong global `position`. Asserting the PATCH payload catches what visual
  assertions can't.

**Mitigations (shape the plan).**
- **The old file is the spec.** First migration task: mine `ProjectKanban.tsx`'s
  comments (lines 48–130, 192–340, 381–426) into a scenario table; every documented
  failure mode becomes a commit-mapper unit test or an e2e case.
- Audit `e2e/tests/kanban-dnd` coverage against that table before the spike; add the
  gaps (filter-active drop, drop-in-place fires **no** request, empty-column drop,
  tall-card short drag) rather than assuming they're covered.
- Adapter-level no-op guard: compare `previousValue` to the committed value and skip
  the PATCH when identical — cheap insurance against ReUI firing commits the old
  guards would have swallowed.

### R3 — Cross-view global-order corruption

One canonical top-level order is shared by List, Kanban, and Gantt; a Kanban
position bug therefore *manifests in other views* while the Kanban itself looks fine
per-column. **Mitigation:** one e2e case asserts List order after a set of Kanban
drags (cross-view parity). **Early warning:** any List/Gantt ordering oddity during
the spike is treated as a Kanban mapper bug until proven otherwise.

### R4 — Vendor re-pull clobbers patches

Already-documented hazard (CLAUDE.md: re-running the shadcn/ReUI CLI strips vendor
headers and `// SOLVRO PATCH` markers). Low likelihood, high silence. **Mitigation:**
add the kanban patch-marker grep to solvro-qa's standing guardrail checks (same
mechanism as the existing `gantt-task-react` absence check), so every QA run
verifies the markers still exist.

### R5 — Live preview vs. optimistic updates

`onValueChange` fires *during* drag; Solvro's board state derives from TanStack
Query, and `useUpdateTask` already does optimistic writes + `onSettled` invalidation.
Two writers, one board. **Mitigation:** the gantt-v2 adapter pattern — local
projection state is authoritative *only while a drag is live*; query sync is frozen
during drag and resumes at rest; `onValueCommit` funnels into the existing
`useUpdateTask` mutation (single write path); `restoreOnCancel` enabled. **Early
warning:** any flicker on drop in the spike build, or a second PATCH appearing in the
network log for one gesture.

### R6 — Subtask-drag retirement regret

"Nice to have" was a fast answer; the promote-to-column gesture may have more daily
value than remembered. **Mitigation:** rollback stays a route flip — old
`ProjectKanban.tsx` is untouched until cutover (see R7), so the decision is reversible
for free during the trial window; the "Promote to task" row-menu affordance (Open
Questions) is the cheap middle path if friction appears. **Early warning:** you
notice reaching for the gesture during the first week of dogfooding the spike build.

### R7 — Spike momentum ships the migration

The spike exists to answer R1/R2's open questions, and a mostly-working spike creates
pressure to just keep going. Not a gate — but the *sequence* is the mitigation:
scenario table and mapper unit tests land **before** UI wiring; the LOC/patch-count
measurements land **at spike end**; the old board file and route stay intact until a
deliberate cutover commit. Momentum can't skip steps that are ordered first.

### R8 — Mobile touch inside the scroll-snap pager

The current 250 ms touch delay / 6 px pointer distance constraints exist so swiping
the pager doesn't start drags; ReUI's internal sensor defaults are unknown until the
spike. **Mitigation:** mobile e2e (iPhone 13 viewport, CDP touch) runs in the spike
gate, not after; the one sanctioned sensor-tuning patch site restores the constraints
if defaults misfire. **Early warning:** pager swipes picking up cards in the first
mobile e2e run.

## Open Questions

- Does promote-subtask-to-column need a lightweight replacement affordance
  (e.g. "Promote to task" in a subtask row menu), or is the modal enough?
- Pull `c-kanban-6` ("Kanban board persisted to a backend",
  `npx shadcn@latest add @reui/c-kanban-6`) during the spike as the reference for
  the commit-mapping pattern.
