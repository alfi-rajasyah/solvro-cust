# Collaboration and link sharing

Status: approved 2026-09-29. Live tracker (statuses, PRs, decisions): https://claude.ai/artifact/4YR4dJhjRsEyt98EYfUpDe
Code comments cite this plan as `docs/archive/plans/collaboration-and-sharing.md`.

Goal: several TAMs work on the same projects and share links to them.

## Decisions (user, 2026-09-29)

- C1: members get full edit (no Viewer level yet). TAM, existing members, and `project:view-all` users manage the member list.
- C2: assigning a task to a user who cannot see the project adds them as a member (same transaction); the picker says so.
- C3a: 30 s refresh is acceptable. C3b (server push) deferred — keep it in the plan.
- C4: conflict check covers task-panel field edits only; board/Gantt drags stay last-write-wins.
- C5a: activity events kept 180 days, removed by a daily cleanup job. Never store note bodies.
- C5b: in-app notifications only; email later.
- L4: approved as phase 6, after phases 1–4 ship. Guest view = milestones and phase dates only, no notes, no task detail.
- X1 (readable project keys): deferred.

## Phases (phase = branch = PR into develop)

1. Quick wins — L2, L3, C3a.
2. Project members — C1, C2, L1.
3. Conflict warning — C4 (after phase 2: both touch schema.prisma and routes/tasks.ts).
4. Activity and notifications — C5a → C5b → C5c.
5. Instant updates — C3b (deferred).
6. Guest links — L4.

## Phase 1 tasks

- L2 — keep the deep link through sign-in. `AuthGuard.tsx` saves `pathname + search + hash` as `from`; `Login.tsx` accepts `from` only when it starts with `/` and not `//` (else `/overview`). Both password and Google paths use it. E2E: signed out → `/projects/:id?task=:tid` → sign in → task panel open.
- L3 — Copy link. Icon button in the project header and the customer header (copies the current URL incl. tab/query); "Copy task link" in `TaskPanel.tsx` (`/projects/:id?task=:taskId`, absolute URL). Reuse `copyText` (`lib/clipboard.ts`), toast "Link copied".
- C3a — freshness. `refetchOnWindowFocus: true` + `refetchInterval: 30_000` (visible tab only) on the project-scoped task/board/Gantt queries and the project/customer detail queries. The interval pauses while a board/Gantt drag is active or a mutation is pending, so a refetch never moves a card under the cursor or clobbers an optimistic update.

## Phase 2 tasks and API contract (project members — C1, C2, L1)

Shipped phase 1 in PR #17 (2026-09-30).

### Data
- New `ProjectMember` (`project_members`): `projectId`, `userId`, `addedById` (nullable, SetNull), `createdAt`; primary key `(projectId, userId)`; index on `userId`; cascade on project and user delete.
- `projectVisibilityFilter` gains the arm `{ members: { some: { userId: user.sub } } }`. `customerVisibilityFilter` inherits it through its project arm. Members get the same access as the TAM.

### API
- `GET /projects/:id/members` → `ProjectMember[]` ordered by username, excluding the project's TAM:
  `{ userId, username, email, avatarUrl: string | null, addedAt: string, addedBy: { id, username } | null }`.
- `POST /projects/:id/members` body `{ userId }` → 201 with the member (200 when already a member — idempotent). 400 `is_tam` when `userId` is the project's TAM; 400 `user_inactive`; 404 `user_not_found`.
- `DELETE /projects/:id/members/:userId` → 204 (also when not a member).
- All three: `project:read` (GET) / `project:write` (POST, DELETE) plus `ensureProjectVisible` — so the TAM, members, customer owners and `project:view-all` users can manage members.
- `GET /users` adds `active: boolean` and `avatarUrl: string | null` to each row (additive).
- Task assignment (C2): `POST /projects/:id/tasks` and `PATCH /tasks/:id` — when `assignedToId` names a user who is neither the project's TAM nor a member, the same transaction creates the membership (`addedById` = the acting user). Task responses do not change. The frontend invalidates the members query after any task save that sets `assignedToId`.

### Frontend
- C1: member avatars next to the TAM in the project header; a Members dialog to add (person picker over active users from `/users`) and remove members. A user who removes themselves and loses access is sent to `/projects`.
- C2: every assignee picker shows "Assigning this person also adds them to the project." when the picked user is neither the TAM nor a member.
- L1: blocked-link text on the project and customer pages: "This project doesn't exist or isn't shared with you. Ask the project's TAM to add you as a member." (customer page: "This customer doesn't exist or isn't shared with you."). Keep the 404 behaviour.

### Phase 2 decisions (user, 2026-09-30)
- Ownership stays with owners: access through membership alone does not allow changing a project's TAM or customer, deleting a project, changing a customer's owner, or deleting a customer. Those need the access a non-member already had (project TAM, customer owner, an unowned customer, or `project:view-all`). Refused with 403 `owner_only`.
- Removing a member also unassigns their tasks in that project, in the same transaction. `GET /projects/:id/members` rows add `assignedTaskCount: number` so the dialog can warn first.
- Daily Review (and `/overview/badges`) include projects where the user is a member.
- Members see the project customer's iTop data, like the TAM (reads use the app token; writes still use the member's own token).
- Saving a task re-runs C2 only when the assignee actually changes, so removing a member sticks. Task duplication never adds members (it must not re-grant a removed member).

## Phase 3 tasks and API contract (conflict warning — C4)

Shipped phase 2 in PR #18 (2026-09-30).

### Decision (user, 2026-09-30)
Per-field check, not `Task.updatedAt`: a board or list reorder rewrites the `position` of every sibling task (`lib/taskOrdering.ts`), so a whole-row timestamp would raise false warnings on tasks nobody edited. The client sends the value it last saw for each field it changes; the save fails only when someone changed that same field. Two people editing different fields never conflict. No schema change.

### API — `PATCH /tasks/:id`
- New optional body field `expected`: an object with the value the client last saw for any of these fields: `title`, `description`, `status`, `priority`, `startDate`, `dueDate`, `assignedToId`, `sectionId`, `epicId`, `parentTaskId`, `isMilestone`, `isCriticalPath`, `labelIds` (compared as a set). Dates compare as calendar days under the existing date contract (`lib/dateField.ts`); `null` means "was empty".
- Inside the write transaction, the server locks the task row (`SELECT … FOR UPDATE`) before comparing, so two concurrent saves cannot both pass the check.
- On any mismatch: 409 with code `stale_write` and `details: { conflicts: [{ field, expected, current }], task: <current task in the same shape as a normal PATCH response> }`. Nothing is written.
- `expected` absent → today's behaviour (last write wins). Board, List and Gantt edits and drags keep sending no `expected`.

### Frontend
- Task panel inline edits and the task edit form send `expected` for exactly the fields they change (form: diff against the task it opened with).
- On `stale_write`: roll back the optimistic change and show an in-app dialog "Someone changed this task after you opened it", listing each conflicting field with their value and yours, and two actions: **Use theirs** (discard mine, refetch) and **Keep mine** (resend the same change without `expected`).
- Subtask done/undone toggles in the panel stay last-write-wins (a single-click action, like a board move).
