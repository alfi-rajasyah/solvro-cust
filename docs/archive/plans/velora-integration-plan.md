# Velora Integration — High-Level Implementation Plan

> **PIVOT 2026-08-14 (after Phase 1) — this plan's architecture is SUPERSEDED. Do not implement phases 2–9 as written.** The user redefined the integration as a **native port**: Velora's features are re-implemented inside the Solvro repo (Prisma models, Express routes, React pages) — no separate backing service, no `/pipeline-api`, no Velora-repo phases. Phase 1's merged infra was reverted (PR #148; the develop→main promotion #147 was closed). The PRD's §2 UI/UX specs and §5 permissions mapping remain valid as feature specs; §3 (API contract) and §4 (topology) are void. A replacement port plan must be written before further implementation. The dev stack's Velora services remain as behavior reference + one-time data source.

**Status:** approved 2026-08-14, ready for implementation. Written for a fresh session: read this file and the PRD, then start Phase 1.
**Spec (binding):** `docs/plans/velora-integration-prd.md` — approved in full, every open question settled. This plan sequences it; the PRD defines it. On any conflict, the PRD wins.
**Artifacts:** PRD page https://claude.ai/code/artifact/738d8c58-3a7a-411e-9139-2cf43b70f5f3

## Settled decisions (do not re-litigate)

1. **Velora follows Solvro's settings** wherever conventions differ — auth (HS256 + shared `JWT_SECRET`), tokens, UI system, deployment.
2. **One Postgres server**: Solvro's container gains a second logical database `velora`; Velora's `db` container is removed. Never merge into one database — table names collide (`users`, `audit_logs`, `settings`) and Prisma must not share a database with Velora's `migrate.ts`.
3. **External notifications are OFF in v1**: Telegram/Google Chat, deadline-reminder cron, weekly report — code retained, crontab entries removed, no Notices admin tab.
4. **Frontend-orchestrated handoff** (no `serviceAuth.ts`, no service tokens); **soft-match customer linking** (no cross-DB FK); **6-tone StageChip** (no DESIGN.md change); **`won_at` column added**; **no toasts** (inline `Alert`); **`xlsx` dependency approved** (container install only).
5. `CLAUDE.md`'s Product block was already rewritten (2026-08-14): Solvro serves TAMs (delivery) + SAs (pipeline), permission-gated, no longer solo-use.

## Prerequisites (verify in the implementation session before Phase 1)

- **Velora repo access** — RESOLVED 2026-08-14: Velora-side work uses the GitHub repo `FS3P/VeloraApp` (user decision); cloned as the sibling working copy `../VeloraApp`. The GitLab CI/registry question folds into the cutover decision tracked in `docs/ISSUES.md` (due by Phase 2).
- **Env inventory**: locate the prod VPS values for `JWT_SECRET` (to be shared to Velora), `CRON_SECRET`, and both `DATABASE_URL`s. `docs/CONFIGURATION.md` is the Solvro side's reference.
- Solvro branch discipline: every phase branches off up-to-date `origin/develop`, PRs into `develop`, PR assigned to `alfi-rajasyah`, no commit without user approval.

## Phase sequence

Nine phases. Phases 2–5 are Velora-repo work; 6–8 are Solvro-repo work; 1 and 9 touch both. Phase 5 is independent — run it any time after Phase 2. Durations are the rewrite plan's estimates (~10–12 weeks total).

### Phase 1 — One address (B1, infra, 3–5 days)
Both apps behind one nginx; one Postgres server. No code deleted.
- nginx: `/pipeline-api/*` → Velora app (`127.0.0.1:3001`); Solvro stays at `/` and `/api`.
- Compose: add Velora `app` + `cron` services; create the `velora` database in Solvro's Postgres; move data via dump/restore; remove Velora's `db` container; point Velora's `DATABASE_URL` at the shared server; crontab keeps **only** `auto-hold`.
- Share `JWT_SECRET` into Velora's env (used from Phase 2).
- **Spine**: `nginx.conf`, `setup.sh`, docker/env → instant opus review; docs-keeper trigger (`docs/CONFIGURATION.md`).
- Exit: both UIs reachable through one origin; Velora still works standalone.

### Phase 2 — Shared sign-in (B2, Velora repo, ~2 weeks)
- Add `lib/solvro-token.ts` (verify Solvro's HS256 JWT: `{ sub, role, permissions[] }`, `"*"` wildcard).
- Rewrite `lib/auth.ts` (verify-only, never issue), `middleware.ts` (path prefix, no login redirect), `lib/admin.ts` (role from token).
- Delete `app/api/auth/*` (login/register/refresh/me), the login screens, `components/auth-provider.tsx`, `session-warning-modal.tsx`.
- Exit: Velora's API accepts only Solvro JWTs (5 files / 439 lines deleted).

### Phase 3 — Linked identities (B3, Velora repo, 3–5 days)
- Migration: `profiles.solvro_user_id INT UNIQUE NULL`, `opportunities.solvro_project_id INT NULL`, `opportunities.won_at TIMESTAMPTZ NULL` (stage-change handler sets/clears it).
- One-off backfill: match existing profiles to Solvro users by email.
- Exit: every active profile mapped; `won_at` populated on new wins.

### Phase 4 — Shared permissions (B4, Velora repo + tiny Solvro PR, ~1 week)
- Velora: delete `lib/permissions.ts` + the 4 identity screens (`user-management`, `permissions-manager`, `user-form-dialog`, `reset-password-dialog`); edit the permission check in the 53 surviving routes to read the token's `permissions` array (`pipeline:*` strings, PRD §5 mapping).
- Solvro: append `pipeline:view/create/edit_own/edit_all/delete_own/delete_all` to `PERMISSION_CATALOG` (`frontend/src/lib/auth.tsx`); grant view/create/own to the `SA` role and create **SA Manager** (adds the `_all` pair) via Admin → Roles.
- Exit: a role edit in Solvro Admin changes Velora behavior on next login.

### Phase 5 — Delete Velora's project module (B5, Velora repo, 2–3 days, run early)
- Delete the 16 project files (2,218 lines) + their routes. Nothing replaces them — Solvro owns delivery.

### Phase 6 — Pipeline core (B6a, Solvro repo, part of the 4–6-week B6)
The first and largest Solvro UI phase. PRD §2.1–2.4, §2.6, §2.11 are the spec.
- Foundations: `lib/pipelineApi.ts`, `pipelineKeys` hooks in `lib/queries.ts` (**spine** → instant review), `lib/pipelineFormat.ts` (IDR helpers), `StageChip`, `PipelineGuard.tsx`, `NAV_COMMANDS` entry.
- Board: `components/pipeline/` (adapter, commitMapper, `SolvroPipelineKanban`, `OpportunityCard`) on vendored `reui/kanban.tsx`; KPI bar; won/drop confirms.
- Views: `pages/Pipeline.tsx` + Kanban/List/Swimlane/Quarter; `OpportunityFormModal`.
- e2e: board smoke + view switching against a **mocked `/pipeline-api`** (Playwright `route()` fixtures).

### Phase 7 — Detail + import (B6b, Solvro repo)
PRD §2.5, §2.9: `pages/OpportunityDetail.tsx` (links, activity timeline, stage menu), `PipelineImportDialog` (3-step, template download; `xlsx` installed **inside the container**, then host `npm ci`).

### Phase 8 — Admin tabs + analytics (B6c, Solvro repo)
PRD §2.7–2.8: 4 admin tabs (Access keys, Audit, Scheduled jobs, Import), Overview Pipeline panel, Executive analytics (funnel, leaderboard + PIC table, trend, workload heatmap — Recharts), PIC drill-down modal. Both fold-ins gated by `pipeline:view`.
- Close of B6: delete Velora's entire screen layer (75 files) from the Velora repo → headless service.

### Phase 9 — Handoff (B7, both repos, 1–2 weeks)
PRD §2.10, §4.4: Solvro migration `Project.sourceDealId` (**spine** → instant review), `DealCard`, won-confirm → prefilled `ProjectFormModal` flow with compensating unlink; Velora `PATCH` accepts `solvro_project_id`.
- Final: manual cross-service smoke on staging (login → board → drag → won → project), then archive these plan docs to `docs/archive/`.

## Cross-cutting rules (Solvro pipeline discipline)

- Phase = branch = PR into `develop`; tasks = commits; parallel implementor waves (2–3) with worktree isolation on file overlap.
- Scoped checks per task; **one serial `gates.sh` run per wave** (orchestrator-owned); one phase review before each PR; docs-keeper only on its triggers (Phase 1 and 9 will trigger it).
- CHANGELOG entry for every change, written for a public reader; new dep `xlsx` called out.
- Velora-repo phases follow Velora's own CI (build → Trivy → deploy); its GitLab flow (`develop` → MR → `main`) — confirm with the user before the first Velora push.
