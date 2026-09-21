# Execution Prompt: Kanban → ReUI Engine Swap

Execute the Kanban → ReUI engine swap for Solvro.

## Goal

Replace the hand-rolled Kanban board (`frontend/src/pages/views/ProjectKanban.tsx`)
with the vendored ReUI Kanban engine plus a `components/kanban-v2/` Solvro layer,
following the approved plan exactly. The plan is risk-register-shaped: behavior spec
and mapper unit tests come before any UI, the new board runs at `/projects/:id/kanban2`
until a deliberate cutover, and the old board file stays byte-for-byte untouched
until that cutover commit.

## Source of truth (read all three before starting)

1. `docs/plans/kanban-reui-swap/plan.md` — the 12 tasks (T1–T12), architecture
   decisions, acceptance criteria, and verification commands. Binding.
2. `docs/plans/kanban-reui-swap/todo.md` — working checklist; keep it updated as
   tasks complete.
3. `docs/ideas/kanban-reui-swap.md` — Direction A rationale + risk register R1–R8.
   The register informs, it does not veto.

## Execution rules

- Branch: `feat/kanban-reui-swap`, cut from **fresh** `origin/develop`
  (`git fetch origin` first). PR targets `develop`, never `main`.
- Per-task pipeline per CLAUDE.md roster: solvro-implementor executes one task at a
  time → solvro-qa runs the gates → solvro-reviewer (skippable only for trivial
  tasks) → orchestrator accepts against the task's acceptance criteria. Tasks are
  executed in plan order; parallelize only where the plan's dependency graph allows
  (T2 ∥ T3/T4).
- CHANGELOG entry per task, same turn as the change. Docs discipline applies.
- **Patch policy (binding):** vendor patches may configure, never add drag
  semantics; every site gets `// SOLVRO PATCH` + CHANGELOG. A requirement
  inexpressible outside vendor files → stop and present the per-requirement
  Direction-C fallback to the user.
- No commits, no PRs without explicit user approval. Stage work and draft commit
  messages; wait.

## Checkpoint behavior (hard stops)

- **CP0** (after T1–T2): STOP. Present the scenario table + e2e gap list for user
  review. It becomes binding on T5/T10 only after approval.
- **CP1** (after T3–T5): report mapper test results + patch count. STOP only if the
  expressiveness gate fails; otherwise report and continue.
- **CP2** (after T6–T9): STOP. Present measurements (kanban-v2 LOC vs 1,182; patch
  count vs Gantt's 3) and open the dogfood window on `/kanban2`. User calls
  go / adjust / fall back. Do not start Phase 3 without the go.
- **CP3** (after T10–T12): full gates green, then request commit/PR approval.
  `gh pr edit <number> --add-assignee alfi-rajasyah` immediately after opening.

## Definition of done

`/projects/:id/kanban` serves the new board; old file deleted in the cutover commit;
full e2e suite (desktop + mobile) green on the CI stack; frontend + backend
typechecks and test suites green; solvro-qa's standing checks include the kanban
patch-marker grep; CLAUDE.md Facts synced by solvro-docs-keeper; PR open against
`develop`, assigned to `alfi-rajasyah`, awaiting user review.
