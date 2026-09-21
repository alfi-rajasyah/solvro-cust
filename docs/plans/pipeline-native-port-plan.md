# Pipeline Native Port — Implementation Plan

**Status:** DRAFT 2026-08-14 — awaiting the user's explicit go. No implementation starts before that word.
**Supersedes:** the phased service-integration plan (`velora-integration-plan.md`, pivot banner 2026-08-14). The PRD (`velora-integration-prd.md`) remains the **feature spec** for §0 (lifecycle), §2 (UI/UX), §5 (permission strings + role grants); its §3/§4/§7 are void.
**Progress page (update on every milestone):** https://claude.ai/code/artifact/15a2e5b9-fb0a-4e57-8280-f67b6238750c — decisions ledger, before/after architecture, and the 28-task tracker.
**Reference implementation:** sibling clone `../VeloraApp` (GitHub `FS3P/VeloraApp`) — read-only. It is the behavior oracle and the one-time data source. Nothing is imported from it as code; its patterns are re-implemented in Solvro's conventions.

## Delivery mode (user instruction, 2026-08-14 — overrides the phase=branch=PR cadence for this program)

- **Build everything, local first.** One long-lived branch off up-to-date `origin/develop`: **`velora-integration`** (created 2026-08-14). No per-phase or per-milestone PRs.
- **One PR into `develop` at the end**, opened only when the user agrees development is done.
- **Maximize parallelism** (user, 2026-08-14): wave sizes follow the dependency graph, not the 2–3 cap — as many concurrent implementors as the graph allows, worktree isolation on file overlap. Bounds that remain: `gates.sh` runs stay serial and orchestrator-owned; the shared Docker dev stack is not thrashed by concurrent scoped checks.
- Internal discipline still applies: implementor waves with scoped checks, serial `gates.sh` runs at milestone boundaries, opus review on spine touches and one full review before the final PR, CHANGELOG entries as work lands (they accumulate on the branch), docs-keeper at the end.
- Commits: local checkpoint commits on the port branch at milestone boundaries — **standing approval granted by the user 2026-08-14**. The final PR presents the whole.
- **Continuous run (user, 2026-08-14): do not stop between milestones — M1 through M6 in one continuous execution.** At each milestone boundary: checkpoint commit, report to the user, and update the progress artifact (task statuses + a summary of what has been done). The single PR at M6 close still opens on the user's word.
- UI (user, 2026-08-14): build on the vendored ReUI/shadcn set — `components/reui/` engines + `ui/` Base-UI primitives, `// SOLVRO PATCH` convention for local edits. `StageChip` stays bespoke (chips guardrail).

## Scope

**Ports into Solvro** (all screens per PRD §2, design per `docs/DESIGN.md`):
board `/pipeline` (Kanban/List/Swimlane/Quarter + KPI bar + won/drop confirms), opportunity detail `/pipeline/:id` (links, activity timeline, stage menu), opportunity form, Excel import (3-step, template download), Overview fold-in panel, Executive analytics (funnel, leaderboard + PIC table, trend, workload heatmap, PIC drill-down), won-deal handoff, `pipeline:*` permissions.

**Dies with the service design** (never ported): Velora's auth/users/profiles/role_permissions (Solvro `User`/`Role` replace them), notification stack (Telegram/Google Chat/deadline reminder/weekly report — off per settled decision), Velora's project module, its `settings` table, its Next.js runtime, `/pipeline-api`, dual JWT verification.

**Resolved 2026-08-14 (user):**
1. External REST API (`/api/external/v1/opportunities`, hashed bearer keys, Access-keys admin tab): **dropped for now**.
2. Documents (file upload per opportunity): **dropped** — migration skips `documents` rows (files live only in the old uploads volume).
3. Admin surface (follows 1+2): one small "Pipeline" admin tab — Import history only. Audit deferred; no Access-keys tab. (Default from this plan; shape finalized at M4.)
4. **Auto-hold: dropped entirely** (user, 2026-08-14) — it was Velora's nightly job auto-moving stale deals; Solvro has no background jobs that mutate data, and every stage change is an explicit user action. No endpoint, no scheduler, no run log.

## Data model (new Prisma models in `schema.prisma` — spine, snake_case `@map`, camelCase TS)

| Model | Table | Notes |
|---|---|---|
| `Opportunity` | `opportunities` | Keep Velora's UUID ids (`String @id`) so migration preserves FKs. Fields: `title`, `customerName`, `dealValue BigInt`, `stage` (enum `PipelineStage`: `ASSESSMENT`, `RFP`, `DELIVER_PROPOSAL`, `WAITING_RESPONSE`, `WON`, `DROP`), `picId Int?` → `User`, `deadline @db.Date` (plain calendar day — DateField contract, no instant conversion), `description`, `productSolution`, `leadSource`, `winProbability Int`, `stageOrder Int`, `wonAt DateTime?` (set on transition into WON, cleared on leaving — carried Q4 decision), `projectId Int? @unique` → `Project` (native handoff link — replaces the PRD's cross-DB `Project.sourceDealId` soft link), timestamps |
| `OpportunityActivity` | `opportunity_activities` | UUID id, `opportunityId`, `userId Int` → `User`, `note`, `createdAt`; also written automatically on stage changes |
| `OpportunityLink` | `opportunity_links` | UUID id, `opportunityId`, `label`, `url`, `createdAt` |
| `PipelineImportLog` | `pipeline_import_logs` | row counts + status per import, for the Import admin surface |

No table-name collisions with existing Solvro tables. Velora's `users`/`profiles`/`audit_logs`/`settings`/`role_permissions`/`notification_rules`/`import_logs`/`cron_logs`/`documents`/`projects`/`project_*` tables are **not** ported as tables — their surviving concepts map onto Solvro models or die.

## Backend (Express, routers mounted WITHOUT `/api` prefix — the proxy adds it)

- `routes/opportunities.ts` (new, joins the spine): CRUD, stage transition (single place that writes `wonAt`, `stageOrder`, and the auto activity entry), reorder within/across stages, list (full set, client-side filtering per settled decision), bulk-create for import.
- Analytics endpoints for the dashboard fold-ins (funnel/leaderboard/trend/workload aggregations — SQL via Prisma, shaped for Recharts).
- Handoff: `POST /opportunities/:id/handoff` creates the `Project` and links `projectId` in **one transaction** — the frontend-orchestrated two-call dance and compensating unlink from the PRD are obsolete.
- Permissions: `requirePermission("pipeline:*")` gates per PRD §5; ownership checks (`edit_own`/`delete_own`) compare `picId` to the caller. Seed: append the 6 `pipeline:*` strings to the SA role's grants (view/create/edit_own/delete_own); **SA Manager** stays an admin-created custom role (PRD §5 decision). Frontend `PERMISSION_CATALOG` in `lib/auth.tsx` gains the 6 strings.
- No background jobs: auto-hold is dropped (resolved question 4). Velora's `cron_logs` and cron endpoints have no native equivalent.
- Migration: `backend/scripts/import-velora.ts` — connects to the `velora` database (dev: the compose service; prod cutover: the restored dump), maps `profiles` → Solvro `User` by email (unmatched PICs → null + report), inserts opportunities/activities/links preserving UUIDs and timestamps. Idempotent (upsert by id). Run manually, never from seed.

## Frontend (per PRD §2 — unchanged in substance, `/api` instead of `/pipeline-api`)

- Server state: `pipelineKeys` + hooks in `lib/queries.ts` (spine), calling `apiRequest` — no separate client module needed.
- `lib/pipelineFormat.ts` (IDR/compact-number helpers), `StageChip` (bespoke, 6-tone mapping per PRD §2.2 — never on `reui/badge`), `PipelineGuard` (`pipeline:view`), `NAV_COMMANDS` + route registrations.
- Board: `components/pipeline/` (adapter, commitMapper, `SolvroPipelineKanban`, `OpportunityCard`) on vendored `reui/kanban.tsx`; optimistic mutations per house pattern.
- Views: `pages/Pipeline.tsx` + Kanban/List/Swimlane/Quarter; `OpportunityFormModal`; `pages/OpportunityDetail.tsx`; `PipelineImportDialog` (`xlsx` — approved dep, **container install**, lock-file trap applies); Overview panel + Executive analytics fold-ins (Recharts), gated by `pipeline:view`; `DealCard` on ProjectDetail via the native relation.

## Milestones (internal checkpoints — gates.sh + review cadence, NOT PRs)

1. **M1 Foundations**: schema + migration files, permissions catalog/seed, opportunities CRUD + stage-transition routes, backend vitest for transitions/`wonAt`/ordering. Spine review (schema + new route file + `queries.ts`).
2. **M2 Board**: pipeline hooks, StageChip, adapter/commitMapper (+ unit tests), Kanban view + KPI bar + confirms, nav/route/guard wiring.
3. **M3 Views + form + detail**: List/Swimlane/Quarter, OpportunityFormModal, OpportunityDetail (links, activity, stage menu).
4. **M4 Import + admin**: xlsx import dialog + bulk endpoint + `PipelineImportLog`, and the Pipeline admin tab (import history).
5. **M5 Analytics + handoff**: dashboard fold-ins, executive analytics, PIC drill-down, handoff transaction + prefilled ProjectFormModal + DealCard.
6. **M6 Data migration + hardening**: `import-velora.ts` against the dev `velora` DB, e2e suite (board drag, view switching, form, import — real backend, no route mocks), full gates, one phase-style opus review of the whole diff, docs-keeper, THEN the single PR on the user's word.

## Testing & guardrails

- Backend vitest on the isolated test DB (stage transitions, `wonAt`, ordering, import mapping, handoff transaction, permission gates). Frontend: adapter/commitMapper/format unit tests. e2e: board + views + form + import against the real API.
- Binding guardrails: no new drag/board libs (vendored ReUI + sanctioned dnd-kit only), no Radix, chips bespoke, DESIGN.md for all visuals, CHANGELOG discipline (entries accumulate on the branch), `Tasks.tsx`/Timeline untouched.
- New deps: none backend-side. Already approved: `xlsx` (frontend, container install, lock-file trap applies).

## Cutover (after the final PR merges and deploys)

**User decision 2026-08-15: START FRESH — no data migration.** The Pipeline begins empty in production; `import-velora.ts` ships unused (available only before go-live if the decision ever reverses — it is a full-overwrite sync). Remaining acts: retire the standalone `/opt/velora` stack + its GitLab CI deploy at will; drop the dev `velora-*` services and the `../VeloraApp` clone after a soak period.
