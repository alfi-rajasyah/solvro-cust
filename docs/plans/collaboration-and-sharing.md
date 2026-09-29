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
