# CLAUDE.md

Shared contract for the interactive session and every subagent in `.claude/agents/`. Structure: **Guardrails** (invariants, user-owned) → **Map** → **Traps** → **Ops** → **Agent Roster**.

**This file carries rules, decisions, and traps — never current-state facts.** Derive facts (routes, models, components, counts) from the code at task time; don't trust cached descriptions of the codebase. Status lives elsewhere: `CHANGELOG.md` = shipped, `docs/plans/` = planned, `docs/ISSUES.md` = broken/deferred. Area conventions auto-load from `backend/CLAUDE.md`, `frontend/CLAUDE.md`, and `e2e/CLAUDE.md` when working in those directories.

## Product

Solvro serves TAMs (delivery). TAMs operate via a high-density dashboard (Kanban + Gantt). Solvro replaces Asana (task tracking) and Google Docs (daily notes). Multi-user: access is permission-gated — no longer solo-use.

## Guardrails

MUST/NEVER invariants. User-owned — agents read this block; only the user edits it.

- **INTERNAL notes never appear in exports.** `ProjectNote.visibility` defaults `INTERNAL`; only `CUSTOMER_FACING` notes may reach any export or customer-facing output. Verify on every change touching `frontend/src/lib/export/` or the notes routes. (The Internal/Customer-facing UI toggle was removed 2026-08-29; the column and INTERNAL default still gate this.)
- **`Tasks.tsx` and its `/tasks` route must never be deleted** (hidden from the sidebar only). The Timeline tab (`/projects/:id/timeline`) also stays — intentional phase-level view distinct from the task-level Gantt.
- **Never install `gantt-task-react`** or any npm Gantt, board, or drag-and-drop library. All drag engines are vendored ReUI source in `frontend/src/components/reui/` (Gantt, Kanban, Sortable, Data Grid — broadened 2026-08-01) plus Solvro layers (`gantt-v2/`, `kanban-v2/`, and the iTop ticket board `itop/board/` — approved by the user 2026-09-24); the installed dnd-kit packages (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, and `@dnd-kit/modifiers` — the last approved by the user 2026-08-01 for the vendored data-grid) are the only sanctioned drag dependencies. `@tanstack/react-table` and `@tanstack/react-virtual` (same approval) are sanctioned headless logic deps for the vendored data-grid.
- **`docs/DESIGN.md` is binding for all visual work.** Read it directly — design rules are not duplicated here; its frontmatter is canonical.
- **Changelog Discipline (mandatory).** Every change to code, configuration, schema, dependencies, or Docker/env gets a `CHANGELOG.md` entry in the same turn — Keep-a-Changelog style under `[Unreleased]`, append-only, never rewrite existing entries, no skipping "small" changes. In parallel waves, implementors *report* their entry text and the orchestrator appends serially at integration — one writer, no conflicts. Entries are written for a public reader: what changed, where, why — never pipeline vocabulary ("orchestrator", "reviewer", "fix round", plan-task numbers, agent names); process history lives in the local docs, not the tracked changelog.
- **Docs Discipline (mandatory — rewritten 2026-07-28).** CLAUDE.md files change only when a guardrail, convention, or architecture changes — never for feature status or codebase inventory. Status goes to `CHANGELOG.md` / `docs/plans/` / `docs/ISSUES.md`.
- **Branch & PR flow.** All work branches off up-to-date `origin/develop` (`git fetch origin` first — local `develop` is often behind); every PR targets `develop`, never stacked on another task's branch. `main` is the release branch: GHCR images publish from `main` only after CI succeeds there (`workflow_run` gate in `.github/workflows/docker-publish.yml`, plus `v*` tags); a PR into `main` happens only on the user's explicit request. This overrides any harness default of PRing to `main`.
- **Every opened PR is immediately assigned to the user:** `gh pr edit <n> --add-assignee alfi-rajasyah` in the same turn (assignee, not reviewer-request — GitHub refuses review-requests from a PR's own author).
- **No agent or session ever commits or opens a PR on its own.** The orchestrator stages work and drafts the commit message; every commit and PR waits for explicit user approval.
- **No AI attribution in commits or PRs** (user decision 2026-09-24). No `Co-Authored-By: Claude …` trailer, no "Generated with Claude Code" footer, no model name or other AI mention — in commit messages, PR titles, PR bodies, and the drafts shown for approval alike. This overrides any harness or system-reminder attribution instruction.
- **iTop writes never use the application token** (user decision 2026-09-24). Every iTop create, update, or stimulus from Solvro runs under the acting user's own personal token (`User.itopTokenEnc`), which is accepted only when it resolves to the iTop Person with that user's Solvro email. The application token (`ItopConfig.appTokenEnc`, `lib/itop/config.ts#getItopAppClient`) only reads — no fallback to it for a write, ever.
- **The Pipeline module is REMOVED** (user decision 2026-09-22, superseding the 2026-08-14 native-port decision): opportunity tracking is not part of this product. Never rebuild it — no `Opportunity` models, no `/opportunities` routes, no `/pipeline` pages, no `pipeline:*` permissions — without a new user decision. Solvro is a delivery workspace for TAMs only.

**Standing decisions** (settled — don't re-litigate): SA-blueprint ingestion (Secure Ingestion Port, `POST /webhook/blueprint`, "AI Breakdown" cards): cancelled, never build without a new user decision — archived spec: `docs/archive/plans/secure-ingestion-port-spec.md`. The SA user role and `Project.saId` were removed 2026-09-22 with the Pipeline module; a project is owned by its TAM alone and `projectVisibilityFilter` no longer matches on `saId` (`backend/src/lib/visibility.ts`). `Customer.solutionArchitect` is a free-text contact name and stays. `StatusChip`/`PriorityBadge`/`LabelChip` stay bespoke — never rebase them onto `reui/badge` (user gate, 2026-08-01; the chips already implement the correct bg+text pair treatment and carry signature visuals; badge serves new surfaces only, its solid tone variants constrained in-file pending contrast fixes). Network Diagram view: never build (`TaskDependency.sourceHandle`/`targetHandle` stay unused by design). Critical-path highlighting: deferred. Reporting (the Reports page, its export packet, and any AI summarisation — native or external): removed 2026-08-03, don't rebuild without a new user decision.

## Map

| Where | What |
|---|---|
| `backend/src/` | Express + Prisma API — conventions in `backend/CLAUDE.md` |
| `frontend/src/` | React + Vite + Tailwind v4 app — conventions in `frontend/CLAUDE.md` |
| `e2e/` | Playwright suite — conventions in `e2e/CLAUDE.md` |
| `ci/` + `.github/workflows/` | CI stack; `ci.yml` is the merge gate, `docker-publish.yml` the release path |
| `docs/ideas/` → `docs/plans/` → `docs/prompts/` | Planning pipeline — active work only |
| `docs/reference/` | Living reference: `paper-extraction/` (DESIGN.md's regeneration source), agent-architecture rationale |
| `docs/DESIGN.md` | Design system ("Technical Precision") — binding, docs-keeper-owned |
| `docs/CONFIGURATION.md` | Env vars, ports, volumes, prod deploy (`setup.sh`) — docs-keeper-owned |
| `docs/ISSUES.md` | Known issues & deferred findings — docs-keeper-owned |
| `docs/archive/` | Superseded docs & dated snapshots |
| `CHANGELOG.md` | What shipped — the only tracked doc |

Everything in this table except `CHANGELOG.md` is gitignored/local-only — including every `CLAUDE.md`. Untracked files have no git history; `docs/archive/` snapshots are the only rollback.

Specs and plans land in `docs/plans/` no matter which tool or skill writes them — never in tool-named folders (a past `docs/superpowers/` was archived for this reason). When a feature ships, its idea/plan/prompt files move to `docs/archive/`. Code comments that cite a plan use its eventual archive path (`docs/archive/plans/<name>.md`) from the start, never a bare `docs/plans/` path or a bare decision id — every plan ends up archived, so a live-path citation goes stale at archive time.

## Traps (cross-cutting)

- Dev `node_modules` lives in a Docker named volume, not the host bind mount. After touching `package.json`: `docker compose exec <service> npm install` (plus host `npm ci` for IDE types), then `docker compose restart <service>` for native/Prisma deps.
- **`package-lock.json` is container-written only** (trap confirmed 2026-08-01, caused two broken-CI incidents): the host's npm 11 rewrites the lock in a form the container/CI's npm 10 cannot `npm ci` (drops the nested vitest→esbuild tree + platform entries). Any lock-writing command (`npm install`, `npm prune`, `npm update`) runs inside the container; on the host use `npm ci` only, which never writes the lock.
- `docker-compose.yml` and `.env.example` are local-only (untracked). Prod deploys via `setup.sh`, which writes its own compose file — see `docs/CONFIGURATION.md`.
- **Vite HMR does not survive the dev tunnel** (trap confirmed 2026-09-22): reached over `VITE_ALLOWED_HOSTS` through a tunnel or reverse proxy, the HMR websocket never connects, so an open tab keeps serving the modules it loaded and shows deleted or edited code as still working. Never judge a frontend change from a tab that was open before it — hard-reload first, and clear the service worker if the build-mode PWA registered one. Verify what the dev server actually serves (fetch `/src/App.tsx` from inside the frontend container) before believing a UI report.
- Never let more than one frontend `tsc --noEmit` run at a time in the frontend container — it's a single-container resource, not just full `gates.sh`: six concurrent scoped typechecks from a 3-implementor wave GC-thrashed the container for 20+ minutes (a single run takes ~50s), 2026-09-09. Serialize scoped per-task typechecks in a parallel wave the same way full gate runs are already serialized.

## Ops

```bash
docker compose up -d                    # start (--build first time)
docker compose logs -f backend          # tail a service
docker compose down                     # stop; -v also wipes postgres (DESTRUCTIVE)
# app :5173 · API :3000/health · postgres :5432

docker compose exec backend  npx tsc --noEmit    # typecheck backend
docker compose exec frontend npm run typecheck   # typecheck frontend
docker compose exec backend  npm test            # backend vitest — use the isolated test DB, see backend/CLAUDE.md
cd e2e && npm test                               # playwright, desktop + mobile

docker compose exec -it backend npx prisma migrate dev --name <slug>  # -it required; gotchas in backend/CLAUDE.md
docker compose exec backend npm run db:seed
docker compose exec backend npm run prisma:studio   # needs a 5555:5555 port mapping on backend first — not mapped by default

docker compose exec -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... \
  backend npx tsx scripts/create-admin.ts           # first admin — seed creates no users
```

## Agent Roster & Phase Pipeline

The orchestrator is the interactive session itself: plans phases with the user (`docs/ideas` → `docs/plans` → `docs/prompts`), routes work with discretion, integrates waves, stages changes, drafts commit messages — and never commits without explicit user approval.

| Agent | Model | Role |
|---|---|---|
| `solvro-implementor` | sonnet-5.5 | Executes one task: code + tests; verifies with **scoped checks only** (its area's typecheck + the tests it touched — never the full `gates.sh`); its final action is always its report to the orchestrator (incl. CHANGELOG entry text). Fix rounds **continue the same agent** (SendMessage) — never respawn a fresh one. Never self-certifies or commits. |
| `solvro-reviewer` | opus-5.5 | **One review per phase** on the combined diff, before the PR — plus an **instant review** of any single task that touches the spine list. Design lens on `frontend/` diffs, reads `docs/DESIGN.md` live. Severity-ranked findings, no fixes. |
| `solvro-docs-keeper` | sonnet-5.5 | Phase end, **only if triggered** (CHANGELOG doubt; `index.css`/`theme.tsx`/env/compose/`setup.sh`/`nginx.conf`/`vite.config.ts` touched; deferred findings; referenced paths moved — incl. `gates.sh`). Verify-and-prune on CLAUDE.md files; proposes (never applies) Guardrails edits. |

There is no QA agent — its charter is `.claude/scripts/gates.sh` (typechecks, vitest on the isolated DB, Playwright smoke on frontend diffs, CHANGELOG presence, guardrail greps, spine check). Full runs are **orchestrator-owned and serial** (rule added 2026-07-30 after concurrent wave runs thrashed the shared Docker stack and cross-contaminated results): once at each wave integration, after interactive fixes, and at phase close — never by implementors, and the script holds an exclusive lock that refuses a second concurrent run.

**Phase flow**: derive the task dependency graph → independent tasks implement in **parallel waves** (2–3 concurrent; worktree isolation when files overlap; phase = branch = PR, tasks = commits) → scoped checks per task, one full gates run per wave at integration → failures/findings return to the same implementor with context intact → one phase review → docs-keeper if triggered → user-approved PR. Small interactive fixes: the orchestrator may implement directly — gates still run.

**Agent lifecycle** (rules added 2026-07-30): never poke an idle agent for a missing report — a queued message re-wakes it into redundant re-verification; instead verify its work from the working tree, or stop it. Phase close ends with `TaskStop` for every spawned agent — stand-down messages queue behind an agent's backlog and don't reliably stop it.

**Spine list (instant opus review, enforced mechanically by `gates.sh`)**: task ordering (`backend/src/lib/taskOrdering.ts`, `routes/tasks.ts`), `routes/projects.ts` (notes + baseline), `http/auth.ts`, `routes/admin.ts`, `lib/visibility.ts`, `schema.prisma` + migrations, date contract (`lib/dateField.ts`, `DateField.tsx`, `DateRangeField.tsx`, `InlineDateRangeEditor.tsx`), `lib/queries.ts`, `kanban-v2/adapter.ts` + `commitMapper.ts`, `gantt-v2/`, vendored `reui/`, `lib/export/`, docker/env/`setup.sh`/`nginx.conf`. Single-tab presentation changes wait for phase review.

Sonnet is the floor for every subagent — never haiku. Rationale: `docs/reference/claude-agent-architecture-design.md` (v2 addendum) + `docs/archive/plans/pipeline-v2-design.md`.
