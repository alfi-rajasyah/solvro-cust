# Wave C: bulk edit in the List view, story points in the List

Status: shipped 2026-11-20 (started @ `dde18a4`)
Archive path: `docs/archive/plans/list-bulk-edit.md`

Lane: P (new route, spine). Wave C of `docs/archive/plans/github-feature-waves.md`: GitHub #90, plus the List part of #91.

## Streams

| Stream | Scope | Files |
|---|---|---|
| C1 | `POST /tasks/bulk` | `backend/src/routes/tasks.ts` (spine) and/or a new `backend/src/lib/bulkTasks.ts`, `backend/test/tasksBulk.test.ts` |
| C2 | List selection, bulk action bar, story points column, section totals | `frontend/src/pages/views/ProjectList.tsx`, `frontend/src/lib/queries.ts` (spine), new components under `frontend/src/components/`, tests |

## API contract (C1 builds it, C2 calls it)

`POST /tasks/bulk`, `task:write`. Body (zod, strict):
`{ taskIds: number[] (1..200, unique), addLabelIds?: number[], removeLabelIds?: number[], statusId?: number, assignedToId?: number | null, priority?: "LOW"|"MEDIUM"|"HIGH"|"URGENT", epicId?: number | null }`, with at least one action.
- All tasks visible to the caller and in one project, else 404 `not_found` with no write. Labels must belong to that project, else 400.
- `epicId` on any subtask: 400 `epic_on_subtask`. Inactive assignee: 400 (bulk only; ISS-029 stays open for the single path). A non-member assignee is added as a project member, as in the single update.
- One transaction; status writes go through `resolveStatusWrite` after `lockStatusListShared`; activity recorded per task; `position` never changes.
- Response 200 `{ updated: number }`. The client invalidates the project's task queries.

## Decisions (user, 2026-11-19)

- Cap 200 tasks per request; bulk assign refuses inactive users.
- Subtasks are selectable (labels, status, assignee, priority); epic applies to top-level tasks only.
- Story points: List column, and section totals (sum and done sum) over top-level tasks only.

## Review

One phase review with spine instants (`routes/tasks.ts`, `lib/queries.ts`), two fix rounds:
- Blockers: the bulk write took the project order lock only for epic changes while it row-locks many tasks, so it could deadlock against a reorder, delete or status-delete move (now unconditional, proven by a deterministic `pg_locks` test that fails on the old code); `shadow-overlay` on the in-page bulk bar (removed, DESIGN.md §4).
- Should-fix: client cap of 200; select all covers only rows on screen (expand state hoisted to `ProjectList`); coarse-pointer gaps in the bar; backend tests for notifications, member-only access and no-op writes.
- Nits: no `projectLabels` refresh; no task-list refresh during an inline save; checkbox focus style; phone select-all as a `<label>`; subtask checkbox alignment; `updated` counts only changed tasks.

## Delivery Gate

PASS 2026-11-20: List with selection, bulk bar, Add label and Set status, section story point totals, in light and dark at 1440 and 375 px; no console errors, no horizontal scroll.

## Gates

Green except the local smoke test (ISS-162 GSI origin) and one run of the known `epics.test.ts` flake (ISS-156), which passed on two reruns.
