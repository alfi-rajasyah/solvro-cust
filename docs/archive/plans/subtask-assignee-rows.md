# Implementation Plan: Assignee on subtask rows

**Branch:** `feat/subtask-assignee-rows`, cut from `origin/develop` (run `git fetch origin` first).
**Phase = branch = one PR into `develop`.** Tasks = commits. No commit or PR without explicit user approval.
**Source:** user request triage, 2026-11-03, request #2 ("Add assignee per subtask").
**Approved design:** Doop canvas `wIbMMkOajZ`, page "07 · Request triage — Nov 2026", frame
"Triage 01" (`5thIFomzxo`).
**Size:** S. Frontend only, no schema or API change. Not on the spine list.

---

## 1. What already works

Subtasks are ordinary `Task` rows (`parentTaskId` set), so assignment is already supported end to end:

| Surface | Today |
|---|---|
| API | `PATCH /tasks/:id` accepts `assignedToId` for any task, subtasks included (`backend/src/routes/tasks.ts`, update schema). Assigning someone not on the project adds them as a member. |
| Subtask's own panel | Clicking a subtask opens `TaskPanel` on it, and the Assignee row is editable (`frontend/src/components/TaskPanel.tsx`, Assignee block). |
| List "Add subtask…" | Opens `TaskFormModal` with `initialParentTaskId`, which already has an Assignee field (`ProjectList.tsx` → `TaskFormModal.tsx`). |
| Kanban card subtask list | Shows the assignee avatar (`kanban-v2/cards.tsx`, `SubtaskRow`). |

## 2. The gap

Two subtask surfaces show **no assignee at all**, so you can't see or change who owns a subtask without opening it:

1. **List view**: `SubtaskRow` in `frontend/src/pages/views/ProjectList.tsx` renders the drag handle, done-toggle, title and critical-path mark only. The parent row's `AssigneeSelect` column has no subtask counterpart.
2. **Task panel subtask list**: rows in `TaskPanel.tsx`'s Subtasks block render toggle, title, and rename/duplicate actions. There is no avatar.
3. **Task panel quick-add**: `handleAddSubtask` creates with `{ title, parentTaskId, sectionId, status }` only, so a subtask can't be assigned as it's created.

## 3. Tasks

### Task 1: Owner column on List subtask rows
- Give `SubtaskRow` the same desktop grid as the parent row (`grid-cols-[28px_minmax(200px,1fr)_60px_70px_50px_100px]`) so the avatar lands in the **Owner** column.
- Reuse `AssigneeSelect` unchanged, passing `onSetAssignee` down from the parent (same handler, so the same membership rule applies).
- `stopPropagation` on the cell, as the parent row does, so picking an assignee doesn't open the panel.
- Read-only users see the avatar with no picker (`canEdit=false`, same as parent rows).
- Mobile stacked layout: avatar after the title.

**Acceptance:**
- A subtask's avatar sits in the Owner column, aligned with the parent rows.
- Changing it saves via `PATCH /tasks/:id` with the optimistic update and rollback the parent rows already use.
- Assigning someone not on the project shows the existing "(not on project)" hint, and adds them as a member.

### Task 2: Avatar and picker on Task panel subtask rows
- Add an `AssigneeAvatar` (xs) to each subtask row, before the hover actions.
- Click opens a compact picker. Reuse the panel's own assignee `<select>` pattern and `useAssigneeMembership`, so there's no new component.
- The panel is 380px wide, so keep it to avatar-only. No name text.

**Acceptance:**
- Each subtask row shows its assignee or the dashed "?" unassigned avatar.
- Changing it updates the row and the subtask's own panel.

### Task 3: Optional assignee on the panel's "Add subtask"
- Add a small assignee picker next to the quick-add input. It defaults to Unassigned and remembers the last pick while the panel stays open.
- Pass `assignedToId` in the `createTask.mutateAsync` body. `POST /tasks` already accepts it.

**Acceptance:** creating a subtask with an assignee picked shows it assigned immediately, with no second request.

## 4. Verification
- Scoped checks: frontend typecheck, plus unit tests for any extracted helper.
- e2e: extend the project-list spec: assign a subtask from its row, reload, see the avatar persist; same from the panel's subtask list.
- Manual: 375px width. The List stacked layout and the panel row must not overflow.

## 5. CHANGELOG (draft)
Under `[Unreleased]` → Added: subtask rows in the project List and the task panel now show and change the subtask's assignee. The panel's "Add subtask" can assign as it creates.
