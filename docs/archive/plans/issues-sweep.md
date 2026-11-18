# Implementation Plan: Issues Sweep #1 — all four ledger batches

**Branch:** `fix/issues-sweep` — cut from `origin/develop` @ `8419402` (2026-08-02)
**Phase = branch = one PR into `develop`.** Tasks = commits. No commit/PR without explicit user approval.
**Source:** `docs/ISSUES.md` — user selected all four batches (2026-08-02). Every item cites a reviewer-verified ledger entry; implementors re-verify file:line on site (the tree may have drifted).

## Task List

### Wave 1 — parallel (disjoint files)

**T1 — Admin completion + lib type (frontend).** `pages/Admin.tsx` + `lib/tableSort.ts`.
Roles tab (`~:839`) and Project Overrides tab (`~:1438`) tables → DataGrid per the Phase 3 pilot conventions (recorded in `docs/archive/plans/reui-data-grid.md` Checkpoint B — pagination off, dense, `width:"auto"`, hairline wrapper, `meta.skeleton`, explicit `sortingFn` on strings, localeCompare for person names). This also resolves the tab-panel background inconsistency (ledger item: Users tab `surface-container-lowest` vs siblings `bg-surface`) — all three tabs land on the pilot's container. KPI zero-flash: em-dash the KPI values while `isLoading` (ledger options ruled: em-dash, not skeleton). `tableSort.ts`: generic `SortingFn<TData>` signature replacing `SortingFn<any>` + drop the inert eslint-disable.

**T2 — Alert callout sweep (frontend, wide).** The remaining `bg-error-container` ad-hoc callouts → vendored `<Alert variant="destructive">`, preserving each site's condition and copy exactly. EXCLUDES: chip/badge-style uses of the token that are not callouts (e.g. `RiskFormModal`'s `scoreClass` risk-score badge; judge each site — callout boxes only). Inventory at task start via grep; expect ~21 sites across pages/components per the ledger.

**T3 — Backend date boundaries (spine: `routes/tasks.ts`).** (a) `/tasks?overdue=true` (`~:91-94`): replace `dueDate < new Date()` with a UTC-calendar-day boundary (lt UTC midnight of the server's current day) matching the frontend contract. (b) `lib/portfolio.ts` (`~:46-47,74-80`): `startOfToday` local-midnight → UTC-midnight derivation for `isOverdue`/`daysOverdue`. Vitest for both (isolated test DB per backend/CLAUDE.md; boundary cases: due today ≠ overdue; due yesterday = overdue; TZ-independence). Instant opus review (spine).

### Wave 2 — parallel (disjoint files, after W1 integration)

**T4 — Vendored-file tail (spine, one instant review).** (a) Focus-ring unification tail: `ui/scroll-area.tsx:21`, `reui/autocomplete.tsx:27`, `reui/gantt/gantt-bar.tsx:293`, `reui/gantt/gantt-view.tsx:2279` — `ring-[3px] ring-ring/50` → the canonical `focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30` (prefix-adapted). (b) Shadow tail: `reui/gantt/gantt-view.tsx:3695`, `gantt-v2/SolvroBar.tsx:154,165` — strip per DESIGN.md §4. (c) `reui/filters.tsx` `addFilter` (~:2109-2116): idempotence guard — skip append when a chip with the same field+value exists (the duplicate-chip race's definitive fix). ALL SOLVRO PATCH'd; `gates.sh` patch counts WILL change — update `EXPECTED_FILTERS_PATCHES` (and any other affected counter) in the same task and say so. Gantt files are drag engines: no behavior change beyond focus/shadow classes; e2e `gantt-parity` re-run required.

**T5 — Remaining tables + prose overflow (frontend).** `components/services/ServiceCatalogueManager.tsx:152` and `pages/views/ProjectRisks.tsx:193` tables → DataGrid (pilot conventions; the risks table's `max-w-[28rem]` description cell gets the prose standard too). Prose-overflow sweep: `ProjectRisks.tsx:299,:446` + `ProjectTimeline.tsx` description — `whitespace-pre-wrap break-words` convention (GH #57).

**T6 — Palette/UX fixes (frontend).** (a) ⌘K toggle-close: `Shell.tsx` checks palette open state directly instead of inferring from `activeElement` tag. (b) Palette error state: destructure `error` in `CommandPalette.tsx` and render a distinct failure message (not "No results"); also clear the live query on close (the sub-debounce stale-reopen residual). (c) Shared ref-counted `useBodyScrollLock()` hook consumed by `Modal.tsx` + `CommandPalette.tsx`.

### Wave 3 — serial (infra; own gates run)

**T7 — Test infra + dead CSS + junk-data script.** (a) Backend vitest `globalSetup`: truncate all tables before each run against the isolated `solvro_test` DB (kills the accumulation flake class); document the isolated-DB invocation as the default in `backend/test/env.ts`'s comment if not already. (b) Delete the dead Network Diagram CSS block (`index.css` ~lines 294-471; grep-verify zero consumers first) — index.css touch ⇒ docs-keeper trigger. (c) Dev-DB cleanup: a REPORTING script first (counts of `Diag %`, `Timeline Check %`, `QA Fixture Co %`+`Gate %` fixture debris, junk test projects) — REPORT ONLY to the orchestrator; deletion runs only after user sign-off (live dev DB is not ours to prune silently).

### Phase close
- Instant reviews: T3 (backend spine) at W1; T4 (vendored spine) at W2. One full phase review after W3. CHANGELOG per item at each integration. docs-keeper (index.css trigger + ledger strikes — many entries resolve). Stage, draft commits + PR → STOP for approval.

## Risks
- T2's breadth: 21 sites across many files — collision risk with T1 (`Admin.tsx` has error callouts!). RULE: T2 skips `Admin.tsx`; T1 owns its own callouts.
- T4 touches three drag engines' files — classes only, but `gantt-parity`/`kanban-dnd` e2e re-runs are mandatory evidence.
- T7(a) changes test infra the gates themselves use — its gates run must come after, serial.
