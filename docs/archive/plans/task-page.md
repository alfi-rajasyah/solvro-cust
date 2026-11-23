# Task page

Status: shipped 2026-11-23
Archive path: `docs/archive/plans/task-page.md`

A task gets its own page at `/tasks/:id`. Today a task opens only in the side panel (`?task=<id>` on a project tab, `frontend/src/components/TaskPanel.tsx`) or in the pop-up editor on `/tasks` (`TaskFormModal` in edit mode). Lane P: a new page, a new read route and spine touches (`backend/src/routes/tasks.ts`, `frontend/src/lib/queries.ts`).

## Decisions (user, 2026-11-23)

- **D1: URL `/tasks/:id`.** Short and shareable. It needs `GET /tasks/:id`, because the page knows only the task id.
- **D2: four entry points.**
  - An "Open as page" button in the side panel header.
  - A row click on `/tasks` opens the page, not the pop-up editor.
  - A task result in the Ctrl+K palette opens the page.
  - "Copy link" copies the page URL. The user picked a menu item; the panel already had a Copy link button in its header, so that button now copies the page URL instead, and the menu gets no second copy item (orchestrator decision, 2026-11-23).
- **D3: two columns on desktop.** Main column: title, description, subtasks, Outline pages, comments. Side column: status, owner, dates, priority, points, epic, iTop ticket, labels. One column on phone (below `md:`).

## Decisions made in this plan

- **D4: one task body, two shells.** The side panel's content moves into one component that both the panel and the page render, with a `layout` prop (`"panel"` or `"page"`). The panel keeps its shell (fixed position, focus, Escape to close). Reason: one place for every field and save rule, so the page and the panel cannot drift. The Task options menu (Duplicate, Delete) is one shared component too.
- **D5: navigation inside the page.** A subtask row and the parent breadcrumb go to that task's page. After a delete, a subtask goes to its parent's page, and a top-level task goes to its project's List tab.
- **D6: missing or hidden task.** `GET /tasks/:id` answers 404 for a task the user cannot see (`ensureTaskVisible`), the same as for a task that does not exist. The page shows one "not found" state with a link to `/tasks`.
- **D7: the page header.** A breadcrumb (project name, linked to the project, then the task) from `lib/routeMeta.ts`; the status chip and the Task options menu as in the panel. No close button: the browser Back button and the breadcrumb leave the page.

## Tasks

| Task | What | Main files | Spine |
|---|---|---|---|
| 1 | `GET /tasks/:id`: the task with the same shape as the list rows (`taskResponseInclude`) plus `project: { id, name }`. `project:read` (router level) and `ensureTaskVisible` (404). Backend vitest: visible, hidden (404), missing (404), no `project:read` (403). | `backend/src/routes/tasks.ts`, backend test | `routes/tasks.ts` |
| 2 | Split `TaskPanel.tsx`: the body moves to a new `TaskDetail` component with the `layout` prop (D4); the options menu moves to a shared `TaskOptionsMenu`. The panel looks and behaves exactly as before. Existing panel tests and e2e specs stay green with no change to what they assert. | `frontend/src/components/TaskPanel.tsx`, new `TaskDetail.tsx`, new `TaskOptionsMenu.tsx`, their tests | none |
| 3 | The page: route `tasks/:taskId` in `App.tsx`; `pages/TaskPage.tsx` with `useTask(id)` (new hook and query key); breadcrumb in `routeMeta.ts`; the `"page"` layout of `TaskDetail` (D3); D5, D6, D7. Mutations that change a task also refresh the `useTask` entry. | `frontend/src/App.tsx`, new `pages/TaskPage.tsx`, `frontend/src/lib/queries.ts`, `frontend/src/lib/routeMeta.ts`, `TaskDetail.tsx` | `lib/queries.ts` |
| 4 | Entry points (D2): "Open as page" in the panel header; the existing header `CopyLinkButton` copies the absolute `/tasks/:id` URL; `/tasks` row click goes to the page and the edit-mode `TaskFormModal` on `/tasks` is removed; the Ctrl+K task result links to the page. | `TaskPanel.tsx`, `TaskOptionsMenu.tsx`, `frontend/src/pages/Tasks.tsx`, `frontend/src/components/CommandPalette.tsx`, e2e specs | none |

Order: wave 1 runs tasks 1 and 2 in parallel (backend and frontend, no shared file). Then one implementor does task 3 and then task 4 (both need task 2; task 3 needs task 1).

## Acceptance

- `/tasks/:id` loads on a direct visit and after a reload, for a task the user can see; a hidden or missing task shows the not-found state.
- Every field that saves in the panel saves on the page, with the same rules.
- The four entry points open or copy the page URL.
- The side panel looks and behaves as before, apart from the new button and menu item.
- Two columns at `md:` and wider, one column at 375 px, both themes; keyboard focus order follows the reading order.
- `Tasks.tsx` and `/tasks` stay (Guardrails).
- Tests: backend vitest (task 1); frontend vitest for `TaskDetail` layouts, `TaskOptionsMenu` and the page states; a new `e2e/tests/task-page.spec.ts` (direct visit, reload, panel button, `/tasks` row, Ctrl+K, copy link, not-found, phone layout); existing specs that open the `/tasks` pop-up editor are updated.
- `CHANGELOG.md` entries; Delivery Gate recorded here.

## Review

Instant review on task 1 (`routes/tasks.ts`) and on task 3 (`lib/queries.ts`); one phase review on the combined diff.

## Out of scope

- A page for epics.
- Editing several tasks from the page.
- Changing what the side panel shows.

## Result

- Tasks 1 to 4 shipped as planned, with the Copy link change recorded in D2.
- Reviews: instant reviews on tasks 1 and 3 and on two fix rounds, plus one phase review; no blockers. Fixed along the way:
  - an Escape regression from the panel split (an inner dialog's Escape could close the panel);
  - a failed background refetch that could unmount the page and lose a draft;
  - the iTop pin and focus tests for the edit form, which only the Gantt row menu opens now.
- Making that focus test pass exposed real focus loss in the Gantt row menu. Edit, Add subtask and Delete now open their dialog after the menu has closed. The task form drawer restores focus to its opener only when focus fell to the page.
- Deferred: ISS-210 (Gantt menu wait uses a document-wide selector), ISS-211 (placeholder row's unknown customer). The kanban-dnd flakes were added to ISS-138.
- `gates.sh`: all gates pass, including the spine review. The Playwright step ran smoke, `deep-link`, `gantt-row-menu-focus`, `itop-task-modal-panel`, `kanban-dnd`, `search`, `task-conflict` and `task-page`.
- Delivery Gate PASS 2026-11-23, light and dark at 1280 and 375 px:
  - `/tasks/:id` shows two columns on desktop (title, description, subtasks and comments; the fields in a divided side column) and one column on a phone (fields after the description).
  - The breadcrumb reads Tasks / project / task.
  - The side panel shows the new "Open as page" icon next to Copy link.
  - `/tasks/99999999` shows "Task not found" with "Back to Tasks".
