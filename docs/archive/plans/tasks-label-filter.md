# Tasks page label filter (GitHub #132)

Status: shipped 2026-11-23
Archive path: `docs/archive/plans/tasks-label-filter.md`

The cross-project Tasks page (`/tasks`, `frontend/src/pages/Tasks.tsx`) gets a "Label" filter. Lane P: it needs a new read route (`GET /labels`) and touches the spine (`backend/src/routes/tasks.ts`, `frontend/src/lib/queries.ts`).

## Facts checked in the code

- Labels belong to one project and are unique per project by name (`Label @@unique([projectId, name])`, `backend/prisma/schema.prisma`). The only label list route is `GET /projects/:id/labels` (`backend/src/routes/projects.ts`). `backend/src/routes/labels.ts` has only `PATCH` and `DELETE`.
- `GET /tasks` accepts one `labelId` (`tasksListQuerySchema`, `backend/src/routes/tasks.ts`). A label id is one project's label, so it cannot filter across projects.
- The Filter menu chips on `/tasks` (Status, Priority, Assignee, Customer) are React state only (`activeFilters` in `Tasks.tsx`). Only `?view=`, `?tamId=` and `?assigneeId=` are in the URL. The issue says "kept in the URL like the other filters on this page", but the other chips are not in the URL. Task 3 fixes this (Q1).
- The project List keeps its label filter in the URL as label ids (`hooks/useTaskFilters.ts`, `lib/taskFilters.ts`) and drops stale ids after the labels load. Task 2 follows this pattern.
- Prisma `mode: "insensitive"` compiles to `ILIKE`, so `_` and `%` in a label name would act as wildcards (the comments in `backend/src/routes/auth.ts` and `backend/src/routes/admin.ts` record this trap). A name match must be an exact compare, never `ILIKE`.

## Decisions (the issue leaves these to the PR; D1 confirmed by the user 2026-11-23)

- **D1: group labels by name.** The picker lists each label name once, case-insensitively, across the projects the user can see. A pick filters every visible project's label with that name. Reason: a TAM filters "Blocked" across all projects, not "Blocked in project X". A per-project list would repeat the same name once per project.
- **D2: "is any of".** The Label field is a multiselect with one operator, `is_any_of`: a task matches when it has one or more of the picked labels.
- **D3: the API filters by name.** `GET /tasks` accepts `labelName` (repeated, 1 to 20 values). The server loads the labels of visible projects and keeps those whose key (`labelNameKey` in `backend/src/lib/labelNames.ts`: trimmed, lowercased, compared in JS) equals a requested name's key, then filters with `labels: { some: { id: { in: ids } } }`. No match gives an empty list, not an unfiltered one. `labelId` stays as it is.
- **D4: the picker label.** Each option shows the name. The display casing is the one used by the most projects (ties: alphabetical first). The option shows no colour, because one name can have a different colour in each project.

## Tasks

| Task | What | Main files | Spine |
|---|---|---|---|
| 1 | `GET /labels` returns `[{ name, projectCount }]` for the labels of visible projects, grouped by the same `labelNameKey`, sorted by name. Requires `project:read`, applies `projectVisibilityFilter`. `GET /tasks` accepts `labelName` per D3. | `backend/src/routes/labels.ts`, `backend/src/routes/tasks.ts`, backend vitest | `routes/tasks.ts` |
| 2 | `useLabelNames()` hook and `TasksFilter.labelNames` (sent as repeated `labelName`). "Label" multiselect field in the `/tasks` Filter menu. The picked names live in the URL as repeated `?label=` and survive a reload; a name with no label left in any visible project is dropped after the list loads. | `frontend/src/lib/queries.ts`, `frontend/src/pages/Tasks.tsx`, frontend vitest, `e2e/tests/task-filters.spec.ts` or `tasks-views.spec.ts` | `lib/queries.ts` |
| 3 | The other chips (Status, Priority, Assignee, Customer) move into the URL the same way. | `frontend/src/pages/Tasks.tsx`, frontend vitest, e2e | none |

One implementor. The tasks are commits in order (task 2 needs the task 1 contract).

## Acceptance

- Labels of a project the user cannot see are never listed and never counted in `projectCount`. A `labelName` filter never returns a task from a hidden project (backend vitest with a member who sees one of two projects).
- A name with `_` or `%` matches only itself (backend vitest).
- More than 20 `labelName` values answers 400.
- The Label filter combines with the view tabs and the other chips by intersection.
- Clearing the Label filter shows all tasks again; a reload keeps it.
- 375px and both themes; Delivery Gate recorded here.
- `CHANGELOG.md` entry under `[Unreleased]`.

## Review

Spine touch: an instant review on task 1 (`routes/tasks.ts`), then one phase review on the combined diff.

## Answered questions

- **Q1 (user, 2026-11-23):** all `/tasks` chips move into the URL (task 3), so the page keeps one rule for every chip.

## Out of scope

- Label filter on Gantt and Timeline.
- A per-project label picker on `/tasks`.

## Result

- Tasks 1 to 3 shipped as planned. One change from the plan: names match in JS through one shared key (`backend/src/lib/labelNames.ts`: trimmed, lowercased) over the labels of visible projects, not in SQL, so `GET /labels` and the `labelName` filter always agree. This came from the instant review of task 1.
- Phase review: no blockers. The one should-fix (a URL `?customer=` became a hidden filter for a user without `customer:read`) and 3 nits (cache-key comments, a status-id assumption in an e2e test, 2 missing hook tests) were fixed in one round.
- `gates.sh`: all gates pass. e2e: `tasks-views`, `task-filters` and `tasks-load-more` pass against the dev stack.
- Delivery Gate PASS 2026-11-23: `/tasks?view=all&label=…` in the light and dark themes at 1280 and 375 px. The Label chip reads "Label · is any of · <name>", the picker lists each name once with search and a check on the picked name, and the list shows only the labelled task. At 375 px the chip and picker fit the width; the table scrolls sideways as before.
