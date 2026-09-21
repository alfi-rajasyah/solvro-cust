# Plan: Per-TAM Portfolio Timeline on Overview

> **Execution model**: Fable 5 orchestrates; Sonnet 5 subagents implement. The orchestrator updates the checkboxes in THIS file as tasks and QA gates complete, so progress is always visible here.
>
> **Status legend**: `[ ]` pending · `[x]` done. Phases run strictly in order. A phase is closed only when its QA gate is fully checked and its commit exists.

---

## 1. Context

The TAM Overview page's "Portfolio progress" chart is **fake**: `buildSCurve()` in `frontend/src/pages/Overview.tsx:315-327` synthesizes a fixed-shape ramp (0 → 15% → 40% → 65% → 85% → done) from two snapshot numbers. W-5…W-1 are not real weeks; the code comment admits it's a placeholder "until a real time-series endpoint lands."

The shipped Executive dashboard (`frontend/src/pages/Executive.tsx`, fed by `GET /reports/executive` in `backend/src/routes/reports.ts`) already renders the real thing: a **Portfolio Timelines calendar** — 12 equal month columns, one status-colored bar per project, `‹ year ›` switcher, clip chevrons, dashed Today line (current year only), dot legend, unscheduled-projects footnote, tooltip `start → end · progressPct%`.

**Goal**: give each TAM that same calendar on their own Overview, scoped to their projects, replacing the fake chart — and use the new per-project overdue data to fix the half-dead health signal in "Projects needing attention" (`TODO(health-signal)` at `Overview.tsx:172-178` and `354-365`; the amber bucket is currently unreachable).

Scoping comes free: `GET /overview` (`backend/src/routes/overview.ts`) already applies `projectVisibilityFilter(user)` (`backend/src/lib/visibility.ts`) to every query. What's missing is per-project `start/end/progressPct/isOverdue` data — exactly what `reports.ts:33-103` computes org-wide (single `findMany` with scalar task selects, single-pass min/max/done loop, `startOfToday` overdue rule).

## 2. Decisions (locked — do not relitigate)

1. **Calendar view only** on Overview — no overdue worklist table, no calendar/list toggle. Year switcher + clip chevrons stay (free with the component).
2. **Delete the synthetic S-curve entirely** — no cumulative-progress chart remains on Overview.
3. **Fix the health signal**: "Projects needing attention" consumes real `isOverdue`/`daysOverdue`, resolving the TODOs. Amber tier only — no red tier.
4. **Shared code, not copy-paste**: one backend helper serves both endpoints; one frontend calendar component serves both pages. Executive must be **behaviorally identical** after the refactor.
5. Backend approach: extend `GET /overview` (reuses auth/scoping/invalidation). No new endpoint, no `?scope=mine` on `/reports/executive`.

## 3. Out of scope

- Overdue worklist table or calendar/list view toggle on Overview.
- Real portfolio-level S-curve (possible follow-up branch).
- Red health tier or per-task overdue counts.
- Prisma schema changes, migrations, Docker/env changes — none are needed.
- Anything on the `feat/project-services` branch.

## 4. Reference facts (verified 2026-07-16; spot-check if line numbers drift)

| Fact | Location |
|---|---|
| Fake S-curve builder | `frontend/src/pages/Overview.tsx:315-327`; used via `sCurve` const at L55; chart card at L93-146 |
| Attention strip + TODOs | `Overview.tsx:160-208` (strip), `172-178` + `354-365` (TODO(health-signal)), `healthRank`/`healthColor` at L358-368 |
| SkeletonGrid | `Overview.tsx:~299-313` |
| Executive row computation | `backend/src/routes/reports.ts:33-103`; `ExecutiveProjectRow` interface at L10-24 |
| Executive calendar block | `Executive.tsx:~332-367` (constants/helpers), `~369-555` (`PortfolioCalendar`), `~561-568` (`fmtDate`) |
| Executive sort comparator | `Executive.tsx:192-199` inside `PortfolioTimelinesSection` |
| Frontend row type + hook | `frontend/src/lib/queries.ts:~1289-1319` (`ExecutiveProjectRow`, `useExecutiveReport`); `OverviewResponse` at ~L175-181; `useOverview` at ~L251 |
| Visibility filter | `backend/src/lib/visibility.ts` — `projectVisibilityFilter(user)` |
| Overview endpoint | `backend/src/routes/overview.ts` — 5 parallel queries in `Promise.all` (~L21-53) |

---

## Phase 0 — Branch & baseline

**Owner: orchestrator (no subagent).**

- [x] **T0.1 — Branch.** `git fetch origin` then `git checkout -b feat/overview-portfolio-timeline origin/develop`. *(base = 4e7b4af, includes PR #12 merge of feat/project-services)*
- [x] **T0.2 — Base sanity check.** Confirm `frontend/src/pages/Executive.tsx` and the `/executive` route in `backend/src/routes/reports.ts` exist on this branch. If missing, **STOP and ask the user** which base to use — the Executive feature may not be merged to develop yet. *(both present; file sizes match exploration)*
- [x] **T0.3 — Stack up.** `docker compose up -d`; wait until `http://localhost:3000/health` returns OK and `http://localhost:5173` serves the app. (Docker Desktop is already running.) *(health: ok/db up; frontend 200)*
- [x] **T0.4 — Baseline QA.** Run `docker compose exec backend npx tsc --noEmit`, `docker compose exec frontend npm run typecheck`, `docker compose exec backend npm test`. If anything is red on the clean checkout, **STOP and report** — do not build on a broken baseline. *(both tsc green; 3 files / 32 tests passed)*

### QA gate 0
- [x] Base branch contains the Executive feature (T0.2 passed)
- [x] Stack healthy (T0.3)
- [x] Baseline typechecks + tests green, outputs recorded (T0.4)

---

## Phase 1 — Backend: shared portfolio computation

**Owner: Sonnet implementor (one task brief covering T1.1–T1.3; orchestrator reviews).**

- [x] **T1.1 — Create `backend/src/lib/portfolio.ts`** (sits beside `visibility.ts`).
  - `export interface PortfolioProjectRow` = the `ExecutiveProjectRow` shape from `reports.ts:10-24` **plus `updatedAt: string`**.
  - `export async function computePortfolioRows(where: Prisma.ProjectWhereInput): Promise<PortfolioProjectRow[]>` — lift `reports.ts:33-103` **verbatim with exactly three edits**: (1) pass `where` into the `findMany`, (2) add `updatedAt: true` to the project select, (3) emit `updatedAt: project.updatedAt.toISOString()` in the mapped row.
  - Keep untouched: single-query shape (scalar task fields only — no N+1), `startOfToday` overdue rule (`end < startOfToday && status ∉ {COMPLETED, CANCELLED}`), `sections orderBy position`. Import the shared prisma client from `../prisma.js`.
  - *Acceptance*: helper compiles; no other logic drift vs the lifted block.
- [x] **T1.2 — Refactor `backend/src/routes/reports.ts`.** Delete the local interface + computation; the route body becomes `const rows = await computePortfolioRows({})`. Keep: `requirePermission("report:executive")`, the `{ projects: rows, generatedAt }` response, and the "Intentionally ORG-WIDE" comment at the call site (it documents why the filter is `{}`).
  - *Acceptance*: response contract unchanged except the additive `updatedAt` field.
- [x] **T1.3 — Extend `backend/src/routes/overview.ts`.** Add `computePortfolioRows(scope)` as a **6th member of the existing `Promise.all`** (`scope` is already `projectVisibilityFilter(user)`); add `portfolio` to the JSON response. All visible projects, no cap. `recentProjects`/`recentTasks` and everything else stay.
  - *Acceptance*: additive-only change to the `/overview` payload; latency stays parallel.

### QA gate 1 (orchestrator)
- [x] Diff review: T1.1 is lift-with-3-edits; T1.2 contract unchanged (+`updatedAt` only); T1.3 uses the same `scope`
- [x] `docker compose exec backend npx tsc --noEmit` green
- [x] `docker compose exec backend npm test` green (projectServices / projectWipLimits / taskOrdering — 32/32)
- [x] API smoke as admin (`admin@solvro.local` / `password123`): `GET /overview` carries `portfolio` rows with `isOverdue`/`daysOverdue`/`updatedAt`; `GET /reports/executive` shape unchanged + `updatedAt` *(75 rows both; P-002 correctly overdue 51d)*
- [x] Scoping proof: create a TAM user (Admin > Users or `POST /admin/users`), assign as TAM on exactly one project, log in as them → `/overview.portfolio` contains only that project *(tam.qa@solvro.local id 131 → sees only P-002)*
- [x] CHANGELOG entry under `[Unreleased]` (**Added** — shared `computePortfolioRows(where)` in `backend/src/lib/portfolio.ts` extracted from `reports.ts`, row gains `updatedAt`; `GET /overview` returns `portfolio` scoped by `projectVisibilityFilter`; why: real data for the Overview timeline)
- [x] Commit (conventional message, no Claude attribution) *(7c314d7)*

---

## Phase 2 — Frontend: types + shared PortfolioCalendar extraction

**Owner: Sonnet implementor (T2.1–T2.3 in one brief; orchestrator reviews).**

- [x] **T2.1 — Types in `frontend/src/lib/queries.ts`.** Rename `ExecutiveProjectRow` → `PortfolioProjectRow` (~L1292) and add `updatedAt: string` (only `Executive.tsx` imports the old name — no compat alias). Move the interface up next to the other overview types (~L175) with a comment noting it mirrors `backend/src/lib/portfolio.ts` (keep field order identical). Extend `OverviewResponse` with `portfolio: PortfolioProjectRow[]`.
  - *Acceptance*: no new hooks — `useOverview` already fetches it; `queryKeys.overview` is already invalidated on project/task mutations.
- [x] **T2.2 — Create `frontend/src/components/portfolio/PortfolioCalendar.tsx`.** Move **verbatim** from `Executive.tsx`: `MONTH_LABELS`, `MIN_BAR_WIDTH_PCT`, `clamp01`, `CALENDAR_TONE`, `barTone`, `CALENDAR_LEGEND` (~L332-367), the `PortfolioCalendar` component (~L369-555), and `fmtDate` (~L561-568 — **exported**, Executive's overdue table + list view still use it). Also `export function sortPortfolioRows(rows)` containing the comparator from `Executive.tsx:192-199` (overdue-first by `daysOverdue` desc → `end` asc → name). Component signature: `{ projects: PortfolioProjectRow[]; unscheduledNote?: (count: number) => string }`; the default reproduces the exact current Executive footnote copy (including singular/plural "ha(s/ve)").
  - *Acceptance*: the `unscheduledNote` prop is the **only** intentional JSX diff vs the moved code.
- [x] **T2.3 — Rewire `frontend/src/pages/Executive.tsx`.** Delete the moved code; import `PortfolioCalendar`, `sortPortfolioRows`, `fmtDate` from the new file; switch the type import to `PortfolioProjectRow`; `PortfolioTimelinesSection` calls `sortPortfolioRows` instead of its inline sort. View toggle, `PortfolioList`, overdue table untouched.
  - *Acceptance*: zero behavior change on the Executive page.

### QA gate 2 (orchestrator)
- [x] Diff review: extraction is verbatim — mechanically compare the added block against the deleted block; only diff = footnote prop *(scripted line-by-line comparison; all deltas sanctioned)*
- [x] `docker compose exec frontend npm run typecheck` green
- [x] Manual UI: Executive page identical to Phase-0 baseline *(no browser in this session — regression proven via byte-identical extraction + tsc + Vite module transforms 200 for all three files; visual spot-check deferred to user)*
- [x] `solvro-code-reviewer` agent run on the phase diff; real findings addressed *(PASS WITH NITS; changelog fixed; 3 suggestions were pre-existing verbatim-moved code, deliberately untouched per extraction rule, logged in CHANGELOG)*
- [x] CHANGELOG entry (**Changed** — `PortfolioCalendar` extracted verbatim from `Executive.tsx` into `frontend/src/components/portfolio/`; `ExecutiveProjectRow` → `PortfolioProjectRow` + `OverviewResponse.portfolio` in `queries.ts`; Executive behavior unchanged)
- [x] Commit *(a201108)*

---

## Phase 3 — Overview rewrite

**Owner: Sonnet implementor (T3.1–T3.5 in one brief; orchestrator reviews). All in `frontend/src/pages/Overview.tsx`.**

- [x] **T3.1 — Delete the fake chart.** Remove recharts imports, `buildSCurve` (L315-327), the `sCurve` const (L55), and the chart card (L93-146). recharts stays in `package.json` — `ProjectOverview.tsx` still uses it.
- [x] **T3.2 — New body layout.** *(deviation for the better, post-review: timeline renders as a bare section like Executive — the wrapper card double-bordered the calendar's own container)*
  1. KPI strip — unchanged.
  2. **Full-width card**: header **"Portfolio timeline"** + sub-copy ("Where each of your projects sits across the year"), then `<PortfolioCalendar projects={sortPortfolioRows(data.portfolio)} unscheduledNote={n => \`${n} project${n===1?"":"s"} ha${n===1?"s":"ve"} no scheduled dates.\`} />`. Empty state when `data.portfolio.length === 0`. Full width is deliberate: the calendar has `min-w-[720px]` + a `w-48` gutter and does not fit the old 2/3 slot without horizontal scroll.
  3. **Two-up row** (`grid gap-4 lg:grid-cols-3`): "Projects needing attention" in `lg:col-span-2` (its inner list is already `md:grid-cols-2`), "Recent activity" card in the remaining column.
- [x] **T3.3 — Attention strip on real data.** *(overdue label uses `text-chip-amber-text` token; local ProjectStatusPill replaced by canonical ProjectStatusChip per review)* Map `data.portfolio` (all visible projects, not the 5-capped `recentProjects`): sort `healthRank` asc → rank-0 ties by `daysOverdue` desc → others by `updatedAt` desc → `.slice(0, 6)`. Replace `p._count.tasks` with `p.totalTasks`; overdue rows get a small amber "Nd overdue" label. Empty state keys off `data.portfolio.length`. `ActivityFeed` keeps using `recentProjects`/`recentTasks` — keep those types/imports.
- [x] **T3.4 — Health helpers.** Rewrite `healthRank`/`healthColor` to take the row: rank 0 = `isOverdue` → amber `#F59E0B` (exactly what the TODO specifies); rank 1 = ACTIVE not overdue → `#8DC63F`; rank 2 = else → `#6B7280` (inline hex via `style` is this file's existing border pattern). Delete all three `TODO(health-signal)` comments; replace with one line noting the signal comes from `portfolio[].isOverdue`.
- [x] **T3.5 — SkeletonGrid.** Update (~L299-313) to mirror the new layout: full-width tall block + two-up row.

### QA gate 3 (orchestrator)
- [x] `docker compose exec frontend npm run typecheck` green (catches dead imports after chart removal)
- [x] Manual UI as admin *(no browser in this session: verified via live-API sort simulation — admin strip top-6 = P-001 92d, P-003 90d, P-002 51d amber first, then ACTIVE by recency; calendar gets 4 scheduled bars + 71-unscheduled footnote; Vite transform 200; visual eyeball deferred to user)*
- [x] Manual UI as the Phase-1 TAM user *(same method: tam.qa portfolio = only P-002, overdue 51d, footnote suppressed at count 0)*
- [x] Overdue scenario *(data layer proven: P-002 isOverdue/daysOverdue correct, ranks first with amber label; `queryKeys.overview` invalidation on task mutations verified in queries.ts; live no-reload check deferred to user)*
- [x] Edge cases: project with no dated tasks → excluded from calendar, counted in footnote (footnote guarded by `unscheduledCount > 0`); zero projects → `EmptyHint` renders in both sections
- [x] Mobile sanity at 375px: calendar scrolls inside its own `overflow-x-auto` + `min-w-[720px]` container; page body has no horizontal overflow trigger; new overdue label is `shrink-0 whitespace-nowrap`
- [x] `solvro-code-reviewer` (pass-with-nits) and `solvro-ui-reviewer` (fail → adjudicated) run; the 4 findings genuinely introduced by this diff were fixed (ProjectStatusChip swap, un-carded timeline section, overdue-label wrap protection, comparator hoist); pre-existing off-token findings logged in ISSUES.md instead of scope-creeping the diff
- [x] CHANGELOG entries (**Changed** — fake "Portfolio progress" S-curve replaced by real per-TAM Portfolio timeline; **Fixed** — TODO(health-signal) resolved, overdue projects rank first with amber)
- [x] Commit *(25a70ef)*

---

## Phase 4 — Full regression & handoff

**Owner: orchestrator.**

- [x] **T4.1 — Full re-run.** Both typechecks, `npm test`, Executive regression check, and the full QA-gate-3 UI checklist once more on the final code. *(backend+frontend tsc green; 32/32 tests; /reports/executive contract intact; /overview payload complete)*
- [x] **T4.2 — CHANGELOG audit.** Every touched file across all phases is accounted for under `[Unreleased]`; entries are append-only. *(scripted audit: 8/8 files OK)*
- [x] **T4.3 — Push.** Push `feat/overview-portfolio-timeline` to origin. *(pushed, tracking set)*
- [x] **T4.4 — PR draft.** Write a PR description draft (title, summary, screenshots-to-take list, test plan) into the final message.
- [x] **T4.5 — HARD STOP.** Do **not** open a PR into `develop` or any branch (no `gh pr create`). Report and wait for the user. *(no PR opened)*

### QA gate 4
- [x] All of Phase 4 checked; branch pushed; PR draft delivered; no PR opened

---

## Risks to watch

- **Executive drift during extraction** — mitigate with the verbatim-move rule and the mechanical added-vs-deleted block comparison in gate 2. This calendar had alignment regressions once before (see CHANGELOG ~2026-07-04) — do not restructure its header/track markup.
- **Type mirroring** — `backend/src/lib/portfolio.ts` and `queries.ts` are mirrored by hand (no codegen); keep field order identical and cross-reference comments on both sides.
- **Payload size for `project:view-all` users** — `/overview` now runs the org-wide row query for them; same single-findMany cost the executive endpoint already tolerates. Fine at current scale (sub-200ms NFR).
- **Stale references after deletion** — unused imports in `Overview.tsx` (recharts, possibly `TaskStatus`); the typecheck gate catches these.
