# Plan: Request triage — Nov 2026

**Spec:** [`request-triage-spec.md`](request-triage-spec.md).
Task-level detail lives in each module plan (linked per phase below). This file is the order, the
dependencies, and the checkpoints.

## Dependency graph

```
subtask-assignee ──→ overview-person-filters        (assignee filter counts subtasks)
subtask-itop-tickets ──→ multi-customer-projects B  (org picker extends its create flow)
custom-task-statuses A ──→ custom-task-statuses B
multi-customer-projects A ──→ multi-customer-projects B
```

**File overlap forces sequencing, not parallel waves.** `subtask-assignee`, `subtask-itop-tickets` and
`custom-task-statuses` B all edit `ProjectList.tsx` and `TaskPanel.tsx`. Both A phases edit `schema.prisma`,
`routes/projects.ts` and `queries.ts`.

## Phases

Each phase is one branch and one PR into `develop`. Tasks are commits. Every commit and PR waits for your approval.

| # | Phase (branch) | Module | Size | Spine (instant review) | Detail |
|---|---|---|---|---|---|
| 1 | `feat/subtask-assignee-rows` | `subtask-assignee` | S | none | [plan](subtask-assignee-rows.md) |
| 2 | `feat/overview-person-filters` | `overview-person-filters` | M | `queries.ts` | [plan](overview-person-filters.md) |
| 3 | `feat/subtask-itop-tickets` | `subtask-itop-tickets` | S–M | `queries.ts` | [plan](subtask-itop-tickets.md) |
| 4 | `feat/task-status-defs` | `custom-task-statuses` A | L | schema, `tasks.ts`, `projects.ts`, `queries.ts` | [plan §2](custom-task-statuses.md) |
| 5 | `feat/task-status-ui` | `custom-task-statuses` B | L | `kanban-v2/`, `gantt-v2/`, `queries.ts` | [plan §3](custom-task-statuses.md) |
| 6 | `feat/project-customers-data` | `multi-customer-projects` A | L | schema, `visibility.ts`, `projects.ts`, `queries.ts` | [plan §3](multi-customer-projects.md) |
| 7 | `feat/project-customers-ui` | `multi-customer-projects` B | M | `queries.ts` | [plan §4](multi-customer-projects.md) |
| 8 | `feat/customer-view-all` | `customer-view-all` | S | `visibility.ts` | Phase 8 below |

## Tasks

### Phase 1: `subtask-assignee`
- [ ] **1.1 Owner column on List subtask rows**
  - Acceptance: avatar in the Owner column; change persists with optimistic rollback; a non-member gets the "(not on project)" hint.
  - Verify: frontend typecheck; e2e project-list assign.
  - Files: `pages/views/ProjectList.tsx`.
- [ ] **1.2 Avatar and picker on the panel's subtask rows**
  - Acceptance: every subtask row shows its assignee; a change syncs with the subtask's own panel.
  - Verify: typecheck; e2e.
  - Files: `components/TaskPanel.tsx`.
- [ ] **1.3 Assignee on the panel's "Add subtask"**
  - Acceptance: created already assigned, in one request.
  - Verify: typecheck; e2e.
  - Files: `components/TaskPanel.tsx`.
- **Checkpoint:** `gates.sh` green, phase review, 375px manual pass → PR.

### Phase 2: `overview-person-filters`
- [ ] **2.1 `GET /overview` gains `tamId`, `assigneeId` and `people`**
  - Acceptance: the filter matrix holds, subtasks are counted only under the assignee filter, and there's no scope leak.
  - Verify: `overviewWorkCounts` tests.
  - Files: `routes/overview.ts`, `test/overviewWorkCounts.test.ts`.
- [ ] **2.2 `GET /tasks` gains `tamId`, and includes subtasks when `assignedToId` is set**
  - Acceptance: the list count equals the tile count.
  - Verify: `tasksFilters` tests.
  - Files: `routes/tasks.ts`, `test/tasksFilters.test.ts`.
- [ ] **2.3 Pickers, URL state and hints on the Overview; notes narrowed**
  - Acceptance: matches Triage 07, and survives a reload.
  - Verify: typecheck; e2e overview.
  - Files: `pages/Overview.tsx`, `lib/queries.ts`.
- [ ] **2.4 `/tasks` reads `tamId`/`assigneeId` with a removable chip; tiles link with the filter**
  - Acceptance: tile → list count match.
  - Verify: e2e.
  - Files: `pages/Tasks.tsx`, `pages/Overview.tsx`.
- **Checkpoint:** instant review (`queries.ts`), `gates.sh`, phase review → PR.

### Phase 3: `subtask-itop-tickets`
- [ ] **3.0 `useCanCreateItopTicket` returning `{canCreate, reason}`, plus the hint in `TaskTicketField`**
  - Acceptance: each failing precondition shows its reason; all passing shows the button.
  - Verify: hook unit test.
  - Files: `components/itop/useCanCreateItopTicket.ts`, `TaskTicketField.tsx`.
- [ ] **3.1 `GET /itop/tickets/by-refs`, read-only and snapshot-only**
  - Acceptance: visible / hidden / unknown / over-limit cases.
  - Verify: backend test.
  - Files: `routes/itop.ts`, `test/itop/*.test.ts`.
- [ ] **3.2 Ticket column on List rows**
  - Acceptance: matches Triage 01; omitted when iTop isn't configured.
  - Verify: typecheck; e2e (mocked iTop).
  - Files: `ProjectList.tsx`, `lib/queries.ts`.
- [ ] **3.3 Row menu "Pin existing…" / "Create iTop ticket…" on task and subtask rows**
  - Acceptance: the ref pins to the clicked row; 202 handling.
  - Verify: e2e stubbed create.
  - Files: `ProjectList.tsx`, `TaskPanel.tsx`.
- [ ] **3.4 Subtask context line in the prefill; personal-token banner in `NewTicketSheet`**
  - Verify: typecheck.
  - Files: `NewTicketSheet.tsx`, callers.
- **Checkpoint:** guardrail check (no app-token write, no new `client.create`), `gates.sh`, phase review → PR.

### Phase 4: `custom-task-statuses` A (no visible change)
- [ ] **4.1 Schema + migration**
  - Acceptance: three defs seeded with today's labels, `statusId` backfilled and NOT NULL, WIP keys rewritten.
  - Verify: migrate on a scratch DB; tests.
  - Files: `schema.prisma`, migration.
- [ ] **4.2 Task writes and reads**
  - Acceptance: `statusId` accepted; legacy `status` maps to the default def; category kept in sync; `?statusId=` filter; stale-write compare.
  - Verify: `taskStaleWrite`, `tasksFilters` + new tests.
  - Files: `routes/tasks.ts`, `routes/projects.ts`, `lib/duplicate.ts`.
- [ ] **4.3 Activity logs def names; payloads carry `statusDef`**
  - Verify: `activity` tests.
  - Files: `lib/activity.ts`, `routes/dailyReview.ts`, `routes/search.ts`.
- [ ] **4.4 `GET /task-statuses`, `PUT /admin/task-statuses`**
  - Acceptance: category minimums, one default each, delete needs `moveTo`.
  - Verify: new tests.
  - Files: new route, `routes/admin.ts`.
- [ ] **4.5 Seeds + fixture updates**
  - Files: `scripts/seed-demo.ts`, `e2e/fixtures/seed.ts`.
- **Checkpoint:** instant review per task (spine); full suites green with no UI diff; staging migration dry run → PR.

### Phase 5: `custom-task-statuses` B
- [ ] **5.1 Admin → Task statuses tab** (Triage 03). Files: `pages/Admin.tsx`, new editor component.
- [ ] **5.2 `StatusSelect` replacing every `STATUSES` array; `TaskStatusChip` shows the def**
  - Files: `TaskPanel`, `TaskFormModal`, `ProjectList`, `ProjectTimeline`, `daily-review/ProjectCard`, `Tasks`, `StatusChip`.
- [ ] **5.3 Kanban columns per def, category band, per-def WIP**
  - Verify: `commitMapper`/`adapter` tests; `kanban-dnd.spec.ts`.
  - Files: `kanban-v2/*`, `ProjectFormModal`.
- [ ] **5.4 Gantt tree cell, embed list, Tasks sort**
  - Verify: exports guardrail check (no new fields).
  - Files: `gantt-v2/TreeCells.tsx`, `EmbedTasks.tsx`, `Tasks.tsx`.
- **Checkpoint:** manual rename/add pass across all surfaces, `gates.sh`, phase review → PR.

### Phase 6: `multi-customer-projects` A
- [ ] **6.1 `project_customers` + backfill + drop `projects.customer_id`** (ask first, confirm on staging). Files: `schema.prisma`, migration.
- [ ] **6.2 Visibility arms + `canUserSeeProject` + notification facts**
  - Verify: parity test incl. a shared project.
  - Files: `lib/visibility.ts`, `lib/notifications.ts`.
- [ ] **6.3 Projects routes**
  - Scope: `customers[]` body, link-set diff, owner-only.
  - Files: `routes/projects.ts`, `lib/activity.ts`.
- [ ] **6.4 Customers routes**
  - Scope: multi-valued counts, claim rule, delete promotion.
  - Files: `routes/customers.ts`.
- [ ] **6.5 Daily Review scope + grouping, badges**
  - Files: `lib/dailyReviewScope.ts`, `routes/dailyReview.ts`, `routes/overview.ts`.
- [ ] **6.6 Primary-only consumers**
  - Files: `lib/portfolio.ts`, `routes/notes.ts`, `routes/search.ts`, `lib/shareLinks.ts`, `routes/admin.ts`, `routes/tasks.ts`.
- [ ] **6.7 Seeds + ~19 test files.** Add the shared "DC2 Interconnect" demo project.
- **Checkpoint:** instant review per task; Telkomsel-TAM manual pass; staging migration → PR.

### Phase 7: `multi-customer-projects` B
- [ ] **7.1 `ProjectFormModal` customer list with a primary radio** (Triage 05)
- [ ] **7.2 Header facts, Projects card "+N", CustomerDetail "Shared" tag** (Triage 06)
- [ ] **7.3 Organisation picker in "Create in iTop" when the project has 2+ mapped customers**
- [ ] **7.4 `queries.ts` types moved to `customers[]`; legacy `customerId` dropped from responses**
- **Checkpoint:** `gates.sh`, phase review → PR.

### Phase 8: `customer-view-all` (independent, small, can ship any time)
User request 2026-11-03: "view all customers for all roles or just a permission". Chosen: a **permission**,
`customer:view-all`. Granting it to every role in Admin → Roles gives "all roles". This changes the
2026-08-31 decision in `customer-visibility-spec.md` §3 #3 ("no new permission"), at the user's request.
- [ ] **8.1 `customerVisibilityFilter` / `isCustomerVisible` return `{}` for `customer:view-all`**
  - Acceptance:
    - a holder sees every customer on Customers, customer detail, search and the project form's customer select;
    - **projects stay gated**: customer detail still lists only projects the holder can see;
    - **owner rules unchanged**: `ensureCustomerOwnerAccess` and the PATCH-owner rule must NOT treat `customer:view-all` as ownership (the owner check calls `customerVisibilityFilter` with `viaMembership: false`, so it needs an explicit exclusion);
    - Daily Review scope unchanged (it keys on `project:view-all`).
  - Verify: tests in `customerVisibility.test.ts`. The holder sees all; can't delete or reassign another TAM's customer; gets no extra project.
  - Files: `lib/visibility.ts` (spine), test.
- [ ] **8.2 Add to `PERMISSION_CATALOG`**
  - Label "See all customers"; hint: "See every customer and its notes and weekly updates. Projects stay limited to your own."
  - Files: `frontend/src/lib/auth.tsx`.
- [x] **8.3 Built-in roles** (user, 2026-11-03): `customer:view-all` is not granted automatically. Admins tick it.
- [ ] **8.4 Customer permissions mirror project permissions** (user, 2026-11-03: "treat Customers = Workspace")

  | Permission | Label | Gates |
  |---|---|---|
  | `customer:read` | View customers | Customer reads: list, detail, operations notes, weekly updates, services, a customer's iTop ticket/contact reads |
  | `customer:write` | Manage customers | Customer writes: create, edit details, notes, weekly updates, services, and iTop ticket create *for a customer* |
  | `customer:view-all` | See all customers | Visibility of every customer |

  - These replace the `project:read` / `project:write` gates on customer routes.
  - `customer:view-all` + `customer:write` = edit every customer, the same way `project:view-all` + `project:write` works for projects.
  - **Delete and change-owner stay owner-only** (`ensureCustomerOwnerAccess`, `ownership: true`).
  - **Data migration**, no schema change: every role holding `project:read` also gets `customer:read`, and `project:write` also gets `customer:write`. `*` is untouched. `builtInRoles.ts` gets the same, so nothing changes for anyone until an admin edits a role.
  - **Frontend:**
    - `PERMISSION_CATALOG` gains the three entries;
    - the Customers nav entry and route need `customer:read`;
    - write controls are hidden without `customer:write`;
    - the project form's customer picker shows a notice when the user lacks `customer:read`.
  - Verify:
    - route gate tests (read without `customer:read` → 403, write without `customer:write` → 403);
    - migration test (a role with project perms gains customer perms);
    - existing customer tests green.
- **Checkpoint:** instant review (`visibility.ts`), `gates.sh` → PR.

## Risks

| Risk | Mitigation |
|---|---|
| A visibility regression in Phase 6 exposes projects | Parity test; reviewer checks nothing re-derives scope; manual two-user pass |
| Status migration breaks the Kanban drag tests | Phase 4 ships with no UI change; Kanban rework isolated to Phase 5 |
| Live-data migrations (Phases 4 and 6) | Staging dry run first; single-transaction migrations; no destructive drop without a backfill check |
| iTop create rejected by install-specific required fields | Open question 2, resolved before 3.3 |
| Concurrent `tsc` thrash in waves | Phases run sequentially; per-task typechecks serialized |
