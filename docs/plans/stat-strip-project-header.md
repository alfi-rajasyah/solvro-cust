# Stat strip and project header (2026-11-12)

Status: implemented on `feat/stat-strip-project-header`, reviewed, awaiting owner approval to commit.

Source: the three items left open by the antislop review of 2026-11-12 (`docs/archive/plans/antislop-port.md`): the stat tile row repeated on five pages, the project header's density, and the Gantt tree header label. Prototypes: Doop canvas `wIbMMkOajZ`, page "08 · Antislop prototypes" (Proposal 1, 2 and 3). The owner accepted all three on 2026-11-12.

## Owner decisions (2026-11-12)

- The stat strip replaces the stat tiles on all five pages: Overview, Project Overview, Daily Review, Utilization, Admin (Users tab).
- Project header: one line of facts with no uppercase labels; health shows problems only ("No baseline" and "0 open risks" are hidden when there is nothing to act on); Edit and Copy link move into the ⋯ menu.
- The Gantt tree's first column header reads "Task".

## Already in place (shared, do not edit)

- `frontend/src/components/StatStrip.tsx` and its test: `StatStrip` with `StatItem` (`key`, `value`, `of`, `label`, `detail`, `progress`, `progressTone`, `tone`, `to`, `ariaLabel`, `testId`). Read the file's header comment for the rules it holds.

## Design rules (from the accepted prototypes)

- One bordered row, hairline dividers, number then a sentence-case label. No corner icon, no uppercase label, no boxed tile.
- Colour on the number only, and only when the value asks for action and is above zero: `bad` for overdue, `warn` for pending users, unassigned hours and at-or-over capacity. A zero or a good state is plain.
- A stat that was a link stays a link with the same destination and accessible name.
- Every existing `data-testid` that a unit or e2e test reads keeps working: pass it as the item's `testId` (the number carries `<testId>-value`) or update the assertion in the same task.
- Labels are lower-case phrases that read after the number ("14 overdue tasks", "62% complete", "4 of 12 reviewed"). A stat with no number (Baseline) is label plus detail.

## Tasks (disjoint files, run in parallel)

- **Task A, top-level pages:** `frontend/src/pages/Overview.tsx`, `pages/Admin.tsx`, `pages/ProjectDetail.tsx`.
  - Overview: the three `Kpi` tiles become one `StatStrip` (overdue tasks, due this week, open risks) with the same links, hints as `detail`, and accessible names. Remove `Kpi`. Page order becomes: title row, strip, then "Projects needing attention" as the lead panel beside "Recent notes" from `lg:` up (attention about two thirds), then the portfolio timeline. Keep every panel's loading, empty and error state.
  - Admin, Users tab: the four tiles become one `StatStrip` (users, pending, custom roles, inactive). `warn` on pending when above zero.
  - ProjectDetail: Edit and Copy link move into the ⋯ menu as its first items at every width (today Edit is a button from `md:` and a menu item below it); the standalone Edit button and `CopyLinkButton` leave the header. The menu trigger is always shown when it has any item. Remaining header controls (members, Share, Outline link, ⋯, context toggle) share one 32px outlined style.
- **Task B, feature areas:** `frontend/src/pages/views/ProjectOverview.tsx`, `components/daily-review/StatsBar.tsx`, `components/utilization/UtilizationTiles.tsx`, `components/gantt-v2/SolvroGantt.tsx` (label only).
  - Project Overview: the four `Kpi` tiles become one `StatStrip` (tasks, complete with the progress bar, overdue, Baseline as a label-only stat with "not locked" or the lock date as detail). Remove `Kpi`.
  - Daily Review: `StatsBar` renders one `StatStrip` (reviewed, notes this week, updates, overdue tasks, open risks), keeping the five test ids.
  - Utilization: `UtilizationTiles` renders one `StatStrip` (logged with capacity and bar, customers touched, not tied to a customer), keeping its test ids.
  - Gantt: the tree's first column header reads "Task". Pass the label through the Gantt's i18n prop from `SolvroGantt.tsx` if the vendored component accepts one; do not edit `components/reui/`. `gantt-v2/` is on the spine list: this one string only.
- **Task C, shared components:** `frontend/src/components/ProjectHeaderFacts.tsx`, plus the copy-link menu item's needs in `components/CopyLinkButton.tsx` if a menu-item form is required.
  - Facts become one line from `md:` up: customer link(s), date range, "TAM <name>", progress bar with percent and count, then problems only: "Past end date" when the project is past its end date, "N overdue" when above zero, "N open risks" when above zero, and the baseline slip when a baseline exists and has slipped. No uppercase labels; each fact keeps an accessible name (sr-only label text). Nothing shown for "No baseline" or zero counts.
  - Phone layout keeps what it shows today (status, customer, progress), restyled to match.

Out of bounds for every task: `components/ui/`, `components/reui/`, `components/StatStrip.tsx` and its test, `index.css`, `lib/utils.ts`, every `CLAUDE.md`, `docs/`, `CHANGELOG.md` (report the entry text instead), `.claude/`.

Typecheck is one at a time in the frontend container. Use the lock:
`docker compose exec -T frontend sh -c 'while ! mkdir /tmp/tsc.lock 2>/dev/null; do sleep 5; done; npm run typecheck; rc=$?; rmdir /tmp/tsc.lock; exit $rc'`

## After the tasks

One full gates run, the phase review (the Gantt label touches a spine file), the full Playwright mobile project, the Delivery Gate recorded below, and a `docs/DESIGN.md` line for the stat strip.

## Delivery Gate

Run 2026-11-12 on the dev stack (`localhost:5174`), signed in as the admin. Scope: what this phase changed. Marketing-page rules have nothing to check here.

Design Read: an internal operations tool for TAMs, in the "Technical Precision" language of `docs/DESIGN.md`, dial ENERGY 1 / RHYTHM 1 / MOTION 1.

### Hard Gate

- R-02 PASS: `design-no-em-dash` passes; no em dash in the new strings.
- R-03 PASS: measured at 768, 1024, 1280 and 1440px and on iPhone 13 emulation: no horizontal overflow, no strip text clipped or spilling into the next cell on any of the five pages, the Overview attention list shows one project per row. Strip cells are 64px tall on phones.
- R-24, R-26 PASS: every stat that was a link keeps its destination ("overdue tasks" opens `/tasks?view=overdue`); the project actions menu lists Edit project, Copy link and Delete project, Edit opens its dialog, Copy link reports "Link copied" (e2e `deep-link.spec.ts`, real clipboard).
- R-25 PASS: number tones are the existing token pairs; the amber number on the hover ground is about 4.47:1 at 21px bold (large text).
- R-27 PASS: loading, empty and error states kept on every changed page (review). Deferred: the loading placeholders are bare pulse blocks (`docs/ISSUES.md`).
- R-32, R-39 PASS: strip is a named list of links with a visible inset focus ring; header facts keep visually hidden labels and "TAM" is read once; Overview link names start with their visible text.
- R-34 PASS: Overview and Project Overview checked in light and dark.
- R-35 PASS: click-through as above; desktop e2e on the 14 specs this phase touched: 85 passed, 2 skipped, 2 flaky that passed on retry. Full mobile project: 193 passed, 79 skipped, 2 flaky that passed on retry, 39 failed, all of them tests that cannot pass on this dev stack (frame headers need nginx, PWA needs the built app, auth specs assume Google sign-in is off, smoke trips on Google rejecting the dev origin). Not exercised by hand: drag and drop.
- R-36, R-38 PASS: no invented content; Help text describes the summary row and the actions menu as built.
- R-37 PASS: direction from `docs/DESIGN.md`; prototypes accepted by the owner on 2026-11-12.

### Purpose-Gate

- R-14 PASS: the identical boxed tiles are gone; one strip, used once per page, with the reason written in `docs/DESIGN.md` section 5.
- R-04 PASS: the corner icons on stats are removed (they repeated the label).
- R-06 PASS: no uppercase label on stats or header facts.
- R-01, R-12, R-13 PASS: no gradient, shadow or glow added.

### Liveliness

Dials held. Focal point: Overview now leads with "Projects needing attention"; the strip sits above it at 54px. One accent (green) unchanged; action colour only on numbers that need it.

### Craftsmanship and Quality Locks

- C-1 to C-5 PASS. R-05 PASS: the tile row that opened five pages is one compact row. R-31 PASS: reasons are in this plan, the changelog and `docs/DESIGN.md`.

Result: no FAIL.
