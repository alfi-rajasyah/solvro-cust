# Migration Roadmap: ReUI Components Across Solvro

**This is a program roadmap, not a phase plan.** Each phase below = one branch cut from up-to-date `origin/develop` (`git fetch origin` first) = one PR into `develop`. Each phase gets its own task-level plan doc at phase start, in the format of `docs/plans/vendored-reui-sortable.md` (waves, acceptance criteria, gates). No commit or PR without explicit user approval.

**Idea doc:** `docs/ideas/reui-component-migration.md` — component→surface map, decision gates, not-doing list. Settled there ≠ re-asked here.

## Sequencing rationale

Cheapest and safest first. Phases 1–2 have **zero new npm deps** and prove the theming bridge on presentation components before anything load-bearing moves. Phase 3 (data-grid) is the biggest win but sits behind a user dep-gate, so it goes after the pattern is proven. Phase 4 is a decision-driven cleanup. The `feat/reui-sortable` phase shipped independently (PR #115, merged to `develop`); Phase 1 branches from its result. Facts re-verified 2026-07-31 against `develop` @ `4ca8f75` — only `gantt-v2/SolvroGantt.tsx` and `lib/gantt/exportPdf.ts` changed since, both out of migration scope.

## Phase 1 — Presentation set (S)

- **Vendors:** `reui/timeline.tsx`, `reui/alert.tsx`, `reui/frame.tsx`, `reui/icon-tile.tsx`, `reui/icon-stack.tsx`.
- **Surfaces:** `EmptyState.tsx` rebuilt on frame + icon-tile/icon-stack; `pages/views/ProjectTimeline.tsx` restyled on timeline; alert wired into `InstallBanner.tsx` + form-error callouts (inventory call sites in the phase plan).
- **New npm deps:** none (`@base-ui/react` only — verified 2026-07-30).
- **Proves:** CLI pull procedure, radix audit, semantic-bridge theming vs `docs/DESIGN.md`, `// SOLVRO PATCH` flow.
- **Watch:** icons stay `material-symbols-outlined` in app chrome; Timeline tab migrates in place (guardrail).

## Phase 2 — Filters toolbar (M)

- **Vendors:** `reui/filters.tsx` + new `ui/` primitives its registry pulls (button-group, input, input-group, kbd — Base-UI, themed on landing).
- **Surfaces:** `Tasks.tsx` toolbar first, then `Projects.tsx` list filtering.
- **New npm deps:** none (`@base-ui/react`, `class-variance-authority` — both present).
- **Watch:** CLI must not clobber the 8 existing `ui/` files — diff every pulled primitive against the existing Base-UI version; filter state stays in existing per-view state, no URL schema changes.

## Phase 3 — Data-grid tables (L) — **gated**

- **Gate (user, before branch cut):** approve deps `@tanstack/react-table`, `@tanstack/react-virtual`, `@dnd-kit/modifiers` + the Guardrails wording edit for the dnd-kit sanctioned list. No approval → phase is dropped, tables stay bespoke.
- **Vendors:** `reui/data-grid/` + registry primitives not yet present (select, separator, skeleton, spinner, badge — badge arrives here regardless of the Phase 4 decision).
- **Surfaces, in order:** `Tasks.tsx` (hidden route — pilot, zero user-visible blast radius) → `Customers.tsx` → `Admin.tsx` → `CustomerDetail.tsx`. One task per page; pilot merges review-clean before the visible pages start.
- **Watch:** 375px behavior per page (sticky header + `DataGridScrollArea`, or an explicit `md:` fallback); server-state stays in `lib/queries.ts` hooks — the grid receives data, it never fetches; `docker compose exec frontend npm install` after `package.json` changes (named-volume trap).

## Phase 4 — Badge decision + leftovers — **CLOSED 2026-08-01**

- **Gate 2 RESOLVED (user):** chips stay bespoke — recorded as a Standing decision in root CLAUDE.md. No rebase, ever, absent a new user gate.
- **Straggler sweep:** resolved as RECORD — the full inventory lives in `docs/ISSUES.md` (ReUI Filters + Data Grid phase sections): 4 remaining hand-rolled tables (Admin's two sub-tab tables are the named high-value follow-up), the 21-site alert-callout remainder, old focus/shadow-style survivors in `scroll-area`/`autocomplete`/gantt files, and the stat-card `Frame` evaluation. Each is a future one-off task, not a phase.
- **Deferred items stay deferred:** `stepper` until the Secure Ingestion Port UI is specced; `event-calendar` unless a calendar surface is ever specced.

## PROGRAM COMPLETE (2026-08-01)

Three shipped phases (PRs #123, #125, #127 → releases #124, #126, #128). End state: **12 of 20 catalog components vendored** — gantt, kanban, sortable, autocomplete (pre-program) + timeline, alert, frame, icon-tile, icon-stack (P1) + filters (P2) + data-grid family, badge (P3) — plus 10 supporting `ui/` primitives, 3 approved npm deps, the app-wide focus-style unification, and the class-merger fix. Not vendored, by decision: date-selector, tree, number-field, phone-input, rating, scrollspy (dropped); stepper, event-calendar (deferred). `icon-stack` remains vendored-but-unconsumed.

## Cross-phase vendor procedure (every pull)

1. `npx shadcn@latest add @reui/<name>` from `frontend/`; final paths under `components/reui/` and `components/ui/` are non-negotiable — move by hand if the CLI misplaces.
2. Audit: `grep -ri radix` empty; `package.json` diff exactly as the phase plan predicts (Phases 1–2: byte-identical); `components.json` unchanged.
3. Theme via the shadcn semantic bridge `@theme inline` block — new tokens go in `index.css`, never hex in components (touching `index.css` ⇒ docs-keeper trigger at phase close).
4. Mark every hand edit `// SOLVRO PATCH`; re-pulls strip local edits.
5. `reui/` is spine ⇒ instant opus review per vendor task; gates run once per wave at integration, orchestrator-owned.

## Risks

- **Theming drift:** ReUI defaults may fight Technical Precision (radius, shadows, density). Phase 1 exists to surface this cheaply; patches get `// SOLVRO PATCH` and phase-review eyes.
- **Registry drift:** dep lists verified 2026-07-30 via the ReUI MCP registry; re-verify at each phase start before promising an empty `package.json` diff.
- **Primitive clobbering:** pulled `ui/` primitives may collide with the 8 existing Base-UI files; every collision is a hand-merge, never an overwrite.
- **Mobile regressions:** tables and filters are density-heavy; every migrated surface re-checks 375px (frontend/CLAUDE.md).
- **Scope creep:** "most of the UI/UX" excludes the engines — `kanban-v2/`, `gantt-v2/`, ProjectList drag, and the date stack are out by decision, not by omission.
