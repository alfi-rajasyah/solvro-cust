# Implementation Plan: TAM and Assignee filters on the Overview

**Branch:** `feat/overview-person-filters`, cut from `origin/develop` (run `git fetch origin` first).
**Phase = branch = one PR into `develop`.** Tasks = commits. No commit or PR without explicit user approval.
**Source:** user request triage, 2026-11-03, request #5 ("Filter view per assignee on overview"). The user
chose **two independent pickers, TAM and Assignee**.
**Approved design:** Doop canvas `wIbMMkOajZ`, page "07 · Request triage — Nov 2026", frame "Triage 07"
(`_cQXg29R9U`).
**Size:** M. Backend query params plus frontend. It touches `frontend/src/lib/queries.ts` (spine: instant
review).

---

## 1. Today
`GET /overview` (`backend/src/routes/overview.ts`) returns `workCounts` (overdue, dueThisWeek, openRisks),
`portfolio` (via `computePortfolioRows`), and status counts. Everything is scoped by
`projectVisibilityFilter(user)` (minus `excludeFromPortfolio` for the roll-ups). The tiles count **top-level**
tasks only (`parentTaskId: null`), matching the `/tasks` list each tile opens. "Projects needing attention"
joins `portfolio` with per-project `health` from `GET /projects`. Recent notes come from `GET /notes/recent`.
There is no person filter anywhere.

## 2. Behaviour

| Filter | Tiles (overdue / due this week) | Open risks | Projects needing attention + timeline | Recent notes |
|---|---|---|---|---|
| **TAM = X** | tasks on projects whose `tamId = X` | risks on X's projects | projects with `tamId = X` | notes on those projects |
| **Assignee = Y** | open tasks with `assignedToId = Y` | risks on projects where Y has open tasks | projects where Y has ≥1 open task | notes on those projects |
| **Both** | Y's tasks on X's projects | intersection | X's projects where Y has open tasks | same set |

- **Filtering never widens visibility.** Every filter is AND-composed with `projectVisibilityFilter(user)` (both results' only top-level key is `OR`; never spread into it).
- **Subtasks:** with an **Assignee** filter, count tasks **and subtasks** assigned to Y. Subtask assignment (plan `subtask-assignee-rows.md`) makes subtasks real work items, and a TAM filtering by person expects to see them. Without an Assignee filter the tiles stay top-level-only, exactly as today. The `/tasks` list the tile links to must apply the same rule (Task 3).
- **Project health chips** ("2 overdue", "1 risk") stay project-level, unfiltered. They describe the project, not the person.

## 3. Tasks

### Task 1: Backend filters on `GET /overview`
- Extend `overviewQuerySchema` with `tamId` and `assigneeId` (both `z.coerce.number().int().positive().optional()`).
- `tamId` → add `{ tamId }` to `scope`.
- `assigneeId` → add `{ tasks: { some: { assignedToId, status: { not: "DONE" } } } }` to `scope`. Task counts use `assignedToId` and drop the `parentTaskId: null` clause.
- Open risks: intersect `resolveDailyReviewScope` projects with the filtered scope.
- Add `people: { tams: {id, username}[], assignees: {id, username}[] }` to the response. These are the distinct TAMs and assignees **within the caller's visible scope**, so the pickers never list someone the caller couldn't otherwise discover.
- An unknown or out-of-scope id simply yields zeros. No error, and nothing leaked.

**Acceptance:** unit tests in `test/overviewWorkCounts.test.ts`:
- each filter alone and both together;
- subtasks counted only under the assignee filter;
- a TAM without `project:view-all` passing someone else's `tamId` sees no projects outside their scope.

### Task 2: Pickers on the Overview
- Two pickers in the header row (TAM, Assignee), as in "Triage 07". An active filter shows the person and a clear (×). Use the vendored ReUI select/combobox already in `components/reui/`; no new dependency.
- State lives in the URL (`/overview?tamId=7&assigneeId=12`) via `useSearchParams`. `useOverview` takes the filters and puts them in its query key.
- Tile hints name the filter ("assigned to dimas.pratama"). The projects panel subtitle says "where dimas.pratama has open tasks".
- Recent notes: filter client-side to the filtered portfolio's project ids. Operations (customer) notes hide while any filter is active, since they aren't tied to a project.

### Task 3: Tile links carry the filter to `/tasks`
- `/tasks` gains `tamId` and `assigneeId` URL params, read by `pages/Tasks.tsx` and passed to `GET /tasks` (which already supports `assignedToId`; add `tamId` → `project.tamId`).
- When `assigneeId` is set, `/tasks` includes subtasks, so the count on the tile equals the rows on the list.
- Show a removable filter chip on `/tasks` so the narrowed list is obvious.

**Acceptance:** clicking the Overdue tile with Assignee = Y lands on a list with exactly the tile's count.

## 4. Verification
- Backend vitest on the isolated DB (`overviewWorkCounts`, `tasksFilters`).
- e2e: set the assignee picker, reload (the filter persists from the URL), click a tile, check the list count matches.
- `queries.ts` touched → instant review.

## 5. CHANGELOG (draft)
Under `[Unreleased]` → Added: the Overview can be filtered by TAM and by assignee (kept in the URL). Tiles,
projects needing attention, the timeline and recent notes all narrow, and the tile links carry the filter
to the Tasks page.
