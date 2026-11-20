# Workload tab on the Utilization page (GitHub #92)

Status: shipped 2026-11-20
Archive path: `docs/archive/plans/workload-tab.md`

Lane: P (new route and view). Stream B3 of `docs/plans/github-feature-waves.md`.

## Scope

- `GET /utilization/workload?week=&utcOffsetMinutes=`: one row per assignee for the week (open tasks, due this week, overdue, active in the week, open story points), plus an "Unassigned" row; a detail read for one person's tasks.
- A "Workload" tab on `/utilization`. Clicking a row lists the person's tasks (project, status, due date), each linking to the task panel.

## Decisions (user, 2026-11-19 and 2026-11-20)

- Permissions: no permission = own row only. `workload:team` = the caller plus every user assigned a task in a project the caller owns (`Project.tamId`). `workload:all` = everyone, org-wide. `*` grants both. `report:executive` does not grant workload; the iTop hours scopes keep it.
- Subtasks count as separate tasks (story points sum each counted task's own value).
- Without iTop configured, the page shows only the Workload tab.
- Done-category tasks are not open. Inactive users are hidden unless they still hold open tasks.

## Review

One phase review with the `lib/queries.ts` spine instant; no permission leak found. Fixed in one round:
- Blockers: `e2e/tests/mobile-tables.spec.ts` assumed the iTop hours table (now mocks iTop status, plus a Workload no-scroll test); row buttons had no column names from md up.
- Should-fix: with `workload:all`, the task list showed titles from projects the caller cannot open, and their links 404'd. Now only visible tasks are listed, plus `hiddenCount` (decision taken for the user; counts stay org-wide). Also the footnote copy, skeletons with delay, `outline-hidden`, the help copy, and short phone labels ("Due", "Active") so the numbers align.
- Nits: workload cache invalidated with task writes; `week` dropped from the detail route; all-scope roster via `user.findMany`; "Due in week" / "Active in week" labels.

## Delivery Gate

PASS 2026-11-20: `/utilization` in light and dark at 1440 and 375 px, with no iTop configured (Workload as the only tab), a row expanded, no console errors, no horizontal scroll.
