# Implementation Plan: One project, several customers

**Branches:** two phases, each its own branch and PR into `develop`, cut from `origin/develop`:
`feat/project-customers-data` (Phase A), then `feat/project-customers-ui` (Phase B).
Tasks = commits. No commit or PR without explicit user approval.
**Source:** user request triage, 2026-11-03, request #4 ("link projects inside customers… 2 or more customers
can have interconnected projects"). User decisions:
- **one project shared by several customers**, with one primary;
- **anyone who can see any linked customer sees the project**;
- **Weekly Sync: one highlight per linked customer**.

**Approved design:** Doop canvas `wIbMMkOajZ`, page "07 · Request triage — Nov 2026", frames "Triage 05"
(`FwhaxaruW2`, header + edit dialog) and "Triage 06" (`7zw6MCxQrl`, customer projects list).
**Size:** L. Schema, migration, `lib/visibility.ts`, `routes/projects.ts`, `lib/queries.ts`: all spine. Every
task gets an instant review. This is the riskiest of the five requests, because it changes who can see what.

---

## 1. Model

```prisma
model ProjectCustomer {
  projectId  Int      @map("project_id")
  customerId Int      @map("customer_id")
  isPrimary  Boolean  @default(false) @map("is_primary")
  addedAt    DateTime @default(now()) @map("added_at")
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  customer   Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  @@id([projectId, customerId])
  @@index([customerId])
  @@map("project_customers")
}
// + a partial unique index (raw SQL in the migration): one isPrimary row per project.
```

`Project.customerId` is **removed** at the end of Phase A, not kept in parallel. Two sources of truth for
"the customer" would drift. Responses keep a derived `customerId` / `customer` (= the primary) for one
release, so the frontend can move over in Phase B.

**Primary vs any.** The inventory sorted every use of the customer into one of two rules:
- **Primary only** (one customer is needed):
  - breadcrumb (`lib/routeMeta.ts`)
  - guest share and embed payloads (`lib/shareLinks.ts`; an allow-list, so it exposes the primary name only)
  - portfolio and Executive rows
  - recent-notes and search labels
  - project activity snapshot
  - Admin project list
  - `RightSidebar` account card
  - Services tab
  - **default** org for new iTop tickets
- **Any linked customer** (the project belongs to each):
  - visibility (both arms)
  - `canUserSeeProject` parity
  - Daily Review scope and grouping
  - nav badges
  - customer list counts and health
  - customer detail project list
  - `/projects?customerId`, `/tasks?customerId`
  - the "claim an unowned customer" rule
  - owner checks (`ensureProjectOwnerAccess` / `canOwnProject`: any linked customer's owner)
- **Unchanged:** iTop ticket and time snapshots (keyed by org), Outline (project's own `outlineUrl`), Gantt exports (no customer field), WeeklyUpdate schema.

## 2. Decisions applied

1. **Visibility: any linked customer.** In `projectVisibilityFilter`, `{ customer: { tamId } }` becomes `{ customers: { some: { customer: { tamId: user.sub } } } }`. `customerVisibilityFilter`'s "has a visible project" arm goes through the join. `canUserSeeProject` gets `customerTamIds: Set<number>`, and the notification fact loader loads every link. **The parity test in `test/notifications.test.ts` must cover a shared project**, since this is the rule backend/CLAUDE.md says must stay in sync.
2. **Weekly Sync: one per customer.** No schema change. Daily Review lists the shared project under **each** linked customer in scope, and `weeklyDraft.ts` drafts from each customer's `projects[].notes`, so every customer gets its own highlight row, editable separately. A test locks this in.
3. **Customer delete** (user confirmed 2026-11-03): the link cascades away.
   - If the deleted customer was primary, the oldest remaining link (`addedAt`) becomes primary.
   - If no link remains, the project is unlinked, as today's `SetNull` leaves it.
   - The delete confirmation (`CustomerDetail.tsx`) names the shared projects that will lose this customer.
4. **Ownership: the owner of ANY linked customer** (user decision 2026-11-03, after the Phase A review). The project's TAM and the owner of any linked customer can each:
   - delete the project;
   - change its TAM;
   - change its customer links, including removing the primary;
   - mint guest links.

   `ensureProjectOwnerAccess` keeps matching any link.
5. **Changing links is owner-only.** Adding or removing a customer, or changing the primary, uses `ensureProjectOwnerAccess` (members can't), the same as today's customer change. Each added customer must pass `isCustomerVisible` (400 `customer_not_found`).
6. **Activity:** the project log records the link set as a sorted name list, so "added Telkomsel Enterprise" is visible. `CustomerActivityEvent` on project delete writes **one row per linked customer**, so each customer's feed shows it.

## 3. Phase A: data, visibility, API

### A1: Schema and migration
- Create `project_customers`. Backfill one `isPrimary` row per project with a non-null `customer_id`, add the partial unique index, then drop `projects.customer_id`.

### A2: Visibility
- Update `lib/visibility.ts` (both filters + `canUserSeeProject`) and `lib/notifications.ts`.
- New tests in `customerVisibility`, `projectVisibility` and `crossUserAccess`:
  - a secondary customer's TAM sees the project;
  - a user who sees neither customer doesn't;
  - a member still does.

### A3: Projects and customers routes
- **`routes/projects.ts`:**
  - Create and update take `customers: [{ id, isPrimary }]`: at least one, exactly one primary.
  - Detail and list return `customers[]` + `primaryCustomer` (+ the legacy `customerId`).
  - The list filter is `customers.some`.
  - Update diffs the link set inside the owner-only check.
- **`routes/customers.ts`:** list counts are multi-valued (`customerOfProject` becomes a map to many). The detail include goes through the join with `isPrimary` + `isShared`. Rework the claim rule and the delete promotion.
- **`routes/tasks.ts`** `?customerId`, `routes/admin.ts`, `lib/portfolio.ts`, `routes/notes.ts`, `routes/search.ts` and `lib/shareLinks.ts`: switch to the primary or the link set, as tabled in §1.

### A4: Daily Review and badges
- `lib/dailyReviewScope.ts`: the arms move to `customers.some` / `customers.none`, and return linked ids.
- `routes/dailyReview.ts`: the project appears in each in-scope customer group; "unassigned" = no links.
- `routes/overview.ts` badges add every linked customer.

### A5: Seeds and tests
- `e2e/fixtures/seed.ts` and `scripts/seed-demo.ts` add one shared demo project, "DC2 Interconnect": PT Bank Sinar primary + Telkomsel Enterprise.
- Update the ~19 backend test files that build a project with `customerId` (listed in the inventory).

**Acceptance:**
- Full backend suite green.
- The new shared-project tests pass.
- With no shared projects, every existing screen behaves exactly as before.

## 4. Phase B: UI ("Triage 05", "Triage 06")
- **`ProjectFormModal`:** a customer list with a primary radio, "Add customer…", and remove (×). At least one customer is still required.
- **Project header (`ProjectHeaderFacts`):** "Customers" shows the primary + a "Primary" chip, then the others.
- **`CustomerDetail` projects list:** a shared project shows the "Shared · primary: X" tag.
- **`Projects` page card:** the primary, plus "+N".
- **iTop "Create in iTop"** (`TaskTicketField`, and the row menu from `subtask-itop-tickets.md`): when the project has more than one iTop-mapped customer, the sheet gets an Organisation picker that defaults to the primary.
- **`lib/queries.ts`:** types move to `customers[]` and `primaryCustomer`. Drop the legacy `customerId` from responses in this phase's last commit.

## 5. Risks
- **Visibility widening is the point, so it must be exact.** The reviewer checks that no route re-derives customer scoping ad hoc; everything goes through `lib/visibility.ts`.
- **`excludeFromPortfolio`** containers: a shared project still counts **once** in portfolio roll-ups (`computePortfolioRows` dedupes by project id). There's a test for it.
- **Migration on a live database:** backfill and drop run in one migration. Run it on staging first, and check one project per customer still lists correctly.

## 6. Verification
- Each phase: full `gates.sh` + instant spine reviews.
- Phase A manual check: log in as Telkomsel's TAM and see "DC2 Interconnect" on Projects, Customer detail, Daily Review and Overview; log in as a TAM of neither customer and get a 404 on its URL.

## 7. CHANGELOG (drafts)
- **Phase A:** Changed: a project can belong to several customers, with one primary. Anyone who can see any of its customers can see it, and it appears in each customer's Daily Review and Weekly Sync. The primary customer is used for breadcrumbs, guest share pages and portfolio rows.
- **Phase B:** Added: the project form can link several customers and choose the primary. Shared projects are tagged on customer pages, and creating an iTop ticket on a shared project lets you pick the organisation.
