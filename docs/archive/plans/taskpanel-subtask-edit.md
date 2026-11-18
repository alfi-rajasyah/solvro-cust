# Implementation Plan: Editable subtasks in the task side panel

**Branch:** `fix/taskpanel-subtask-edit` — cut from `origin/develop` (run `git fetch origin` first; local `develop` is 22 commits behind).
**Phase = branch = one PR into `develop`.** Tasks = commits. No commit or PR without explicit user approval.
**Source:** user bug report, 2026-08-07 — "Cannot edit subtask on project task side modal, can only add."

---

## 1. Evidence

**Screenshot** (task "Fortigate Config", SUBTASKS 5/6). Every subtask row carries exactly three
elements: a done-toggle circle, the title as static text, and a drag handle. The only writable
affordance in the whole block is the `+ Add subtask` row underneath it. There is no rename control,
no delete control, and no way to open the subtask.

**Code**, `frontend/src/components/TaskPanel.tsx:503-567`. The row body is a plain
`<span>{s.title}</span>` at `:538-546` — no `onClick`, no input, no menu. Only three mutations are
reachable from the block:

| Line | Handler | Writes |
|---|---|---|
| `:186` | `toggleSubtask` | `status` only |
| `:496` | `onValueCommit` | `position` only |
| `:168` | `handleAddSubtask` | create only |

`title`, `dueDate`, `assignedToId`, `priority`, `labels`, and deletion are all unreachable. The
report is accurate and complete.

**Contrast — the List view already solves this.** `frontend/src/pages/views/ProjectList.tsx:887`:
`onClick={() => onOpenTask(task.id)}`. A subtask row at `/projects/:id/list` opens *this same panel*
targeted at the subtask, where every field is editable. So the capability exists; the panel is the
one surface that renders subtasks without a route into it.

## 2. Root cause

`TaskPanelProps` (`TaskPanel.tsx:65-69`) is `{ projectId, taskId, onClose }`. The panel can close
itself but cannot re-target `?task=`. `ProjectDetail.tsx:178-183` owns that search param and never
hands the setter down. The static `<span>` is the symptom; the missing prop is the cause.

## 3. Options considered

| | Approach | Unlocks | Cost | Verdict |
|---|---|---|---|---|
| **A** | Row click opens the subtask in the panel | every field + delete + comments | ~40 lines, 2 files | **take** — primary |
| **B** | Inline rename on the row | `title` only | ~30 lines, 1 file | **take** — fast path |
| **C** | Hover menu per row (rename / delete / open) | same as A+B | highest | **reject** |

**Why A is primary.** It is the only option that closes the gap completely — dates, assignee,
priority, labels, comments, and delete all arrive at once, through UI that already exists and is
already reviewed. It also makes the panel consistent with the List view instead of a second, weaker
subtask surface.

**Why B as well.** Renaming a typo'd subtask is the common case, and A costs a panel swap plus a
second click for it. B keeps that at one click, and reuses the panel's own click-to-edit title
pattern (`:297-321`) verbatim — no new interaction vocabulary.

**Why C is rejected.** The panel is 380px wide (`md:w-[380px]`, `:211`) and the row already carries
three controls. A hover menu adds chrome, a second delete-confirm path, and a touch-target problem
on phone, for capability A already delivers through the existing `more_horiz` menu at `:257-284`.

## 4. Task list

Three tasks, serial — T1 and T2 touch the same JSX block, so they do not parallelise.

### T1 — Open a subtask in the panel
**Files:** `frontend/src/components/TaskPanel.tsx`, `frontend/src/pages/ProjectDetail.tsx`

1. Add `onOpenTask: (id: number) => void` to `TaskPanelProps`. `ProjectDetail` implements it by
   setting `?task=<id>` — mirror the updater shape of `closeTaskPanel` (`ProjectDetail.tsx:48-58`),
   including `{ replace: true }` so the panel swap does not stack history entries.
2. Subtask title `<span>` (`:538-546`) → a `<button>` calling `onOpenTask(s.id)`. Keep the
   done-toggle and the drag handle as siblings. Verify a handle drag does not also fire the button.
3. **Parent breadcrumb.** When `task.parentTaskId !== null`, render a back control above the title
   (`:296`) — `↰ {parent.title}` → `onOpenTask(parentTaskId)`. Derive the parent from the same
   `tasks` array the panel already reads. This is not optional: `ProjectDetail.tsx:179`'s
   `key={openTaskId}` remounts the panel on every task change, so there is no in-panel history and
   a user who opens a subtask is otherwise stranded.
4. **Depth guard.** Hide the Add-subtask form (`:569-581`) when `task.parentTaskId !== null`.
   `backend/src/lib/taskOrdering.ts:116-147` enforces max depth 1 and rejects a grandchild with
   `max_depth_exceeded`; without this guard the form is a guaranteed server error. Hide the whole
   Subtasks block when the task is itself a subtask and has no children.
5. `handleDelete` (`:190-201`) on a subtask should return to the parent, not close the panel.

**Acceptance:** from the panel, click a subtask → the panel shows that subtask with all fields
editable; the breadcrumb returns to the parent; no Add-subtask form is offered on a subtask;
deleting a subtask lands back on the parent.

### T2 — Inline rename on the subtask row
**Files:** `frontend/src/components/TaskPanel.tsx`

1. Two state vars: `editingSubtaskId: number | null`, `subtaskTitleDraft: string`. Clear both in the
   existing `taskId` reset effect (`:117-125`).
2. Reuse the panel title's own pattern (`:297-321`): `autoFocus` input, `onBlur` commits, Enter
   submits, empty or unchanged is a no-op. Add Escape-to-cancel on the subtask input only — do not
   change the panel title's behaviour in this task.
3. Trigger: a pencil button revealed on row hover and on keyboard focus, placed left of the drag
   handle. `aria-label={`Rename ${s.title}`}`. Do not overload the row click — T1 owns it.
4. Commit through `updateTask.mutate({ id: s.id, patch: { title } })`. `maxLength={200}` to match
   `backend/src/routes/tasks.ts:23`.
5. Gate the pencil on `canEdit`, exactly as the drag handle is (`:547`).

**Acceptance:** hover a subtask → pencil appears; click → inline input; Enter or blur renames;
Escape cancels; a read-only user sees no pencil.

### T3 — Verification
1. New Playwright spec `e2e/tests/subtask-edit.spec.ts` — open the panel, rename a subtask inline,
   open a subtask, return via the breadcrumb. Follow `e2e/CLAUDE.md`; the panel is addressable as
   `role=dialog` / "Task details" (`:209-210`), the pattern `date-picker.spec.ts` already uses.
2. `docker compose exec frontend npm run typecheck`.
3. Full `gates.sh` at integration — orchestrator-owned, serial.

## 5. Review & docs

- **Not on the spine list.** `TaskPanel.tsx` and `ProjectDetail.tsx` are single-tab presentation, so
  no instant review — one phase review at the end.
- Frontend diff ⇒ the reviewer applies the design lens and reads `docs/DESIGN.md` live. The
  implementor reads it before choosing the pencil's hover treatment and the breadcrumb's type scale.
- **CHANGELOG entry required** at integration (one entry, user-facing wording): subtasks in the task
  side panel can now be renamed inline and opened for full editing.
- docs-keeper: no trigger fires unless `index.css` is touched. Expect to skip it.

## 6. Risks

- **Panel swap loses scroll and comment draft.** `key={openTaskId}` unmounts everything, including
  any half-typed comment in `PanelComments` (`:592`). Accepted — the List view already behaves this
  way. The breadcrumb makes the swap recoverable; it does not make it lossless.
- **Row now has four controls at 380px.** Toggle, title, pencil, handle. Check the 375px floor from
  `frontend/CLAUDE.md` — if the pencil crowds the handle, hide the pencil below `md:` and rely on
  T1's row click plus the opened panel's title editor on phone.
- **Sortable interaction.** Making the title a button inside a `SortableItem` risks swallowing drag
  activation. Activation is handle-only (`:507-514`), so the risk is low — confirm with the existing
  drag e2e rather than by inspection.
