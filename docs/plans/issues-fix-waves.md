# docs/ISSUES.md: fix waves without user decisions

Status: in progress (triage 2026-11-20 @ `5b283ea`; waves E, F, G and H done 2026-11-20)
Archive path: `docs/archive/plans/issues-fix-waves.md`

Triage of the open issues in `docs/ISSUES.md` (126 open). 45 can be fixed without a user decision; they are grouped into four waves of up to three streams with disjoint files. Each wave is one or more PRs into `develop`; spine files get the instant review.

## Waves

### Wave E: backend correctness (done 2026-11-20)

Review: no blockers; fixed in one round (TAM-change activity wording, P2028 mapped to 409 only for expired or could-not-start transactions, INSTALL.md keys) plus a pre-existing iTop bug found in review (an incremental nudge cancelled a pending full-sync retry). Delivery Gate PASS 2026-11-20: the TAM-change activity line in light 1440 px and dark 375 px. Gates green; no frontend smoke ran on the first pass (backend-only), and the second run failed only on ISS-162.


| Stream | Issues | Main files |
|---|---|---|
| E1 | ISS-203 (old TAM keeps tasks after a TAM change) | `backend/src/routes/projects.ts` (spine) |
| E2 | ISS-190 (slow status save gives a 500) | `backend/src/lib/taskStatuses.ts`, `backend/src/http/errors.ts` |
| E3 | ISS-033 (CORS `X-Total-Count`), ISS-011 (GCM tag length and per-IP iTop webhook limit; key rotation stays open as ISS-011), ISS-173 (iTop retry cap), ISS-184 (`solvro config` iTop keys) | `backend/src/app.ts`, `backend/src/lib/secretBox.ts`, `backend/src/lib/itop/scheduler.ts`, `setup.sh` (spine) |

### Wave F: frontend task views (done 2026-11-20)

Review: one blocker (Done button focus ring) and should-fixes (milestone connector geometry, List assignee picker) fixed over two rounds; inactive-user filtering unified in `lib/assignableUsers.ts`; tab loaders single-sourced. Delivery Gate FAIL then PASS 2026-11-20: the first run caught `NaN` connector paths from the new milestone entry point (a spread `DOMRect`); fixed with a finite-rect fallback (ISS-205 tracks the missing e2e guard). Gates green except ISS-162.


| Stream | Issues | Main files |
|---|---|---|
| F1 | ISS-198 (title editor Escape and focus), ISS-200 (stale filter ids in the URL), ISS-201 (filter popover focus trap) | `TaskPanel.tsx`, `TaskFilterPopover.tsx`, `hooks/useTaskFilters.ts` |
| F2 | Gantt ISS-191, ISS-096, ISS-098, ISS-101, ISS-100; Excel blob URL ISS-133 | `gantt-v2/`, `reui/gantt/`, `lib/gantt/exportExcel.ts` (spine) |
| F3 | ISS-192 (inactive users in the epic owner picker), ISS-185 (service-list cache refresh), ISS-024 (tab chunk preload) | `EpicPanel.tsx`, `lib/queries.ts` (spine), `lib/gantt/palette.ts`, `pages/ProjectDetail.tsx` |

### Wave G: polish and accessibility (done 2026-11-20)

G1/G2 review: no blockers; seven should-fix items fixed in one round (Today marker two-tone contrast, legend swatch, Safari IME Enter, mention picker announcement, remaining heading-level gaps incl. task panel, Tickets board and share dialog, DESIGN.md whitelist), plus Modal/Drawer/notifications headers no longer counted as page landmarks. Delivery Gate PASS 2026-11-20: Portfolio Today marker, Project Overview, Risks status select, multi-line comment box (desktop Shift+Enter, phone Enter) in light and dark at 1440 and 375 px. A first phone run sent comments on Enter: a Playwright artefact (full-page screenshots reset touch emulation, so the page saw a fine pointer), not an app bug. Gates green except ISS-162.

G3 (run alone): all 69 old `focus:border-primary` sites aligned to the DESIGN.md treatment, a `design-focus-border` gate added, primary-tint text switched in 9 places (2 SOLVRO PATCHes in `reui/`), and a check of the selected states added to the axe spec. Review: 0 blockers; fixed in two rounds (bordered focus uses `outline-hidden` so forced-colours mode keeps an indicator, DESIGN.md updated to match; the axe steps now assert the active state). Delivery Gate PASS 2026-11-20: focus border on the risk form, active Filter on List and Kanban, Gantt today header, light and dark at 1440 and 375 px. Filed ISS-206, ISS-207, ISS-208.


| Stream | Issues | Main files |
|---|---|---|
| G1 | ISS-195, ISS-196, ISS-197 (Portfolio today line, pulse blocks, Admin chip; the icon sizes wait on ISS-056), ISS-042 (multi-line comment box), ISS-044 (PWA icons) | `PortfolioCalendar.tsx`, `ProjectOverview.tsx`, `Admin.tsx`, `CommentMentions.tsx`, `vite.config.ts` |
| G2 | ISS-081 (axe landmark, heading-order and nested-interactive gaps) | `e2e/tests/axe.spec.ts`, layout files |
| G3 | ISS-194 (P2 contrast in active states), ISS-091 (about 70 old `focus:border-primary` sites) | many files: runs last and alone |

### Wave H: tests and tooling (done 2026-11-20)

Three parallel streams. ISS-161 stayed out (its fix waits for realistic table sizes); ISS-205 joined H2. ISS-157: removing the task row lock made the original activity test fail only 2 of 3 runs, so both concurrency tests now use 8 racers and failed 5/5 without the lock. Review: no blockers; 4 should-fix items and 3 nits fixed in one round (changed specs now run for e2e-only diffs too; the connector, always-dark and reorder specs assert what they claim and clean up). Delivery Gate: not applicable, no visible change. Gates fully green, including the smoke spec with Google sign-in configured.

| Stream | Issues | Main files |
|---|---|---|
| H1 | ISS-162 (e2e with Google sign-in configured), ISS-199 (e2e login under load), ISS-153 (daily-review junk rows), ISS-156 (taskOrdering flake) | `e2e/fixtures/`, `e2e/tests/auth.spec.ts`, `e2e/tests/daily-review.spec.ts`, `backend/test/taskOrdering.test.ts` |
| H2 | Test gaps ISS-144, ISS-147, ISS-149, ISS-157, ISS-161 | `e2e/tests/`, backend tests |
| H3 | ISS-182, ISS-183 (typecheck gaps), ISS-168 (version test in the container), ISS-140 (gates e2e scope), ISS-171, ISS-172 (doc comments) | `tsconfig*.json`, `.claude/scripts/gates.sh`, `frontend/src/index.css` |

Order: E, F, G, H. G3 never runs alongside another stream (it touches many files). F3 is the only `queries.ts` writer in wave F.

## Needs a user decision (not in the waves)

- Decision-type issues: ISS-002, ISS-012, ISS-029, ISS-031, ISS-035, ISS-039, ISS-051, ISS-056, ISS-099, ISS-107, ISS-204.
- Moved out of wave F (2026-11-20): ISS-104 (readability-only refactor of spine code), ISS-103 (waits on the adapter signature lock), ISS-062 (act only if latency shows), ISS-020 (needs a shared package or a schema change).
- Moved out of wave E (2026-11-20): ISS-017 is a product choice (accept the 409, or scope customer-name uniqueness by visibility); ISS-032 is a watch item (no surface shows the mark there).
- Choices: ISS-202 (filter subtasks on Kanban cards?), ISS-170 (theme default dark or system?), ISS-025 (show or clean up deleted-project activity records?), ISS-010 (self-host fonts? recommended).

## Large items to schedule separately

ISS-004 (zod 4), ISS-014 (React Router 7), ISS-018 (users pagination, touches every picker), ISS-143 (ESLint, a new tool), ISS-146 (fixed waits across the e2e suite).

## Not fixable now

About 50 `watch` items; most need a real iTop install (ISS-114 to ISS-127) or more evidence first.
