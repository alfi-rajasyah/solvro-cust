# Implementation Plan: TAM-Defined Services (Shared Catalogue + Per-Project Scoping)

**Orchestration model:** Fable (this session) is the orchestrator — it runs preflight, dispatches each task to a **Sonnet implementor agent** (`Agent` tool, `model: sonnet`), verifies every task's acceptance criteria itself before marking it done, and runs the checkpoints. Sonnet agents never self-certify.

## Overview

Replace the admin-gated service catalogue flow with a TAM-driven one, at two levels:

- **Customer level** (kept): subscription mapping stays on `CustomerDetail.tsx` Services tab.
- **Project level** (new): each project gets a Services tab scoping which services are in play for that engagement (can include extras beyond the customer's subscriptions).
- **Catalogue** (kept, un-gated): the shared `Service` table remains for name consistency, but any TAM (`project:write`) can create/curate entries — inline from the pickers, with management relocated from Admin to Settings.
- **Start fresh** (user-approved destructive step): existing `customer_services` and `services` rows are deleted.

Decisions confirmed with the user: both levels · shared TAM-extendable catalogue · retire Admin tab + start fresh.

## Architecture Decisions

- **`ProjectService` mirrors `CustomerService` exactly** — `(projectId, serviceId, tools[])`, `@@unique([projectId, serviceId])`, cascade both FKs. Same full-replace `PUT` transaction pattern as `backend/src/routes/customers.ts:70-107`. No new invention.
- **Auth**: service writes move `requireAdmin` → `requirePermission("project:write")` (`backend/src/routes/services.ts`). Project-service PUT gated `project:write` + the same project-scoping guard other project sub-writes use in `projects.ts`.
- **One shared UI component**: extract `ServiceMappingList` (+ `ToolsEditor`) from `CustomerDetail.tsx:575-820` into `frontend/src/components/services/`, parameterized so both customer and project tabs use it. Inline "add service" form creates catalogue rows on the fly (`useCreateService`) and auto-assigns them.
- **Subscribed badges** on the project tab come from the existing `useCustomer(project.customerId)` hook (cache-shared with customer pages) — zero backend payload changes for badges.
- **Catalogue management relocates to Settings** as an extracted `ServiceCatalogueManager` component (moved from `Admin.tsx` `ServicesTab`, lines 1306+), UI-gated by `hasPermission(user, "project:write")`.
- **Data reset lives in the migration** (`DELETE FROM customer_services; DELETE FROM services;`) so every environment converges.
- **Commits**: one per task, on a feature branch `feat/project-services` off freshly-pulled `develop`. **No Claude co-author trailers** (standing user preference). CHANGELOG.md entry appended **within each task**, not batched at the end (repo mandate).

## Dependency Graph

```
Phase 0: git pull develop (remote is AHEAD: bd9f7d7 vs local d8e6d5d — schema.prisma & queries.ts changed upstream)
    │
Task 1.1 schema: ProjectService + data reset ──┐
Task 1.2 services.ts perm swap (independent) ──┤
    │                                          │
Task 1.3 projects.ts: PUT /:id/services + include ◄─ needs 1.1
    │
Task 2.1 queries.ts: types + useUpdateProjectServices ◄─ needs 1.3 (API shape)
Task 2.2 extract ServiceMappingList + inline add (customer refit) ◄─ needs 1.2 (TAM create perm)
    │
Task 3.1 Project Services tab (route + tab + badges + add-all) ◄─ needs 2.1 + 2.2
    │
Task 4.1 relocate catalogue mgmt to Settings, retire Admin tab ◄─ needs 1.2
    │
Phase 5: review agents + final QA
```

Parallel-safe pairs: **1.1 ∥ 1.2** (different files); **4.1** can run any time after 1.2 but is scheduled last to avoid `Admin.tsx`/`Settings.tsx` churn during review.

---

## Phase 0: Sync & Preflight — *Orchestrator (Fable), not delegated*

**Description:** Get the tree current and the stack running before any edit.

**Steps:**
1. `git fetch` + fast-forward `develop` to `origin/develop` (`bd9f7d7`). Verify services-area files are untouched upstream (already confirmed via GitHub compare: only `schema.prisma` + `queries.ts` changed, for task ordering/WIP limits — no Service model changes).
2. Create branch `feat/project-services`.
3. `docker compose up -d`, wait for `http://localhost:3000/health`, run any pending migrations, `npx tsc --noEmit` in backend + `npm run typecheck` in frontend as a clean baseline.

**Acceptance criteria:**
- [ ] Local `develop` == `origin/develop`; working branch created
- [ ] Stack healthy; both typechecks pass pre-change

---

## Phase 1: Backend Vertical

### Task 1.1: Prisma schema — `ProjectService` + start-fresh reset
**Implementor:** Sonnet · **Size:** S · **Dependencies:** Phase 0

**Description:** Add `ProjectService` join model mirroring `CustomerService` (`schema.prisma:170-183`): `projectId → Project` (Cascade), `serviceId → Service` (Cascade), `tools String[] @default([])`, `createdAt`, `@@unique([projectId, serviceId])`, indexes on both FKs, `@@map("project_services")` + snake_case column maps. Add back-relations `services ProjectService[]` on `Project` and `projects ProjectService[]` on `Service`. Migration name: `add_project_services`. Append `DELETE FROM "customer_services"; DELETE FROM "services";` to the generated migration SQL (user-approved start-fresh).

**Acceptance criteria:**
- [ ] Migration applies cleanly on the dev DB; `prisma generate` succeeds
- [ ] `customer_services` and `services` tables are empty afterward
- [ ] CHANGELOG.md entry appended (Added: ProjectService model; Changed: destructive data reset noted)

**Verification:** `docker compose exec -it backend npx prisma migrate dev --name add_project_services` (or the non-interactive `migrate diff` path in CLAUDE.md), then `docker compose exec backend npx tsc --noEmit`; `SELECT count(*)` on both tables = 0.

**Files:** `backend/prisma/schema.prisma`, new `backend/prisma/migrations/*_add_project_services/migration.sql`, `CHANGELOG.md`

### Task 1.2: Open catalogue writes to TAMs
**Implementor:** Sonnet · **Size:** XS · **Dependencies:** Phase 0 (parallel-safe with 1.1)

**Description:** In `backend/src/routes/services.ts`, replace `requireAdmin` with `requirePermission("project:write")` on `POST /`, `PATCH /:id`, `DELETE /:id`. `GET /` unchanged. Import from `../http/auth.js` as customers.ts does.

**Acceptance criteria:**
- [ ] A `project:write` (non-wildcard) user can create/update/delete services; read-only role gets 403
- [ ] CHANGELOG.md entry appended

**Verification:** backend `tsc --noEmit`; curl: POST `/services` with a TAM token → 201; with a STAKEHOLDER token → 403 (orchestrator provisions test users via `/admin` API if needed).

**Files:** `backend/src/routes/services.ts`, `CHANGELOG.md`

### Task 1.3: `PUT /projects/:id/services` + detail include
**Implementor:** Sonnet · **Size:** M · **Dependencies:** 1.1

**Description:** In `backend/src/routes/projects.ts`: (a) add `PUT /:id/services` gated `requirePermission("project:write")`, body `{ assignments: [{ serviceId, tools[] }] }` — copy the Zod schema and full-replace transaction from `customers.ts:61-107`, swapping to `prisma.projectService` and the `projectId_serviceId` unique key; enforce the same project-access guard the other project sub-writes use (follow the existing pattern in this file, e.g. the risks/baseline sub-routes with `projectVisibilityFilter(req.user!)`); (b) include `services: { orderBy: { service: { name: "asc" } }, include: { service: true } }` in the project-detail include so `GET /projects/:id` returns them; respond from the PUT with the refreshed project detail.

**Acceptance criteria:**
- [ ] PUT round-trips: assignments replace idempotently (remove-by-omission, upsert tools)
- [ ] `GET /projects/:id` includes `services[]` with nested `service`
- [ ] A TAM who doesn't own the project (per visibility rules) gets 404/403, matching existing sub-write behavior
- [ ] CHANGELOG.md entry appended

**Verification:** backend `tsc --noEmit`; curl sequence: create 2 services → PUT both onto a project with tools → GET shows 2 → PUT with 1 → GET shows 1.

**Files:** `backend/src/routes/projects.ts`, `CHANGELOG.md`

### ✅ Checkpoint 1 — *Orchestrator*
- [ ] Backend typecheck clean; curl smoke of Tasks 1.2 + 1.3 passes end-to-end
- [ ] `docker compose logs backend` free of errors; commit(s) pushed on the feature branch

---

## Phase 2: Frontend Foundation

### Task 2.1: Query layer for project services
**Implementor:** Sonnet · **Size:** S · **Dependencies:** 1.3

**Description:** In `frontend/src/lib/queries.ts` (post-pull version — task-ordering hooks were added upstream): add `ProjectServiceAssignment` type mirroring `CustomerServiceAssignment` (lines ~59-66) with `projectId`; extend the `ProjectDetail` type with `services: ProjectServiceAssignment[]`; add `useUpdateProjectServices(projectId)` mirroring `useUpdateCustomerServices` (~456-469) — PUT `/projects/:id/services`, reuse `ServiceAssignmentInput`, invalidate `queryKeys.project(projectId)` and `queryKeys.projects`.

**Acceptance criteria:**
- [ ] Frontend typecheck passes; no component changes in this task
- [ ] CHANGELOG.md entry appended

**Verification:** `docker compose exec frontend npm run typecheck`.

**Files:** `frontend/src/lib/queries.ts`, `CHANGELOG.md`

### Task 2.2: Extract `ServiceMappingList` + inline add; refit customer tab
**Implementor:** Sonnet · **Size:** M · **Dependencies:** 1.2 (parallel-safe with 2.1)

**Description:** Extract `ServicesTab` + `ToolsEditor` from `frontend/src/pages/CustomerDetail.tsx:575-820` into `frontend/src/components/services/ServiceMappingList.tsx`. Props: `catalogue: Service[]`, `assignments: { serviceId, tools }[]`-shaped list, `onSave(next: ServiceAssignmentInput[])`, `canMutate`, `saving`, optional `subscribedServiceIds?: Set<number>` (renders a "subscribed" badge + sorts those first), optional header copy override. Preserve the existing `buildAssignments` toggle/set-tools logic and checkbox-row styling verbatim (design tokens, no new hex). Add an **inline "Add service" form** (name + description, reusing the form patterns from `Admin.tsx:1398-1427`) that calls `useCreateService` and then auto-assigns the new service via `onSave`. Refit `CustomerDetail.tsx`'s Services tab to a thin wrapper; update the empty-state copy (no more "An Admin can add them via Admin → Service Catalogue" — now "Add your first service below").

**Acceptance criteria:**
- [ ] Customer Services tab behaves exactly as before (toggle, tools chips) plus inline add works and auto-assigns
- [ ] Component contains no customer-specific imports (reusable for projects)
- [ ] CHANGELOG.md entry appended

**Verification:** frontend typecheck; manual: on a customer, add "Backup & Restore" inline → appears checked with empty tools → add tool chips → reload persists.

**Files:** new `frontend/src/components/services/ServiceMappingList.tsx`, `frontend/src/pages/CustomerDetail.tsx`, `CHANGELOG.md`

### ✅ Checkpoint 2 — *Orchestrator*
- [ ] Both typechecks clean; customer-tab regression manually verified in the running app
- [ ] Commits pushed

---

## Phase 3: Project Services Vertical

### Task 3.1: Project Services tab (route + tab + badges + add-all)
**Implementor:** Sonnet · **Size:** M · **Dependencies:** 2.1, 2.2

**Description:** New `ProjectServices` page component co-located with the other project sub-views (same directory as `ProjectOverview`/`ProjectRisks` — check `App.tsx` imports post-pull). It reads `project` from `useOutletContext<ProjectOutletContext>()` (`ProjectDetail.tsx:18-20`), renders `ServiceMappingList` with `useServices()` + `project.services` + `useUpdateProjectServices(project.id)`. If `project.customerId` is set, fetch `useCustomer(project.customerId)` and pass `subscribedServiceIds` (badge + sort-first) and render an **"Add all subscribed"** button that merges the customer's serviceIds (carrying their `tools`) into the current assignment set — one click, idempotent. Register in **both** places per convention: route `<Route path="services" …/>` under `projects/:id` in `frontend/src/App.tsx:41-48`, and `{ to: "services", label: "Services" }` in the `TABS` array (`ProjectDetail.tsx:9-16`, after Risks).

**Acceptance criteria:**
- [ ] `/projects/:id/services` renders; tab visible; subscribed services badged and sorted first; "Add all subscribed" works and is idempotent
- [ ] Projects with no customer show a plain (unbadged) picker with no errors
- [ ] Read-only users see the list but cannot mutate (reuse `canEdit`/`hasPermission` pattern from `ProjectDetail.tsx:31`)
- [ ] CHANGELOG.md entry appended

**Verification:** frontend typecheck; manual E2E: customer subscribes to A+B → project of that customer shows A+B badged → "Add all subscribed" → add extra service C inline → reload → all three persist; GET `/projects/:id` payload confirms.

**Files:** new project sub-view file, `frontend/src/App.tsx`, `frontend/src/pages/ProjectDetail.tsx`, `CHANGELOG.md`

### ✅ Checkpoint 3 — *Orchestrator*
- [ ] Full TAM flow works end-to-end in the browser; typechecks clean; commits pushed

---

## Phase 4: Relocate Management, Retire Admin Tab

### Task 4.1: Catalogue manager → Settings; remove Admin tab
**Implementor:** Sonnet · **Size:** M · **Dependencies:** 1.2

**Description:** Extract the Admin `ServicesTab` (`Admin.tsx:1306+` — add form, inline edit, active toggle, delete-with-confirm) into `frontend/src/components/services/ServiceCatalogueManager.tsx` mostly verbatim. Render it in `frontend/src/pages/Settings.tsx` as a new section card (below Profile; Settings is a `max-w-2xl` single column — match existing `<section>` styling, `Settings.tsx:56`), visible only when `hasPermission(user, "project:write")`. Update intro copy: catalogue is shared and TAM-curated; delete-confirm copy must now also mention removal from projects. Remove the `"services"` tab entry and component from `Admin.tsx` (tab list lines ~32/39, render ~67, component 1306+); drop now-unused imports.

**Acceptance criteria:**
- [ ] Admin screen no longer shows Service Catalogue; Settings shows the manager for TAM/admin, hidden for read-only roles
- [ ] Rename/deactivate/delete round-trip; deactivated services render dimmed in pickers (existing behavior)
- [ ] CHANGELOG.md entry appended
- [ ] Mobile: section stacks cleanly at 375px (standard `md:` gating, no new patterns)

**Verification:** frontend typecheck; manual check of Settings on desktop + narrow viewport; confirm Admin tabs render without gaps.

**Files:** new `frontend/src/components/services/ServiceCatalogueManager.tsx`, `frontend/src/pages/Settings.tsx`, `frontend/src/pages/Admin.tsx`, `CHANGELOG.md`

---

## Phase 5: Review & Ship — *Orchestrator*

1. Dispatch **solvro-code-reviewer** (conventions: route prefix, shared prisma client, validate middleware, query-key invalidation, optimistic patterns) and **solvro-ui-reviewer** (design tokens, tonal layering, no stray hex, mobile gates) over the diff. Fix findings via Sonnet follow-up tasks.
2. Final verification script (below), then hand to user for manual QA + PR decision (`develop` ← `feat/project-services`).

### ✅ Final Checkpoint
- [ ] All acceptance criteria across tasks re-verified
- [ ] Both typechecks clean; backend logs clean
- [ ] Full E2E: inline-create → customer map → project scope w/ badges → add-all → extra service → Settings curation → RBAC 403s
- [ ] CHANGELOG.md complete; no Claude attribution in commits; PR opened only on user go-ahead

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Merge conflicts: upstream changed `schema.prisma` + `queries.ts` | High | Phase 0 pulls before any edit; both files re-read post-pull |
| Destructive `DELETE` in migration runs everywhere it deploys | Med | User-approved start-fresh; called out in CHANGELOG; dev-stage data |
| TAMs can now hard-delete a service, cascading out of customers **and** projects | Med | Keep confirm dialog (copy updated to mention projects); `active:false` remains the soft path |
| Both-levels feels like double entry | Med | "Subscribed" badges + one-click "Add all subscribed" |
| Sonnet implementor drift from conventions | Low | Every task names the exact pattern/file to mirror; orchestrator verifies + review agents in Phase 5 |

## Open Questions (non-blocking, defaults chosen)

- Settings as the catalogue-manager home (default: yes, per approved recommendation). Alternative on request: keep a TAM-visible standalone page.
- Feeding project services into the future Reports export packet ("Identity" section) — explicitly deferred to the Reports revamp.
