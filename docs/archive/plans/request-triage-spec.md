# Spec: Request triage — Nov 2026 (five capabilities)

**Status:** shipped — PRs #54, #55, #56 (merged into develop, 2026-11-04) · **Date:** 2026-11-03 · **Owner:** alfi-rajasyah
**Approved designs:** Doop canvas `wIbMMkOajZ`, page "07 · Request triage — Nov 2026" (frames Triage 00–07).
**Detailed module plans:**
- [`subtask-assignee-rows.md`](subtask-assignee-rows.md)
- [`overview-person-filters.md`](overview-person-filters.md)
- [`subtask-itop-tickets.md`](subtask-itop-tickets.md)
- [`custom-task-statuses.md`](custom-task-statuses.md)
- [`multi-customer-projects.md`](multi-customer-projects.md)

**Build order:** [`request-triage-plan.md`](request-triage-plan.md).

## Objective

TAMs run delivery in Solvro. Five requests from the 2026-11-03 triage close gaps that today force them to open
every subtask, leave the app to file tickets, live with three fixed statuses, and duplicate projects that
span customers.

| Module id | User story | Decisions already made |
|---|---|---|
| `subtask-assignee` | As a TAM, I see and change who owns each subtask from the list, without opening it. | Frontend only; reuses the existing assignee picker and membership rule. |
| `overview-person-filters` | As a TAM, I narrow the Overview to one person's work or one TAM's projects. | Two independent pickers, TAM and Assignee; state in the URL. |
| `subtask-itop-tickets` | As a TAM, I see each task's and subtask's iTop ticket on the row, and create one from the row; when I can't, I'm told why. | Reuse `POST /itop/tickets` + `NewTicketSheet`; personal token only. |
| `custom-task-statuses` | As an admin, I define the workspace's statuses (Backlog, Development, QA/UAT…), each in one of 3 categories. | One workspace list; the enum stays as the category; Epics stay on categories. |
| `multi-customer-projects` | As a TAM, one project can belong to several customers, with one primary. | Visible to anyone who can see any linked customer; Weekly Sync one highlight per customer. |
| `customer-view-all` | As a TAM (or any role an admin chooses), I can see every customer, not just mine. | New permission `customer:view-all`; projects stay gated; no ownership rights. |

## Tech stack (existing, no new dependencies)

- **Backend:** Express + Prisma + PostgreSQL 15, Zod validation, pino. Conventions: `backend/CLAUDE.md`.
- **Frontend:** React + Vite + Tailwind v4 (CSS-first `@theme inline`), TanStack Query, Base-UI primitives, vendored ReUI (`components/reui/`). Conventions: `frontend/CLAUDE.md`.
- **Tests:** vitest (backend, isolated `solvro_test` DB; frontend unit), Playwright (`e2e/`, desktop + mobile).
- **No new npm packages.** Drag-and-drop uses only the sanctioned dnd-kit packages and the vendored ReUI Sortable/Kanban.

## Commands

```bash
docker compose up -d                                   # app :5173 · API :3000/health
docker compose exec backend  npx tsc --noEmit          # backend typecheck
docker compose exec frontend npm run typecheck         # frontend typecheck (never two at once)
TEST_URL=$(docker compose exec backend printenv DATABASE_URL | tr -d '\r\n' | sed 's|/solvro?|/solvro_test?|') \
  && docker compose exec -e DATABASE_URL="$TEST_URL" backend npm test   # backend vitest, isolated DB
cd e2e && npm test                                     # Playwright, desktop + mobile
docker compose exec -it backend npx prisma migrate dev --name <slug>   # schema changes (-it required)
.claude/scripts/gates.sh                               # full gates: orchestrator only, serial, once per wave
```

## Project structure (where each module lands)

```
backend/prisma/schema.prisma        → TaskStatusDef, Task.statusId, ProjectCustomer        (spine)
backend/src/lib/visibility.ts       → multi-customer visibility arms + canUserSeeProject   (spine)
backend/src/routes/overview.ts      → tamId / assigneeId filters, people lists
backend/src/routes/tasks.ts         → statusId writes, tamId filter                        (spine)
backend/src/routes/projects.ts      → customers[] body, wipLimits by def id                (spine)
backend/src/routes/itop.ts          → GET /itop/tickets/by-refs (read-only)
backend/src/routes/admin.ts         → PUT /admin/task-statuses                             (spine)
backend/test/*.test.ts              → backend tests (one file per concern, existing names)
frontend/src/lib/queries.ts         → hooks + types for all five                           (spine)
frontend/src/pages/views/ProjectList.tsx, components/TaskPanel.tsx → subtask rows, Ticket column
frontend/src/components/itop/       → useCanCreateItopTicket, hint, NewTicketSheet reuse
frontend/src/components/kanban-v2/  → status-def columns                                   (spine)
frontend/src/pages/Overview.tsx, Tasks.tsx, Admin.tsx, CustomerDetail.tsx, ProjectFormModal.tsx
e2e/tests/*.spec.ts                 → e2e per surface
docs/plans/                         → this spec, the plan, module plans → docs/archive/plans/ when shipped
CHANGELOG.md                        → one [Unreleased] entry per change, orchestrator-appended
```

## Code style

Follow the area CLAUDE.md files. The pattern every new route follows is: Zod schema at the top, `validate()`,
scope through `lib/visibility.ts` AND-composed (never spread), and `HttpError` for refusals. A real excerpt
(`backend/src/routes/overview.ts`), extended the way `overview-person-filters` will extend it:

```ts
const overviewQuerySchema = z.object({
  today: z.string().refine(isValidDayString, { message: "today must be a valid yyyy-MM-dd date" }).optional(),
  tamId: z.coerce.number().int().positive().optional(),
  assigneeId: z.coerce.number().int().positive().optional(),
});

overviewRouter.get("/", validate("query", overviewQuerySchema), async (req, res) => {
  const { today, tamId, assigneeId } = req.query as unknown as z.infer<typeof overviewQuerySchema>;
  const scope: Prisma.ProjectWhereInput = {
    AND: [
      projectVisibilityFilter(req.user!),          // only top-level key is OR — never spread it
      { excludeFromPortfolio: false },
      ...(tamId ? [{ tamId }] : []),
      ...(assigneeId ? [{ tasks: { some: { assignedToId: assigneeId, status: { not: "DONE" } } } }] : []),
    ],
  };
  // …
});
```

Rules for the frontend:
- All server calls go through `apiRequest` and hooks in `lib/queries.ts`.
- Inline edits use the optimistic pattern (`onMutate` snapshot, `onError` rollback, `onSettled` invalidate).
- Display words come from `lib/labels.ts`, dates from `lib/formatDate.ts`, colours from `index.css` tokens. No raw hex.
- Mark vendored edits `// SOLVRO PATCH`.
- `StatusChip` / `TaskStatusChip` stay bespoke; never rebase them onto `reui/badge`.
- Text is never below 12px. Mobile works at 375px.

## Testing strategy

| Level | Where | What each module must add |
|---|---|---|
| Backend unit/integration | `backend/test/*.test.ts` (vitest, `solvro_test`) | `overview-person-filters`: filter matrix + scope leak test. `subtask-itop-tickets`: by-refs visible/hidden/unknown/limit. `custom-task-statuses`: legacy-status mapping, category sync, def delete/moveTo, WIP key migration, activity same-category move. `multi-customer-projects`: secondary-customer visibility, `canUserSeeProject` parity, Daily Review grouping, portfolio dedupe, customer-delete promotion. |
| Frontend unit | colocated `*.test.ts` | `useCanCreateItopTicket` reason ordering; kanban `adapter`/`commitMapper` per def; status picker grouping. |
| e2e | `e2e/tests/*.spec.ts` | Subtask assign from row + panel; Overview filter → tile → `/tasks` count match; iTop ref chip + create (stubbed); Kanban drag between custom statuses; shared project visible to the secondary customer's TAM. |
| Gates | `.claude/scripts/gates.sh` | Typechecks, vitest, Playwright smoke, CHANGELOG presence, guardrail greps, spine check. Once per wave and at phase close. |

**Coverage bar:** every new branch in a route has a test. Existing tests are updated only where the schema change
requires it, never deleted or skipped. The inventories list which tests must change: `taskStaleWrite`,
`projectWipLimits`, `activity`, `commitMapper.test.ts`, `kanban-dnd.spec.ts`, plus the ~19 files that build
projects with `customerId`.

## Boundaries

- **Always**
  - Work on a branch off up-to-date `origin/develop`; one phase = one branch = one PR into `develop`.
  - Scope every query through `lib/visibility.ts`; filtering never widens visibility.
  - Run scoped checks per task, and full `gates.sh` per wave.
  - Add a CHANGELOG entry for every code change.
  - Get an instant review on spine files.
  - Keep `Task.status` equal to its def's category on every write.
- **Ask first**
  - Any schema or migration change beyond what this spec lists.
  - Dropping `Project.customerId` (planned in `multi-customer-projects` A1; confirm on staging first).
  - Any new permission.
  - Any change to guest share or embed payloads beyond swapping in the primary customer's name.
  - Anything that changes export output.
- **Never**
  - Use the iTop application token for a write.
  - Add an npm Gantt, board or drag library.
  - Let INTERNAL notes reach an export.
  - Delete `Tasks.tsx` or `/tasks`.
  - Rebuild the Pipeline module.
  - Commit or open a PR without explicit approval.
  - Add AI attribution to commits or PRs.
  - Spread a visibility filter into a sibling `OR`.

## Success criteria

1. **`subtask-assignee`:** every subtask row in List and Task panel shows its assignee and can change it. "Add subtask" in the panel can assign at creation. Assigning a non-member adds them to the project.
2. **`overview-person-filters`:**
   - `/overview?assigneeId=Y` tiles equal the row count of the `/tasks` list each tile opens.
   - A TAM without `project:view-all` passing another TAM's id sees nothing outside their own scope.
   - The filter survives a reload.
3. **`subtask-itop-tickets`:**
   - With any create precondition failing, the panel names the failing one and where to fix it.
   - With all passing, "Create iTop ticket…" on a subtask row creates the ticket under the user's personal token and pins it to that subtask.
   - The List shows refs with status for all rows, in one request.
4. **`custom-task-statuses`:**
   - After Phase A, the UI is unchanged and all suites pass.
   - After Phase B, an admin can rename "To do" → "Backlog" and add "QA / UAT" (Active); Kanban shows one column per status; every status picker is grouped by category.
   - Overdue, progress and exports behave exactly as before.
5. **`multi-customer-projects`:**
   - A project linked to PT Bank Sinar (primary) + Telkomsel Enterprise appears for Telkomsel's TAM on Projects, Customer detail, Daily Review and Overview, and gets one Weekly Sync row per customer.
   - A user who sees neither customer gets 404.
   - Guest share shows the primary customer only.

## Open questions

1. **Why "Create in iTop" is hidden on solvro-dev.** The user can't see it on tasks or subtasks. Check, as admin-2:
   - Admin → iTop → "Actions from Solvro" switch;
   - Settings → iTop personal token;
   - Admin → iTop → "Customers and iTop organisations", the row for Klinik Sehat Bersama.

   `subtask-itop-tickets` Task 0 makes the app show this reason itself.
2. **Ticket fields iTop may demand.** Not blocking. Once creation is enabled, one test ticket shows whether this iTop install refuses a ticket without extra fields (e.g. service). Handle it then.

**Resolved:**
- Customer delete (2026-11-03, user confirmed): the oldest remaining link is promoted to primary; with no links left, the project is unlinked.
- The Doop index frame (Triage 00): its text about #1 is out of date. Left as approved; this spec is the source of truth.
