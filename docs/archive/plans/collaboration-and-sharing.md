# Collaboration and link sharing

Status: complete 2026-09-30 — every approved item shipped (PRs #17–#22); C3b and X1 stay deferred. Archived 2026-09-30. Approved 2026-09-29. Live tracker (statuses, PRs, decisions): https://claude.ai/artifact/4YR4dJhjRsEyt98EYfUpDe
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

## Phase 4 tasks and API contract (activity and notifications — C5a → C5b → C5c)

Shipped phase 3 in PR #19 (2026-09-30). The three items land in order on one branch (one commit each); each wave has a backend and a frontend implementor working against this contract.

### C5a — project activity log
- **Model** `ActivityEvent` (`activity_events`): `id`, `projectId` (cascade on project delete), `actorId` (nullable, SetNull on user delete), `entityType` (`project` | `task` | `comment` | `risk` | `note` | `member`), `entityId`, `action` (`created` | `updated` | `deleted` | `added` | `removed`), `entityLabel` (short display snapshot at write time, so deleted items still read well: the task title; for a comment, its task's title; for a risk, its description flattened to at most 120 characters, because risks have no title; for a member, the username; null for notes), `changes` (JSON, nullable), `createdAt`. Indexes: `(projectId, createdAt desc)` and `(createdAt)`.
- **`changes` shape** for `updated`: `{ <field>: { from, to } }` for short scalar fields (title, status, priority, dates as `yyyy-mm-dd`, flags, section/epic/parent ids, assignee as `{ id, username }`). `description` records `{ changed: true }` with no text. Labels record `{ labels: { added: [names], removed: [names] } }`.
- **Never store note or comment bodies**, and no description text. A note event carries only its id and `visibility`, so the log can never leak an `INTERNAL` note.
- **Written in the same transaction** as the change, through one helper (`lib/activity.ts#recordActivity(tx, …)`), by: task create/update/delete, comment create (`entityType: comment`, `action: created`, `entityLabel` = the task's title), risk create/update/delete, project note create/update/delete, member add/remove (including the C2 auto-add), and project updates to name, status or customer. Reorder-only task writes (position) record nothing.
- **API**: `GET /projects/:id/activity?limit=50&before=<eventId>&actorId=<userId>` (`project:read` + `ensureProjectVisible`) → `{ events: [{ id, entityType, entityId, action, entityLabel, changes, createdAt, actor: { id, username, avatarUrl } | null }], nextBefore: number | null }`, newest first.
- **Retention**: an in-process daily job (pattern of `lib/itop/scheduler.ts`; off under `NODE_ENV=test`) deletes events older than 180 days.
- **Frontend**: a "Recent activity" section on the project Overview tab — one plain sentence per event ("maya.putri changed the due date of *Configure backup jobs* from 2 Oct to 5 Oct"), actor avatar, relative time, a person filter, and "Load more". Uses `useLiveRefresh`.

### C5b — in-app notifications
- **Model** `Notification` (`notifications`): `id`, `userId` (cascade), `activityEventId` (cascade — so the 180-day cleanup also removes notifications), `reason` (`assigned` | `commented` | `mentioned`), `readAt` (nullable), `createdAt`. Index `(userId, readAt, createdAt desc)`.
- **Created in the same transaction** as the event. Triggers: a task assigned to you by someone else (`assigned`); a comment by someone else on a task assigned to you (`commented`); a mention (`mentioned`, C5c). One notification per user per event (a mention on your own assigned task is `mentioned` only). Never notify the actor. Skip users who cannot see the project (use the visibility rules) and inactive users.
- **API**: `GET /notifications?limit=30&before=<id>` → `{ notifications: [{ id, reason, readAt, createdAt, event: <activity event as above>, projectId, projectName }], nextBefore }`; `GET /notifications/unread-count` → `{ count }`; `POST /notifications/:id/read` → `{ id, readAt }` (404 for another user's or a missing row); `POST /notifications/read-all` → `{ updated }`. A user only ever sees their own rows.
- **Frontend**: a bell in `TopBar.tsx` with an unread badge (polls the count every 60 s while visible), a dropdown list (newest first, unread marked), clicking an item marks it read and opens `/projects/:id?task=:taskId` (or the project for non-task events), and "Mark all as read". In-app only — no email.

### C5c — @mentions in comments
- **Model**: `Comment.mentionedUserIds Int[]` (default empty).
- **API**: `POST` comment accepts `mentionedUserIds: number[]`; the server keeps only ids of active users who can see the project, stores them, and creates `mentioned` notifications. Comment responses include `mentionedUserIds`.
- **Frontend**: typing `@` in the task-panel comment box opens a picker of the project's TAM and members; picking inserts `@username` and records the id. Comments render recognised `@username` tokens (those whose ids are in `mentionedUserIds`) as name chips.

### Phase 4 decisions (orchestrator, 2026-09-30, from the C5a review)
- A risk's `entityLabel` carries up to 120 characters of its description. Risks are internal and every reader of the feed can already open them; nothing exports the feed. The guest view (L4, phase 6) must never expose the activity feed.
- Note `updated` events use `changes: { visibility }` (not `{ from, to }`) and are skipped when the body did not change.
- Task copies made by "Duplicate task" and "Duplicate section" record a `task created` event per copied top-level task.
- `itopTicketRef` changes are logged as `{ from, to }`.
- Admin TAM reassignment is not logged (out of scope for C5a).

## Phase 6 tasks and API contract (guest links — L4)

Shipped phase 4 in PR #20 (2026-09-30). Phase 5 (C3b) stays deferred.

### Decisions (user, 2026-09-30)
- Only owners create, list and revoke guest links: the project TAM, the customer owner, and `project:view-all` users (`ensureProjectOwnerAccess`). Membership alone cannot share a project externally.
- A guest sees, per phase (section): its name, start and end dates, and a status — Done, In progress or Not started. Plus milestones (title, date, done). Nothing else.
- (Orchestrator, from the security review, 2026-09-30) Creating and revoking a link also requires `project:write`; listing requires `project:read`. A read-only role with `project:view-all` (e.g. STAKEHOLDER) can list links but cannot publish a project.
- The token never reaches logs: the request logger redacts `/public/share/<token>` URLs and share-page referers (and the `Authorization` header), and nginx does not access-log `/share/` or `/api/public/share/`.
- Proxy trust is configurable with `TRUST_PROXY` (hop count or Express subnet list, default `1` for nginx only; `2` when a tunnel or CDN sits in front of nginx).

### Data
- `ShareLink` (`share_links`): `id`, `projectId` (cascade), `tokenHash` (SHA-256 hex of the token, unique), `label` (optional, ≤ 80 chars, e.g. "For Nusantara IT"), `createdById` (nullable, SetNull), `createdAt`, `expiresAt`, `revokedAt` (nullable), `lastUsedAt` (nullable).
- The token is 32 random bytes, base64url. Only its hash is stored; the full link is shown once, at creation.

### Owner API (signed in)
- `POST /projects/:id/share-links` `{ label?, expiresInDays? }` (1–90, default 30) → 201 `{ id, label, url, expiresAt, createdAt }` — `url` is the full `/share/<token>` link, returned only here.
- `GET /projects/:id/share-links` → `[{ id, label, createdAt, expiresAt, revokedAt, lastUsedAt, createdBy: { id, username } | null }]` — never the token or hash.
- `DELETE /projects/:id/share-links/:linkId` → 204 (sets `revokedAt`; idempotent).
- All three: visibility 404 first, then 403 `owner_only` for member-only access.
- Creating and revoking record activity events (`entityType: share_link`, `action: created | removed`, `entityLabel` = the label; never the token).

### Public API (no auth)
- `GET /public/share/:token` → `{ project: { name, customerName, status }, phases: [{ name, startDate, endDate, status: "done" | "in_progress" | "not_started" }], milestones: [{ title, date, done }], generatedAt }`. Phases are the project's sections in order (dates from their tasks' start/due; tasks without a section are not shown as a phase). Milestones are tasks with `isMilestone`.
- Unknown, expired and revoked tokens all return the same 404. Updates `lastUsedAt` at most once per hour.
- Rate-limited per IP (in-memory, e.g. 60 requests per minute). Responses send `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- **Guardrail:** the payload never contains notes (of either visibility), comments, risks, people, emails, iTop data, activity, or non-milestone task detail. A test builds a project with all of those and asserts none of their text appears in the response.

### Frontend
- A "Share" control in the project header, shown only to owners: a dialog to create a link (optional label, expiry), show the new link once with Copy, list existing links (label, created by, expiry, last used, revoked) and Revoke.
- A public page `/share/:token` outside the sign-in guard: project name and customer, phases as a simple timeline or list with dates and status, milestones, "Updated <time>". A clear "This link has expired or is no longer available" page for 404. Works in light and dark, and on a phone.
