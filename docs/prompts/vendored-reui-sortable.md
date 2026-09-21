# Goal prompt — Vendored ReUI Sortable (subtask & section drag reorder)

Copy-paste the block below into a fresh session to execute the phase.

---

Execute the phase planned in `/Users/alfirajasyah/Documents/Solvro/docs/plans/vendored-reui-sortable.md` (read it first, in full).

Context: TaskPanel subtasks reorder only via up/down buttons, and sections have no reorder UI at all despite `Section.position` + `PATCH /sections/:id` already accepting `position`. The plan vendors ReUI's Sortable (Base-UI native, zero new deps — all four of its deps are already installed) into `frontend/src/components/reui/sortable.tsx` and wires two consumers: drag-only subtask reorder in TaskPanel, and a "Reorder sections" modal in the List view. ProjectList's existing task-drag `DndContext` is untouched by design — Sortable is single-list and must not be nested inside it.

Setup (do this first):
- `git fetch origin`, then `git switch -c feat/reui-sortable origin/develop` in `/Users/alfirajasyah/Documents/Solvro`. Local `develop` lags origin — always branch from `origin/develop`. No push until post-approval (`git push -u origin feat/reui-sortable`).

Execution rules (per CLAUDE.md — read it and the area CLAUDE.md files as you go):
- Wave 1: Tasks 1 and 2 in parallel `solvro-implementor`s (disjoint areas: vendored frontend file vs backend route). Task 1 touches vendored `reui/` → instant opus review at Checkpoint A before Wave 2 starts.
- Wave 2: Tasks 3 and 4 in parallel implementors (disjoint files). Task 4 touches `lib/queries.ts` (spine) → instant review of its diff.
- `.claude/scripts/gates.sh` after every task; fix rounds CONTINUE the same implementor via SendMessage, never a respawn. Sonnet floor for all subagents.
- Backend vitest only via the isolated-test-DB invocation in `backend/CLAUDE.md` — never plain `docker compose exec backend npm test`.
- Each implementor reports its CHANGELOG entry text; append serially under `[Unreleased]` at integration — one writer, public-reader wording, no pipeline vocabulary.
- Task 1 hard constraints: final path `frontend/src/components/reui/sortable.tsx`; no `radix-ui` import survives; `frontend/package.json` ends byte-identical; hand edits marked `// SOLVRO PATCH`.
- Close: one `solvro-reviewer` phase review on the combined diff (frontend touched → it reads `docs/DESIGN.md` live), docs-keeper only if a trigger fired, then stage everything and draft commit messages + a PR body targeting `develop` (assign `alfi-rajasyah`) — and STOP for my approval. No commit, no push, no PR without it.

Settled decisions (in the plan + `docs/ideas/vendored-reui-sortable.md` — follow, don't re-ask): TaskPanel goes drag-only (delete `moveSubtask` + arrow buttons; dnd-kit keyboard sensor covers a11y); section reorder lives in a modal, never as draggable group headers; backend does the dense sibling re-pack on section position PATCH; persistence hangs off `onValueCommit`, one PATCH per drop.
