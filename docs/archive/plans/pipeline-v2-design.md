# Pipeline v2 — phase-based orchestration

**Status: APPROVED & IMPLEMENTED 2026-07-28.** Gate script live at `.claude/scripts/gates.sh` (every gate + both failure paths proven); CLAUDE.md roster, the three agent files, and the architecture reference's v2 addendum updated the same day; `solvro-qa` archived at `docs/archive/solvro-qa-agent-v1.md`. (v1 of this doc proposed per-task tiers; superseded by the brainstorm's converged shape: **phases, not tiers**.)

## Problem (as observed by the user)

A 5-task phase should cost ~25 subagents under the flat pipeline (implementor + qa + reviewer + keeper per task, plus acceptance) — in practice it costs more, because **failures multiply agents instead of adding them**: every gate failure or review finding spawns a *fresh* implementor that re-reads the contract and re-derives context, which then triggers a fresh QA and a fresh reviewer. Tasks that could run in parallel run sequentially. Result: ~8-hour phases, mostly premium-token ceremony.

## The design in one breath

The orchestrator plans a phase and routes with discretion; sonnet implementors execute independent tasks **in parallel waves**; a **gate script** checks each task the moment it lands; failures **continue the same agent** instead of spawning a new one; **one opus review reads the whole phase** before it becomes the PR the user reviews — except code on the **spine list**, which gets an instant single-task review the moment it's touched.

## Roles

| Role | Who | Cost profile |
|---|---|---|
| Plan, route, integrate, accept | Orchestrator (main session) | premium — kept to coordination, not codegen |
| Implement | sonnet implementors, parallel waves | cheap, token-heavy |
| Mechanical certification | `.claude/scripts/gates.sh` | zero agents, seconds |
| Judgment | opus reviewer, **once per phase** (+ instant on spine touches) | expensive, used where blast radius is |
| Docs reconciliation | docs-keeper, **once per phase, only if triggered** | cheap, usually skipped |
| ~~QA agent~~ | **retired** — its charter is the gate script | — |

Rationale (user's original architecture, ratified): cheap generation, expensive judgment. Fresh-eyes review value comes from fresh *context*, not model tier; opus is reserved for where mistakes are expensive. The CLAUDE.md slim restructure already cut each dispatch's contract-reading cost from ~230 lines to ~82 + one area file.

## Execution shape for a phase

1. **Plan** — orchestrator derives the task dependency graph from the plan doc; independent tasks form waves (cap ~2–3 concurrent implementors — beyond that orchestrator integration attention is the bottleneck).
2. **Implement in waves** — each wave's implementors run concurrently (worktree isolation when tasks overlap on files; same phase branch, sequential commits, when disjoint). Phase = branch = PR, tasks = commits — exactly how `feat/reui-date-field` (#109) actually shipped.
3. **Gates per task** — the script runs the moment a task lands: typechecks, vitest (isolated DB), Playwright smoke on frontend diffs, CHANGELOG presence, and the standing guardrail greps (Tasks.tsx + route exist; `gantt-task-react` absent; export paths filter INTERNAL; local-only layer untracked; kanban vendor file + SOLVRO PATCH count). Rationale: "it's broken" must be known in seconds so the next wave never builds on broken code; "it's wrong" can wait for phase review.
4. **Failures continue, never respawn** — gate failures and review findings go back to the *same* implementor via SendMessage with its context intact. The respawn tax (fresh agent re-reading everything per fix round) is the single biggest waste in v1.
5. **Phase review** — one opus review of the combined phase diff before the PR. Sees cross-task interactions (task 4 undoing task 1's assumption) that per-task reviews are structurally blind to. Findings batched back to the owning implementors in one round.
6. **Docs-keeper at phase end, only if triggered** — CHANGELOG entry missing/doubtful; diff touched `index.css`/`theme.tsx` (DESIGN sync) or `env.ts`/`docker-compose.yml`/`setup.sh`/`nginx.conf`/`vite.config.ts` (CONFIGURATION sync); user deferred a finding; a path referenced by agent docs or `gates.sh` moved. Otherwise skipped with a note.
7. **User reviews the PR** — unchanged, per Guardrails.

## The spine list — instant-review tripwire

User's framing: everything important lives in the projects page (Overview/List/Kanban/Gantt/Timeline/Risks/Services). The danger is not the tabs but the **shared spine** they all sit on — break it and three views break at once. Single-tab presentation changes wait for phase review; touching the spine triggers an immediate opus review of that one task while the phase continues:

- Task ordering: `backend/src/lib/taskOrdering.ts`, task position routes, drag-commit logic
- Date contract: `frontend/src/lib/dateField.ts`, `DateField.tsx`, `DateRangeField.tsx`, `InlineDateRangeEditor.tsx`
- Task mutation hooks + optimistic updates in `frontend/src/lib/queries.ts`
- View adapters: `kanban-v2/adapter.ts` + `commitMapper.ts`, `gantt-v2/` adapter + connector-paths, Gantt baseline math
- Vendored engines: anything under `frontend/src/components/reui/` (re-pull clobber risk; SOLVRO PATCH discipline)
- App-wide hot surfaces (from Guardrails): `frontend/src/lib/export/`, notes routes, `http/auth.ts`, `routes/admin.ts`, `lib/visibility.ts`, `schema.prisma`/migrations, docker/env/`setup.sh`/`nginx.conf`

**Enforcement is mechanical, not model judgment**: `gates.sh` matches `git diff --name-only` against this list and reports `SPINE TOUCHED — instant review required`; it fails the phase if a spine touch has no recorded opus review. The orchestrator's discretion routes work; grep guards the boundary. The spine is also where the strongest tests already sit (78 dateField + 36 kanban + ordering + dnd e2e) — gates catch mechanical regressions there in seconds; instant review covers judgment errors gates can't see.

## What stays sacrosanct

- No agent or session commits or opens a PR without explicit user approval.
- Phase review before PR is non-skippable; spine touches always get opus eyes.
- Changelog Discipline unchanged — parallel implementors *report* entry text; the orchestrator appends serially at integration (one writer, no conflicts).
- Sonnet floor for every subagent; never haiku.

## Expected effect (user's 5-task example)

| | v1 flat pipeline | v2 phase-based |
|---|---|---|
| Agent contexts | 25+ nominal, 30–35 with fix respawns | ~6–8 (5 implementors + 1 reviewer + 0–1 keeper; fixes are continuations) |
| Premium tokens | orchestrator narrates ~30 dispatches + opus × 5 reviews | orchestrator coordination + opus × 1 (+ spine instants) |
| Wall-clock | sum of every leg, sequential | slowest task per wave + one review + one fix round (~8h → ~2h) |

## Migration steps (on approval — NOT executed yet)

1. Write and test `.claude/scripts/gates.sh` (each gate proven to pass/fail correctly; spine-list check included). Location `.claude/scripts/` = local-only, zero git ceremony.
2. Rewrite CLAUDE.md's Agent Roster section: phase flow + spine list replace the flat per-task flow.
3. Agent files: delete `solvro-qa.md`; implementor gains "run gates before reporting" + continuation-aware fix protocol; reviewer becomes phase-scoped (opus) with instant-dispatch mode; docs-keeper gains trigger list + `gates.sh` on its fact-sync watchlist.
4. Update `docs/reference/claude-agent-architecture-design.md` with a v2 addendum linking here.
5. Pilot on the next real phase; tune wave size and the spine list from experience.

## Resolved during design review (2026-07-28)

- Per-task tiers → **phases** (user: review per phase, not per task; orchestrator decides which agents to spawn).
- QA agent → **retired**; gate script per task (user agreed explicitly).
- Reviewer: **opus, once per phase** + instant on spine; no sonnet reviews (supersedes v1's tier-split answer).
- Fix rounds → **continue the same agent** (SendMessage), never respawn.
- Hot surfaces → the **spine list** above (user: "mostly everything lives in the projects page" → shared-spine boundary agreed).
- Gate script location → `.claude/scripts/` (default; flag at review if tracked `scripts/` preferred).
