# GitHub feature issues #88–#95: wave plan

Status: in progress (triage 2026-11-19 @ `7d101ef`; wave A started 2026-11-19)
Archive path: `docs/archive/plans/github-feature-waves.md`

Triage of the eight open GitHub feature issues into waves after the design-cleanup wave. Each wave has 2–3 streams whose files do not overlap. `frontend/src/lib/queries.ts` (spine) has at most one writer per wave; `frontend/src/pages/views/ProjectList.tsx` has one writer per wave.

## Issues

| Issue | Lane / size | Schema / route | Spine | Blocked on |
|---|---|---|---|---|
| #88 Task panel description | S / S | none | none | Q1 (default: blur saves, Escape cancels) |
| #89 Filter by label (List, Kanban) | P with #94 / M | none | none | Q2 |
| #90 Bulk edit in the List view | P / L | new `/tasks/bulk` route | `routes/tasks.ts`, `queries.ts` | Q4a (ISS-029) for the assignee action only |
| #91 Story points | P / L | `Task.storyPoints` + migration | `schema.prisma`, `routes/tasks.ts`, `routes/projects.ts`, `queries.ts` | Q5 |
| #92 Utilization workload tab | P / M–L | new `/utilization/workload` route | `queries.ts` | **Q6 (all)** |
| #93 Customer team access | P / L | `CustomerTeamMember` + migration, routes | `schema.prisma`, `lib/visibility.ts`, `queries.ts` | **Q7 (all)**; touches ISS-012, ISS-002, ISS-029 |
| #94 Epic filter in Gantt/Timeline | P / M–L | none | `gantt-v2/` | Q3a (`?epic=` already opens the epic panel) |
| #95 Delete project from the list | S (overlay ⋯) or P (card relayout) / S–M | none | none | Q8 |

Findings that change the issue text: `?epic=` is taken by the epic panel, and project tab links drop the query string (#94); there is no project-duplicate route, only task and section duplicate (#91).

## Waves

| Wave | Stream | Issues | Main files |
|---|---|---|---|
| A | A1 | #88 | `TaskPanel.tsx` |
| A | A2 | #95 | `pages/Projects.tsx`, `pages/ProjectDetail.tsx`, new `DeleteProjectDialog.tsx` |
| A | A3 | #91 backend | `schema.prisma` + migration, `routes/tasks.ts`, `routes/projects.ts`, `lib/duplicate.ts`, `lib/activity.ts`, `queries.ts` (Task type) |
| B | B1 | #94 + #89 | new `lib/taskFilters.ts`, `ProjectList.tsx`, `SolvroKanban.tsx`, `SolvroGantt.tsx`, `ProjectTimeline.tsx`, `ProjectDetail.tsx` |
| B | B2 | #91 frontend | `TaskFormModal.tsx`, `TaskPanel.tsx`, `kanban-v2/cards.tsx`, `ProjectEpics.tsx` |
| B | B3 | #92 (if Q6 answered) | `routes/utilization.ts`, `pages/Utilization.tsx`, `queries.ts` |
| C | C1 | #90, then #91 List column and totals | `routes/tasks.ts`, `ProjectList.tsx`, `queries.ts` |
| D | D1 | #93 alone | `schema.prisma` + migration, `lib/visibility.ts`, `routes/customers.ts`, `lib/dailyReviewScope.ts`, `lib/projectMembers.ts`, `CustomerDetail.tsx`, `queries.ts` |

Order: A2 before B1 (`ProjectDetail.tsx`); #91 backend before its frontend; B1 before C1 (`ProjectList.tsx`); #93 alone and never alongside another migration.

## Questions for the user

1. #88: save on blur with Escape to cancel (like the title), or explicit Save/Cancel?
2. #89: (a) keep the label filter in the URL with the epic filter? (b) a subtask shows when its own labels match and keeps its parent row visible — or do parent labels apply to subtasks?
3. #94: (a) filter param name: `?epicFilter=` (recommended) or rename the panel's `?epic=`? (b) keep the whole filter state across tabs, or epic only? (c) Gantt exports stay unfiltered?
4. #90: (a) ISS-029: refuse inactive assignees in both single and bulk, bulk only, or neither? (b) auto-add a non-member assignee as a member, as single update does? (c) subtasks selectable (labels, status, assignee, priority; epic top-level only)? (d) cap 500 or lower (ISS-190)?
5. #91: (a) free 0–100 or a Fibonacci set? (b) do subtask points roll up, or top-level only? (c) log changes in activity? (d) in Gantt exports? (e) read "duplicating a project" as task and section duplicate?
6. #92: (a) `report:executive` holders org-wide (like `/reports/executive`) or limited to visible projects? (b) others: only themselves, or also people assigned in projects they own? (c) count subtasks separately? (d) without iTop: Workload tab only?
7. #93: (a) may team members edit the customer itself (ties to ISS-012) or only its projects? (b) who manages an unowned customer's team? (c) does team membership count as "my projects" in Daily Review? (d) skip adding team members as ProjectMember on assignment? (e) make a project-less customer visible to its team? (f) keep `customer:write` plus the owner rule as the gate?
8. #95: a ⋯ overlay button on the card link (Lane S), or rebuild the card so link and menu are siblings (Lane P, cleaner for accessibility)?

## Decisions (user, 2026-11-19)

- #88: save on blur, Escape cancels (default). The user reported the description "doesn't appear anywhere" after filling it: until #88 it showed only on Kanban cards (two lines) and in the edit form.
- #94: `?epicFilter=`; the filter state survives tab switches; Gantt exports stay unfiltered.
- #91: free whole numbers 0–100; totals count top-level tasks only; changes logged (including the value set at creation); not in the Gantt exports; "duplicating a project" read as task and section duplicate.
- #90: bulk assign refuses inactive users; cap 200 tasks per bulk edit. (ISS-029 for the single-task path stays open.)
- #92: `report:executive` holders see workload org-wide.
- #93: customer-team members may edit the customer itself, not only its projects (ties to ISS-012).
- #95: rebuild the card so the link and the ⋯ menu are siblings.

Still open: #89 (2b subtask rule), #92 (6b–6d), #93 (7b–7f).
