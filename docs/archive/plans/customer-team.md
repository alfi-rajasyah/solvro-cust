# Wave D: customer team access (GitHub #93)

Status: shipped 2026-11-20 (started @ `59d3e68`)
Archive path: `docs/archive/plans/customer-team.md`

Lane: P (new model and migration, visibility change, new routes). Wave D of `docs/archive/plans/github-feature-waves.md`; ships alone.

## Decisions (user, 2026-11-19 and 2026-11-20)

- A team member gets the access a project member has, on every project linked to the customer, including projects linked later. Removing them (or deleting the customer) removes it on the next request unless another path grants it.
- A team member may edit the customer itself (the fields `customer:write` holders edit today), but is not an owner: no customer or project delete, no owner or TAM change, no change of a project's customers. Ownership checks (`ensureProjectOwnerAccess`, `ensureCustomerOwnerAccess`) never count team membership. This must not widen ISS-002.
- Who manages a team: the customer's owner (`Customer.tamId`) with `customer:write`, or any holder of the new permission `customer:team-all` (every customer, including unowned ones). Admins via `*`. Only active users can be added.
- Team membership counts as "my projects" in Daily Review.
- Assigning a task to a team member does not add them as a project member.
- A customer with no projects is visible to its team.
- `ProjectMember` stays as it is; the team is an extra access path.

## Streams

| Stream | Scope | Files |
|---|---|---|
| D1 | Model, migration, visibility, routes, Daily Review scope, notifications, assignee auto-add, tests | `backend/prisma/schema.prisma` + migration, `backend/src/lib/visibility.ts`, `backend/src/routes/customers.ts` (or a new `routes/customerTeam.ts` + `lib/customerTeam.ts`), `backend/src/lib/dailyReviewScope.ts`, `backend/src/lib/notifications.ts`, `backend/src/lib/projectMembers.ts`, `backend/src/lib/bulkTasks.ts`, tests |
| D2 | Team section on the customer page, role editor entry, help copy | `frontend/src/pages/CustomerDetail.tsx`, `frontend/src/components/customer/`, `frontend/src/lib/queries.ts`, `frontend/src/lib/auth.tsx`, `frontend/src/lib/helpContent.ts`, tests, e2e |

## API contract (D1 builds, D2 calls)

- `GET /customers/:id/team` (anyone who can see the customer): `{ members: [{ userId, username, email, active, addedAt, addedBy: { id, username } | null }], canManage: boolean }`, sorted by username.
- `POST /customers/:id/team` body `{ userId }`: 201 with the member object. 403 `forbidden` if the caller cannot manage; 404 if the caller cannot see the customer or the user does not exist; 400 `user_inactive`; 409 `already_member`.
- `DELETE /customers/:id/team/:userId`: 204; same 403/404 rules; 404 if not a member.
- Activity recorded on the customer for add and remove.

## Additions during review

- Losing access through the team path unassigns the person's tasks where they can no longer open the project (applies the 2026-09-30 member-removal decision): team member removed, project unlinked from the customer, customer deleted. Shared helpers `unassignUserTasks` / `unassignWhereAccessLost` in `lib/projectMembers.ts`.
- `GET /projects/:id/team-access` returns `{ teamAccessUserIds }`, so the assignee pickers stop claiming that assigning a team member adds them to the project.
- `customer:team-all` works on customers the holder can see (customer visibility first).
- The shared `Tabs` row scrolls sideways when it overflows.

## Review

One phase review with spine instants (`schema.prisma` + migration, `lib/visibility.ts`, `lib/queries.ts`, later `routes/projects.ts`), two fix rounds. No privilege escalation; ISS-002 not widened (recorded as broader than described). Fixed: picker without a visible label; tabs clipped at 375 px; tasks left assigned after team removal; false "adds them to the project" copy; error codes read from the wrong field; inline destructive confirm (now `ConfirmModal` danger); picker loading state; permission hint copy; a lock-order inversion in `PATCH /projects/:id` when customers are unlinked; unordered multi-project locks; activity text for team-caused unassigns. Deferred: ISS-203 (TAM change unassign).

## Delivery Gate

PASS 2026-11-20: customer Team tab in light and dark at 1440 and 375 px, remove confirmation modal, no console errors, no horizontal scroll. The five-tab case (iTop and Outline both configured) could not be shown on the dev stack; the tab row scrolls when it overflows.

## Gates

Green except the local smoke test (ISS-162 GSI origin). One earlier run hit the known `epics.test.ts` flake (ISS-156).
