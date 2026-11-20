# Feature wave B: task filters and story points in the screens

Status: shipped 2026-11-20 (started @ `58c7103`; PRs for B1 and B2)
Archive path: `docs/archive/plans/feature-wave-b.md`

Lane: P. Wave B of `docs/plans/github-feature-waves.md`. B3 (#92 workload) waits on questions 6b–6d.

## Streams

| Stream | Issues | Files (one writer each) |
|---|---|---|
| B1 | #94 epic filter in all four views, #89 label filter in List and Kanban | new `frontend/src/lib/taskFilters.ts` (+ test), `pages/views/ProjectList.tsx`, `components/kanban-v2/SolvroKanban.tsx`, `components/gantt-v2/SolvroGantt.tsx` (spine), `pages/views/ProjectTimeline.tsx`, `pages/ProjectDetail.tsx` |
| B2 | #91 frontend: form, panel, Kanban card, epic totals | `components/TaskFormModal.tsx`, `components/TaskPanel.tsx`, `components/kanban-v2/cards.tsx`, `pages/views/ProjectEpics.tsx`, `lib/queries.ts` (spine, input types only), `lib/taskConflict.ts` |

The List column and the List section totals for story points wait for wave C (`ProjectList.tsx` has one writer per wave).

## Decisions applied

- Epic filter in the URL as `?epicFilter=` (`?epic=` opens the epic panel); the filter state survives a tab switch; Gantt exports stay unfiltered.
- #89 subtask rule (default from the issue, question 2b not answered): a subtask matches on its own labels; a parent row stays visible when one of its subtasks matches. For the epic filter a subtask inherits its parent's epic.
- Story points: whole numbers 0–100 or empty; totals count top-level tasks only; not in the Gantt exports.

## Review

One phase review with spine instants (`gantt-v2/SolvroGantt.tsx`, `lib/queries.ts`). Findings fixed in one round:
- Blocker: the Epic, Assignee and Priority selects had no linked label.
- Should-fix: with a filter active, a Gantt drop that changed nothing on screen saved a new order for hidden rows. Fixed with `reorderAmongVisible` / `visibleOrderUnchanged` in `lib/taskFilters.ts`.
- Should-fix: an invalid story points draft was dropped on blur.
- Nits: filter params ride on every project tab; bordered focus style on the Gantt Filter button; story points caption tied to its input; an all-zero epic shows 0/0.

Deferred: ISS-200, ISS-201, ISS-202.

## Delivery Gate

PASS on the second run, 2026-11-20 (light and dark, 1440 and 375 px; List, Kanban, Timeline, Gantt with the filter open, Epics, task panel incl. an invalid story points value). The first run found:
- The List toolbar did not wrap, so at 375 px the Filter button sat off-screen (present before this wave). Fixed with `flex-wrap`.
- The panel's story points button was named only by its value ("3"). It now reads "Story points 3".
