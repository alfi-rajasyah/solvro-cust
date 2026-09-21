# Duplicate Tasks, Subtasks, and Sections — Spec & Plan

Status: **shipped 2026-09-02** — PR #165 merged into `develop` 2026-09-02; archived; §3 decisions stand.
Branch: `feat/duplicate-tasks-sections` off `origin/develop`.

## 1. Problem

- Solvro has no copy action for a task, a subtask, or a section. Verified 2026-09-02:
  - `backend/src/routes/tasks.ts` — PATCH `/:id`, DELETE `/:id`, comments only.
  - `backend/src/routes/sections.ts` — PATCH `/:id`, DELETE `/:id` only.
  - `backend/src/routes/projects.ts` — `POST /:id/tasks`, `POST /:id/sections` create blank records only.
  - Task menus offer Edit, Critical Path toggle, Add subtask, Delete (`frontend/src/components/gantt-v2/SolvroGantt.tsx` context menu; `frontend/src/components/TaskPanel.tsx` "Task options" menu). Section headers offer Rename and Delete (`frontend/src/pages/views/ProjectList.tsx`).
- Asana (which Solvro replaces) offers "Duplicate task" and "Duplicate section". A TAM who repeats a phase (kickoff, UAT, go-live) re-types every task, subtask, date, and label by hand.
- The only copy in the codebase is `POST /projects/:id/baseline` (live dates → baseline columns). It creates no rows.

## 2. Goals / Non-goals

Goals
- One click duplicates a task **with its subtasks**, a subtask **alone**, or a section **with every task and subtask in it**.
- The copy lands directly after its source in the same list, so the user sees it without scrolling.
- Same project only. Same permission gates as create/delete.
- Every copy runs in one transaction. A half-copied section never exists.

Non-goals
- No cross-project copy (labels, sections, and visibility are project-scoped).
- No "duplicate project" — separate decision.
- No options dialog in v1 (see Decision 7).
- No copy of comments, ever. No copy of baseline dates (a baseline is a locked snapshot).
- No schema change. No migration.

## 3. Decisions (settled 2026-09-02 — do not re-litigate)

| # | Decision | Choice | Rejected |
|---|---|---|---|
| 1 | Copy title | **verbatim** — the copy has the same title and the same section name; no suffix | `<title> (copy)`, `Duplicate of <title>` |
| 2 | Status | reset to `TODO`, **subtasks included** | keep source status |
| 3 | Assignee | copied | cleared |
| 4 | Dates | `startDate`, `dueDate`, `isMilestone` copied; `baselineStartDate`/`baselineDueDate` = null | clear dates |
| 5 | Flags | `priority`, `isCriticalPath` copied | reset |
| 6 | Labels | copied (same project, `connect` by id) | — |
| 7 | UX | **one click, fixed rules**; the copy opens in the Task panel | Asana-style checkbox dialog |
| 8 | Dependencies | **drop all edges** — the copy has no `TaskDependency` rows | re-create edges inside the copied set |
| 9 | Comments | never copied | — |
| 10 | Placement | task copy: `position = source.position + 1` in the same sibling list. Section copy: `position = source.position + 1`; its tasks go right after the source section's last top-level task in the project order | append at end |
| 11 | Permission | task/subtask: `task:write` (matches PATCH/DELETE and the frontend `canEdit`). Section: `project:write` (matches section create/delete) | — |
| 12 | Surfaces v1 | Task panel options menu, Gantt row context menu, Task-panel subtask rows, List-view section header | Kanban card menu (v2 — the card opens the panel) |


## 4. API contract

### `POST /tasks/:id/duplicate` — `task:write`
- `ensureTaskVisible(req.user, id)`.
- No body in v1.
- Top-level source: copies the task and each subtask (ordered by `position`, `id`) under the new task, positions `0..n-1`. Subtask source: copies the one task under the same `parentTaskId`.
- Creates the copy at the end of the sibling list, then `moveTaskWithinSiblings(tx, newId, key, key, source.position + 1)` — the existing helper re-packs dense `0..n-1`.
- Response `201`: the new task, same `include` shape as `POST /projects/:id/tasks` (assignedTo, labels, section, `_count`).

### `POST /sections/:id/duplicate` — `project:write`
- `ensureSectionVisible(req.user, id)` (already private in `sections.ts`).
- Creates a section with the same `name` and `color`, then `insertSectionAt(tx, projectId, newId, source.position + 1)`.
- Copies every top-level task with `sectionId = id` (ordered by `position`, `id`) with its subtasks, via the same helper as the task route.
- Places the copies after the source section's last top-level task: new helper `insertManyAfter(tx, key, afterTaskId, newIds)` in `backend/src/lib/taskOrdering.ts` (one re-pack pass; `insertAt` stays private).
- Response `201`: `{ section, taskCount }`.

### Shared helper — `backend/src/lib/duplicate.ts`
`duplicateTaskTree(tx, sourceIds: number[], overrides: { parentTaskId?, sectionId? }) → Map<oldId, newId>`. Copies the fields in §3, resets status and baseline, connects labels, copies subtasks, creates no dependency rows. Both routes call it. Runs inside `prisma.$transaction`.

## 5. Frontend

- `frontend/src/lib/queries.ts` (spine): `useDuplicateTask(projectId)` → invalidates `projectTasks`, `["tasks"]`, `overview`. `useDuplicateSection(projectId)` → adds `projectSections`.
- `TaskPanel.tsx` — "Task options" menu gains **Duplicate task** (`content_copy` glyph) above **Delete task**; on success the panel navigates to `?task=<newId>`. Subtask rows gain a **Duplicate** icon button next to Rename (same hover-reveal classes).
- `gantt-v2/SolvroGantt.tsx` (spine) — context menu gains **Duplicate** after **Edit**; errors reuse `setActionError`.
- `pages/views/ProjectList.tsx` — section header gains **Duplicate section** (`content_copy`) between Rename and Delete; hidden on the "No section" pseudo-group.
- Disabled while the mutation is pending. No toast (none exists in the app).
- DESIGN.md: menu items reuse the existing item classes; the glyph is Material Symbols `content_copy`. No new tokens.

## 6. Tests

- `backend/test/taskDuplicate.test.ts`: field copy + reset (status, baseline), title identical to the source, labels, subtasks in order and all `TODO`, position = source + 1 with dense siblings, comments not copied, zero dependency rows on the copy and its subtasks, subtask copy stays under parent, 404 on invisible task, 403 without `task:write`.
- `backend/test/sectionDuplicate.test.ts`: section position = source + 1 (dense), name and color kept, tasks + subtasks copied in order, copies placed after source section's last task, empty section copies as empty, 403 without `project:write`.
- `e2e/tests/duplicate.spec.ts`: panel menu → a second panel opens on a new task id with the same title; section header → a second group with the same name directly below the source. Seeds via `e2e/fixtures/seed.ts` `createTask`.

## 7. Task graph (phase = branch = PR)

| Task | Files | Depends on | Spine |
|---|---|---|---|
| T1 backend task duplicate | `lib/duplicate.ts`, `lib/taskOrdering.ts` (`insertManyAfter`), `routes/tasks.ts`, `test/taskDuplicate.test.ts` | — | yes |
| T2 backend section duplicate | `routes/sections.ts`, `test/sectionDuplicate.test.ts` | T1 | no |
| T3 frontend task surfaces | `lib/queries.ts`, `TaskPanel.tsx`, `gantt-v2/SolvroGantt.tsx` | contract §4 (parallel with T1) | yes |
| T4 frontend section surface + e2e | `ProjectList.tsx`, `lib/queries.ts`, `e2e/tests/duplicate.spec.ts` | T2, T3 | yes (queries.ts) |

Waves: W1 = T1 ∥ T3 · W2 = T2 ∥ T4. One full `gates.sh` run per wave. Instant review on T1, T3, T4. One phase review. CHANGELOG entry per task, appended at integration.

## 8. Decision log

- 2026-09-02 (user): Decisions 1, 2, 7, 8 settled as in §3 — verbatim title, `TODO` for the copy and its subtasks, one click, no dependency edges. Ready for Wave 1.
