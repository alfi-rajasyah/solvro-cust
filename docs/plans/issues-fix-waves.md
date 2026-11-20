# docs/ISSUES.md: fix waves without user decisions

Status: planned (triage 2026-11-20 @ `5b283ea`)
Archive path: `docs/archive/plans/issues-fix-waves.md`

Triage of the open issues in `docs/ISSUES.md` (126 open). 45 can be fixed without a user decision; they are grouped into four waves of up to three streams with disjoint files. Each wave is one or more PRs into `develop`; spine files get the instant review.

## Waves

### Wave E: backend correctness

| Stream | Issues | Main files |
|---|---|---|
| E1 | ISS-203 (old TAM keeps tasks after a TAM change), ISS-017 (409 reveals a hidden customer's name) | `backend/src/routes/projects.ts` (spine), `backend/src/routes/customers.ts` |
| E2 | ISS-190 (slow status save gives a 500), ISS-032 (selects omit `isCriticalPath`) | `backend/src/lib/taskStatuses.ts`, search and portfolio task selects |
| E3 | ISS-033 (CORS `X-Total-Count`), ISS-011 (secretBox and webhook hardening), ISS-173 (iTop retry cap), ISS-184 (`solvro config` iTop keys) | `backend/src/app.ts`, `backend/src/lib/secretBox.ts`, `backend/src/lib/itop/scheduler.ts`, `setup.sh` (spine) |

### Wave F: frontend task views

| Stream | Issues | Main files |
|---|---|---|
| F1 | ISS-198 (title editor Escape and focus), ISS-200 (stale filter ids in the URL), ISS-201 (filter popover focus trap) | `TaskPanel.tsx`, `TaskFilterPopover.tsx`, `hooks/useTaskFilters.ts` |
| F2 | Gantt ISS-191, ISS-096, ISS-098, ISS-101, ISS-100, ISS-103, ISS-104; Excel blob URL ISS-133 | `gantt-v2/`, `reui/gantt/`, `lib/gantt/exportExcel.ts` (spine) |
| F3 | ISS-192 (inactive users in the epic owner picker), ISS-185 and ISS-062 (cache refreshes), ISS-020 (section color duplicated), ISS-024 (tab chunk preload) | `EpicPanel.tsx`, `lib/queries.ts` (spine), `lib/gantt/palette.ts`, `pages/ProjectDetail.tsx` |

### Wave G: polish and accessibility

| Stream | Issues | Main files |
|---|---|---|
| G1 | ISS-195, ISS-196, ISS-197 (Portfolio today line, pulse blocks, Admin chip and icons), ISS-042 (multi-line comment box), ISS-044 (PWA icons) | `PortfolioCalendar.tsx`, `ProjectOverview.tsx`, `Admin.tsx`, `CommentMentions.tsx`, `vite.config.ts` |
| G2 | ISS-081 (axe landmark, heading-order and nested-interactive gaps) | `e2e/tests/axe.spec.ts`, layout files |
| G3 | ISS-194 (P2 contrast in active states), ISS-091 (about 70 old `focus:border-primary` sites) | many files: runs last and alone |

### Wave H: tests and tooling

| Stream | Issues | Main files |
|---|---|---|
| H1 | ISS-162 (e2e with Google sign-in configured), ISS-199 (e2e login under load), ISS-153 (daily-review junk rows), ISS-156 (taskOrdering flake) | `e2e/fixtures/`, `e2e/tests/auth.spec.ts`, `e2e/tests/daily-review.spec.ts`, `backend/test/taskOrdering.test.ts` |
| H2 | Test gaps ISS-144, ISS-147, ISS-149, ISS-157, ISS-161 | `e2e/tests/`, backend tests |
| H3 | ISS-182, ISS-183 (typecheck gaps), ISS-168 (version test in the container), ISS-140 (gates e2e scope), ISS-171, ISS-172 (doc comments) | `tsconfig*.json`, `.claude/scripts/gates.sh`, `frontend/src/index.css` |

Order: E, F, G, H. G3 never runs alongside another stream (it touches many files). F3 is the only `queries.ts` writer in wave F.

## Needs a user decision (not in the waves)

- Decision-type issues: ISS-002, ISS-012, ISS-029, ISS-031, ISS-035, ISS-039, ISS-051, ISS-056, ISS-099, ISS-107, ISS-204.
- Choices: ISS-202 (filter subtasks on Kanban cards?), ISS-170 (theme default dark or system?), ISS-025 (show or clean up deleted-project activity records?), ISS-010 (self-host fonts? recommended).

## Large items to schedule separately

ISS-004 (zod 4), ISS-014 (React Router 7), ISS-018 (users pagination, touches every picker), ISS-143 (ESLint, a new tool), ISS-146 (fixed waits across the e2e suite).

## Not fixable now

About 50 `watch` items; most need a real iTop install (ISS-114 to ISS-127) or more evidence first.
