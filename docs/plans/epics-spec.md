# Epics (Jira Epic & Story parity) — phase spec

Drafted 2026-09-22. Driver: the first paying customer replaces Jira with Solvro and needs Jira's Epic & Story feature. Status: approved 2026-09-24 (user: "continue until finished"); §9 customer answers still open, v1 proceeds with the §3 non-goals as stated. Branch `feat/epics` off `origin/develop`.

## 1. Goal

A TAM or customer PM can group a project's tasks under named Epics, see each Epic's progress (done / total stories), and filter the List and Kanban views by Epic. Jira mapping:

| Jira | Solvro |
|---|---|
| Epic | new `Epic` model (this spec) |
| Story / Task / Bug | existing top-level `Task` (no rename, no issue type) |
| Sub-task | existing `Task` with `parentTaskId` (unchanged) |
| Epic link on a story | new `Task.epicId` |

## 2. Decision — separate `Epic` model, not a third task level

Three options were on the table (2026-09-22 discussion):

1. Promote `Section` to Epic.
2. Add `Task.type` (EPIC / STORY) and allow depth 2 on `parentTaskId`.
3. New `Epic` model + `Task.epicId`.

**Chosen: option 3.** This reverses the same-day verbal recommendation of option 2. Evidence that changed it:

- The depth-1 invariant on `parentTaskId` is asserted in 8+ places: `backend/src/lib/taskOrdering.ts:186,194`, `backend/src/lib/duplicate.ts:76-80`, `frontend/src/components/TaskPanel.tsx:620`, `frontend/src/components/TaskFormModal.tsx:139`, `frontend/src/components/kanban-v2/adapter.ts:56`, `frontend/src/lib/gantt/geometry.ts:205`, the export `kind` unions in `frontend/src/lib/gantt/exportExcel.ts` / `exportPdf.ts`, the optimistic sibling mirror `siblingListId` in `frontend/src/lib/queries.ts`, plus `backend/test/taskOrdering.test.ts:235-255` and `e2e/tests/subtask-edit.spec.ts:171`. Option 2 rewrites all of them, most on the spine list.
- Option 2 also puts an Epic row into every flat task query (`lib/portfolio.ts:60-81` progress, overdue, search, daily review, WIP limits, Kanban columns) and needs a `type != EPIC` filter in each. One missed filter shows an Epic as a task.
- Option 1 changes the meaning of `Section` (phase) for existing TAM users and the Timeline tab (`/projects/:id/timeline`, guarded in `CLAUDE.md`). A Jira customer may need both a phase axis and a scope axis.
- Option 3 keeps every existing task query correct by construction, keeps `Section` = phase, and matches Jira's own model: the epic link is a field on the story, not a node in the sub-task tree.

Cost of option 3 is the new model, 5 routes, 1 new tab, and chip + filter in 2 views. Sizes are in §6.

## 3. Non-goals (proposed — user to confirm)

- Rename `Task` to `Story` anywhere in UI or API.
- Issue types (Story / Bug / Task) on `Task`.
- Epic comments, labels, dependencies, or Gantt bars.
- Epic swimlanes on Kanban; group-by-Epic in List or Gantt (v2 candidates).
- Cross-project epics.
- Story points, sprints, backlog view, Jira data import (see §9).
- Any change to `Section`, `parentTaskId` depth, or task ordering.

## 4. Data model

Add to `backend/prisma/schema.prisma`:

```prisma
model Epic {
  id          Int        @id @default(autoincrement())
  projectId   Int        @map("project_id")
  project     Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  title       String
  description String?
  status      TaskStatus @default(TODO)        // reuse the enum so StatusChip works unchanged
  color       String     @default("#94a3b8")   // same default as Section
  ownerId     Int?       @map("owner_id")
  owner       User?      @relation(fields: [ownerId], references: [id])
  startDate   DateTime?  @map("start_date")    // manual; date contract via lib/dateField.ts
  dueDate     DateTime?  @map("due_date")
  position    Int        @default(0)           // dense 0..n-1 per project
  createdAt   DateTime   @default(now()) @map("created_at")
  updatedAt   DateTime   @updatedAt @map("updated_at")
  tasks       Task[]

  @@index([projectId])
  @@index([projectId, position])
  @@map("epics")
}

// on Task:
epicId Int?  @map("epic_id")
epic   Epic? @relation(fields: [epicId], references: [id], onDelete: SetNull)
@@index([epicId])
```

Rules:

- `epicId` is set only on top-level tasks. A subtask always has `epicId = null` and inherits its parent's epic for display. Backend rejects `epicId` on a task with `parentTaskId` (400 `epic_on_subtask`). Re-parenting a task under a parent clears `epicId` in the same transaction.
- `epic.projectId` must equal `task.projectId` (400 `epic_not_found`, same pattern as the cross-project section check tested at `backend/test/taskOrdering.test.ts:472`).
- Epic status is manual (as in Jira). Progress is derived: `done` = top-level tasks with `epicId` and `status = DONE`; `total` = top-level tasks with `epicId`. Subtasks do not count.
- Deleting an Epic keeps its tasks (`SetNull`), mirroring section delete.
- `lib/duplicate.ts` copies keep `epicId` (same project). Section duplicate therefore keeps epic links.
- Migration: one `prisma migrate dev --name epics` adding the table and column. No backfill.

## 5. API contract

All under `requireAuth`; write routes use `requirePermission("project:write")` (same as sections). Visibility via `ensureProjectVisible`; new `ensureEpicVisible` in the epics router, modelled on `ensureSectionVisible` at `backend/src/routes/sections.ts:15` (404, not 403).

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/projects/:id/epics` | — | `Epic[]` ordered by `position`, each with `progress: { done, total }`. One `groupBy` on tasks, no N+1. |
| POST | `/projects/:id/epics` | `{ title, description?, color?, ownerId?, startDate?, dueDate? }` | `Epic` (appended at end) |
| PATCH | `/epics/:id` | any subset of the fields above + `status`, `position` | `Epic` |
| DELETE | `/epics/:id` | — | 204; tasks keep data, `epicId` → null |
| GET | `/epics/:id` | — | `Epic` + `progress` + `tasks` (top-level, ordered by `position`) |

Task routes gain `epicId: number | null` in the task create schema in `backend/src/routes/projects.ts` and the task update schema in `backend/src/routes/tasks.ts`. `GET /projects/:id/tasks` returns `epicId` on every task; the response stays flat.

Errors: `epic_not_found` (400, body field; same convention as `customer_not_found`), `epic_on_subtask` (400).

## 6. UI

Design: `docs/DESIGN.md` is binding. The epic chip follows `frontend/src/components/LabelChip.tsx` (color background + computed contrast text). Status uses the existing `StatusChip`. No new tokens.

### Epics tab — `/projects/:id/epics` (new entry in the tab list at `frontend/src/pages/ProjectDetail.tsx:25-31`, after Gantt)

- Table of epics: color dot + title, `StatusChip`, owner avatar/name, due date, progress bar `done/total`.
- Inline create (title only), rename, color pick, delete with confirm ("Tasks keep their data and lose the epic link").
- Row click opens an epic detail panel: description, status select, owner, dates, story list (title + `StatusChip`), "Add story…" inline create that posts `{ epicId }`.
- Empty state: "No epics yet. Group this project's tasks into larger deliverables."

### Task surfaces

- `TaskPanel.tsx` and `TaskFormModal.tsx`: an "Epic" select (none + project epics). Hidden when the task is a subtask; the subtask breadcrumb shows the parent's epic chip.
- Kanban (`kanban-v2/cards.tsx`): epic chip on the card, next to labels. `SolvroKanban.tsx` filter popover gains "Epic" (all / no epic / one epic), following the `filterAssigneeId` render-only pattern at `SolvroKanban.tsx:216-226`. Drop math stays on `topLevelAll`.
- List (`pages/views/ProjectList.tsx`): epic chip on `TaskRow`; the same Epic filter in the List toolbar.
- Gantt: no change in v1.
- Excel export (`lib/gantt/exportExcel.ts`): one "Epic" column on task rows. PDF: no change.

## 7. Tasks

### T1 — Backend: model, migration, epics router, task `epicId` (M) — **spine: `schema.prisma`, `routes/tasks.ts`, `routes/projects.ts` → instant review**

`backend/prisma/schema.prisma`, new `backend/src/routes/epics.ts` + mount in `app.ts`, `routes/projects.ts` (list/create epics, task create schema), `routes/tasks.ts` (update schema, re-parent clears `epicId`), `lib/duplicate.ts` select list. Tests: new `backend/test/epics.test.ts` (CRUD, ordering, visibility 404, progress counts, cross-project 400, `epic_on_subtask` 400, re-parent clears epic, delete sets null). Extend `taskDuplicate.test.ts` for `epicId` copy.

Acceptance: all of §4 rules have a failing-then-passing test; `docker compose exec backend npx tsc --noEmit` clean; epics list is 1 query + 1 groupBy.

### T2 — Frontend data layer (S) — **spine: `lib/queries.ts` → instant review**

`Epic` type, `epicId` on `Task`, `useProjectEpics`, `useEpic`, `useCreateEpic`, `useUpdateEpic`, `useDeleteEpic`, `queryKeys.projectEpics`. Task mutations pass `epicId` through. Invalidate `projectEpics` on any task status/epic change (progress). Codes against §5; may run before T1 lands.

### T3 — Epics tab + epic detail panel (M)

New `pages/views/ProjectEpics.tsx`, `components/EpicPanel.tsx`, `components/EpicChip.tsx`, tab entry, route. e2e: `e2e/tests/epics.spec.ts` (create, rename, progress updates when a story goes DONE, delete keeps task).

### T4 — Epic select in TaskPanel + TaskFormModal (S)

Uses `EpicChip` from T3 (or ships a minimal one if T3 is in the same wave; orchestrator picks one owner for `EpicChip.tsx` — T3). e2e: extend `subtask-edit.spec.ts` for the hidden select on subtasks.

### T5 — Kanban chip + filter (M) — **spine: `kanban-v2/` → instant review if `adapter.ts` changes; chip-only change in `cards.tsx` does not**

`cards.tsx`, `SolvroKanban.tsx`. e2e: extend `kanban-dnd.spec.ts` with a filtered-drag case (drop math unaffected by the epic filter).

### T6 — List chip + filter (S)

`ProjectList.tsx` row + toolbar. e2e: filter case in `list-dnd.spec.ts` or `epics.spec.ts`.

### T7 — Excel export column (S)

`exportExcel.ts` + its unit test. Guardrail check: no notes touched, INTERNAL rule unaffected.

## 8. Waves

- **Wave 1**: T1, T2 (parallel; T2 codes to §5).
- **Wave 2**: T3, T4, T5 (T4 and T5 consume T2 hooks; T3 owns `EpicChip.tsx`).
- **Wave 3**: T6, T7.
- Serialize frontend `tsc` runs across each wave (CLAUDE.md trap).

## 9. Open questions for the customer (answer before Wave 2)

1. Do stories need **story points** or estimates? (Not in v1; changes the epic progress definition.)
2. Do they need **issue types** (Bug vs Story) or do labels suffice?
3. Do they keep **phases** (Sections) alongside Epics, or would they use only Epics?
4. Do they need a **Jira import** of existing epics and stories, or start clean?
5. Must the Epic appear on the **Kanban board and Gantt** as its own row, or is chip + filter enough? (v1 = chip + filter.)

## 10. Review & gates

- One full `gates.sh` run per wave at integration; instant opus review for T1, T2, and T5 if `adapter.ts` changes.
- Phase review on the combined diff. Docs-keeper triggers: `schema.prisma` (CONFIGURATION unaffected), new tab (no DESIGN tokens); expected trigger = none unless a finding is deferred.
- CHANGELOG: one `[Unreleased]` entry per task, reported by implementors, appended at integration.

## 11. Risks

- **Progress query cost** on large projects: mitigated by one `groupBy` per list call and the `[epicId]` index.
- **Optimistic cache drift**: a task status change must also invalidate `projectEpics`, or the Epics tab shows stale progress. Covered by T2 acceptance + T3 e2e.
- **Naming**: the customer says "Story", the UI says "Task". Flagged as a non-goal; revisit only on customer request.
