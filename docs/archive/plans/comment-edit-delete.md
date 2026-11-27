# Edit and delete task comments (GitHub #169)

Status: shipped 2026-11-27 (written 2026-11-27 @ `77280d7`)
Archive path: `docs/archive/plans/comment-edit-delete.md`

Lane: P (new routes, a schema column, two new outgoing webhook event types, a new UI control on the task panel). One phase, one PR. Spine touches: `backend/src/routes/tasks.ts`, `schema.prisma` + a migration, `frontend/src/lib/queries.ts`, so the phase also gets instant opus reviews.

## Problem

A comment cannot be changed after it is posted. `backend/src/routes/tasks.ts` has only `GET` and `POST /tasks/:id/comments`. #169 asks for this on subtasks, but every task (task, subtask, epic child) uses the same thread (`PanelComments` in `frontend/src/components/TaskDetail.tsx`), so the fix covers all of them.

## Decisions (user, 2026-11-27)

- D1: the same rule as project notes and customer notes (`routes/projects.ts` `PATCH`/`DELETE /:id/notes/:noteId`). Only the author edits. The author or an admin (`*`) deletes, and a delete removes the row.
- D2: a changed comment shows "edited". A new nullable column, `Comment.editedAt`, is set when the body changes.
- D3: a comment that an incoming webhook URL wrote (`Comment.source = "incoming"`; its author is the URL's creator) cannot be edited. Delete follows D1.
- D4: outgoing webhooks get two new event types in this phase, `comment.updated` and `comment.deleted`.
  - Each subscription stores an explicit `eventTypes` list, so an existing subscription receives them only after its owner selects them.
  - `comment.updated` carries `comment: { id, text }`, the same 500-character excerpt as `comment.created`.
  - `comment.deleted` carries `comment: { id, text: null }`. The payload is built at send time, after the row is gone, so deleted text never leaves Solvro.
  - Neither one is sent for a comment that an incoming URL wrote, which keeps the loop rule of `comment.created` (`backend/src/lib/webhooks/dispatcher.ts`). The delete activity row therefore records `source` in `changes`, because the comment row is gone when the dispatcher runs.

Settled by convention (no user decision needed):

- Both new routes need `task:comment` and task visibility (`ensureTaskVisible`), like `POST`. A user who lost `task:comment` can no longer edit or delete their own comments.
- An edit runs the same body and mention rules as `POST` (`createCommentSchema`, `filterActiveUsersWhoCanSeeProject`). Only mentions added by the edit get a notification. A mention removed by the edit leaves an earlier notification in place.
- Activity: an edit records `comment` / `updated`, and a delete records `comment` / `deleted`, each with `changes: { taskId }` and never the body. An unchanged body records nothing.
- A deleted comment is gone. Its `created` activity row and any notification stay. `eventTaskId` in `frontend/src/lib/activityText.ts` already links a comment event to its task.
- No time limit on edit or delete; notes have none.

## Tasks

1. Backend, schema: add `Comment.editedAt DateTime? @map("edited_at")` and its migration. This applies only if D2 is yes.
2. Backend, routes in `routes/tasks.ts`:
   - `PATCH /tasks/:id/comments/:commentId` takes `{ body, mentionedUserIds? }` and returns the comment with the `GET` shape.
   - `DELETE /tasks/:id/comments/:commentId` returns 204.
   - Errors are 404 `comment_not_found` (also when the comment belongs to another task), 403 `not_comment_author`, and 409 or 403 for an incoming comment per D3.
   - Vitest in `backend/test/` covers the D1 matrix (author, other member, admin, read-only `STAKEHOLDER`, a user without `task:comment`), a cross-task id, mention filtering and the new-mention notification, the activity rows, and the D3 incoming case.
3. Frontend, `lib/queries.ts`: `useEditComment` and `useDeleteComment`. Both are optimistic on `queryKeys.comments(taskId)`: snapshot, write, roll back on error, invalidate on settle. Delete also invalidates the task rows that carry `_count.comments`.
4. Frontend, `TaskDetail.tsx` `PanelComments`:
   - A "Comment actions" menu button on each comment the user may change, with "Edit" and "Delete".
   - Edit replaces the body with the composer (mentions included). Enter or Save saves, and Escape cancels.
   - Delete asks for confirmation in a `Modal`.
   - The menu is always visible at 375px (no hover there), and on desktop it shows on hover and focus.
   - The "edited" mark (D2) uses `text-meta`, next to `fmtAgo`.
   - The copy follows the antislop filter, in "during" mode.
5. Backend and frontend, webhooks:
   - Add the 2 types to `WEBHOOK_EVENT_TYPES` (`backend/src/lib/webhooks/eventTypes.ts`).
   - Map the comment `updated` and `deleted` rows in `events.ts`, and build their payloads in `payload.ts`.
   - Skip incoming-sourced comments in `dispatcher.ts`.
   - Add the labels to `frontend/src/lib/labels.ts` and the type list to `frontend/src/lib/queries.ts`.
   - Add both types and their payloads to `docs/guides/webhooks.md`.
   - Vitest covers mapping, payloads (no text on delete), the incoming skip, and an existing subscription that does not get the new types.
6. e2e: extend `e2e/tests/comments.spec.ts`. The author edits and deletes a comment and the change persists across a reload. A non-author sees no menu. It runs on desktop and on mobile.

## Done when

- The routes, hooks and UI above ship with their tests. `gates.sh` is green, and the spine instants and the phase review are cleared.
- Delivery Gate PASS: in both themes and at 375px, edit, cancel, save, and delete with confirm, all on a subtask.
- CHANGELOG entry, `docs/DESIGN.md` sync if the menu adds a pattern, and this plan archived in the same PR.

## Record

- Built as two parallel tasks (backend; frontend) against the API above, then e2e. Instant opus reviews on the backend and frontend commits, and one phase review. All their findings were fixed in the phase.
- Changes from the plan:
  - An edit counts only when the body changes. A save with the same body is a full no-op: no `editedAt`, no mention change, no activity, no webhook. This matches D2.
  - The delete activity row stores `source` only when it is set (`"incoming"`).
  - The incoming writer now records `source` on the `created` activity too, so one rule skips all three comment events for incoming comments, also after a delete.
- Also fixed: `useAddComment` now refreshes the project's task rows, so the Kanban comment count updates.
- Delivery Gate (2026-11-27): PASS, on a subtask, light and dark, at 1440px and 375px.
  - Checked: the menu, Edit, Save with "edited", the delete confirm, and focus return (editor, then actions button, then the next comment or the composer).
  - The first run failed: the edit box clipped a two-line comment. It was fixed in this phase, and `comments.spec.ts` now covers it.
- Local smoke fails on the dev server, the same way on develop (ISS-225), so the gates ran with `--skip-smoke`. `comments.spec.ts` was run on both projects by hand. CI runs the smoke on the built stack.
