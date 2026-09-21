# TODO: TAM-Defined Services (feat/project-services)

Orchestrator: Fable · Implementors: Sonnet agents · Detail: see tasks/plan.md

## Phase 0 — Sync & Preflight (orchestrator)
- [x] Pull `origin/develop` (bd9f7d7), create `feat/project-services`
- [x] Stack up + baseline typechecks (backend `tsc --noEmit`, frontend `npm run typecheck`)

## Phase 1 — Backend
- [x] 1.1 Prisma: `ProjectService` model + `add_project_services` migration + start-fresh DELETEs (S)
- [x] 1.2 `services.ts`: writes `requireAdmin` → `requirePermission("project:write")` (XS, ∥ 1.1)
- [x] 1.3 `projects.ts`: `PUT /:id/services` (mirror customers.ts transaction) + `services` in detail include (M) — incl. vitest route tests
- [x] ✅ Checkpoint 1: backend tsc clean · 30/30 vitest tests pass · live curl smoke (login → create → assign → GET round-trip → 401 unauthenticated)

## Phase 2 — Frontend foundation
- [x] 2.1 `queries.ts`: `ProjectServiceAssignment`, `ProjectDetail.services`, `useUpdateProjectServices` (S) — incl. cascade-invalidation fix on service update/delete
- [x] 2.2 Extract `ServiceMappingList` + `ToolsEditor` + inline "Add service"; refit CustomerDetail tab (M, ∥ 2.1)
- [x] ✅ Checkpoint 2: both typechecks clean · Vite compiles both modules (200) · CustomerDetail −231 lines, logic extracted verbatim

## Phase 3 — Project vertical
- [x] 3.1 ProjectServices page + route in `App.tsx` + tab in `ProjectDetail.tsx` TABS; subscribed badges via `useCustomer`; "Add all subscribed" (M)
- [x] ✅ Checkpoint 3: typecheck clean · Vite compiles all 3 modules · API E2E verified (customer subscriptions → add-all merge keeps project tools + inherits customer tools for new → GET round-trip)

## Phase 4 — Relocate & retire
- [x] 4.1 `ServiceCatalogueManager` → Settings section (project:write-gated); remove Admin Service Catalogue tab (M) — Admin.tsx −261 lines, zero stale refs

## Phase 5 — Review & ship (orchestrator)
- [x] solvro-code-reviewer + solvro-ui-reviewer passes; fix findings — code review: no blockers, 1 should-fix FIXED (FK pre-check → clean 400, both routes, +2 tests), 2 findings deferred to ISSUES.md; UI review: clean (orchestrator fallback pass — reviewer agent idled without reporting)
- [x] ✅ Final checkpoint: backend+frontend typechecks clean · 32/32 vitest · API E2E verified · CHANGELOG complete (7 entries) · commits clean (no Claude attribution) · PR awaiting user go-ahead

**Standing rules baked into every task:** CHANGELOG.md entry in the same turn as the change · design tokens only, no inline hex · commit per task on the feature branch.
