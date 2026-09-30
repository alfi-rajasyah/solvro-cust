# UI/UX professional pass — orchestrator progress log

Resume point for the orchestrator after a usage-limit pause or context reset.
Plan: `docs/plans/ui-ux-professional-pass.md` · Brief: `docs/plans/ui-ux-implementor-brief.md`
Doc: https://claude.ai/code/artifact/0a48762a-b62c-432f-bb60-4fecbedf3dfd
User direction (2026-09-29): one PR for all phases; maximise safe parallelism; no commit until the end;
live QA with screenshots (report as an artifact) BEFORE committing; commit + PR only on user approval.

## Batches (max 3 implementors at once)
| Batch | Tasks | Status |
|---|---|---|
| A | P1-1 (a91bd62371c6307b4), P1-2 (a360c4744b52cb766), P1-5 (a6bae431187b45592) | running since 03:45 UTC |
| B | P1-3, P1-4, P1-6 | pending |
| C | P1-7→P1-8 (one agent), P2-1, P2-5 | pending |
| — | gates + Phase 1 review + spine review (P1-4, P2-1, P2-5) | pending |
| D | P2-2, P2-3, P2-4 | pending |
| E | P2-7, P2-8, P2-9 | pending |
| F | P2-6, P2-10, P3-5 | pending |
| — | gates + Phase 2 review (+ spine P2-10, P3-5) | pending |
| G | P3-1, P3-2, P3-4; P3-3 via the P2-3 agent | pending |
| — | gates + Phase 3 review + docs-keeper + full e2e | pending |
| QA | live walkthrough, screenshots, artifact report | pending |
| Commit | stage all, draft message, wait for user approval | pending |

## Pending CHANGELOG entries (appended by the orchestrator at integration)
- [P1-2] Added **`frontend/src/lib/formatDate.ts`**, a shared date formatter that shows day-first, 24-hour dates (`28 Sep`, `22 – 28 Aug`, `Monday 28 September 2026`, `28 Sep, 14:22`, `5 min ago`). It formats calendar days in UTC, so a task date no longer shows as the previous day west of Greenwich, and formats timestamps in local time; it replaces the scattered per-screen date helpers.

- [P1-4] Changed: the Gantt tree's Dates column and the baseline-locked time now use the shared day-first format — `21 Aug`, `22 – 28 Aug`, `28 Sep, 14:22` — in the body font instead of monospace, so Gantt dates read like the rest of the app (**`frontend/src/lib/gantt/geometry.ts`**, **`frontend/src/components/gantt-v2/TreeCells.tsx`**, **`frontend/src/components/gantt-v2/SolvroGantt.tsx`**).

- [P1-5] Changed: buttons, link-buttons and tabs now use sentence case instead of uppercase with letter-spacing (**`frontend/src/components/Tabs.tsx`** and pages and dialogs across the app); the label picker's "+ Label" is now "Add label". **`ConfirmModal`** gains a `danger` tone (error colours) used by every delete confirmation, and deleting a project or a customer now uses the in-app confirmation dialog instead of the browser's native `confirm()`, with the same wording. The remaining browser `confirm()` prompts (task-form delete, service and section delete, user and role delete, password reset, Google sign-in disconnect) now use the in-app dialog too. Dialogs now move focus into themselves when opened (Cancel first on confirmations), keep Tab inside while open, and return focus to the triggering control on close (**`frontend/src/components/Modal.tsx`**, **`frontend/src/hooks/useDialogFocus.ts`**).

- [P1-1] Changed: status, priority, risk and project-status wording is now the same everywhere — To do · In progress · Done; Low · Medium · High · Urgent; Open · Mitigated · Closed; Planning · Active · On hold · Completed · Cancelled — through a new **`frontend/src/lib/labels.ts`** that replaces about 15 duplicated label maps and raw enum text (such as "IN PROGRESS", "ON HOLD", "MEDIUM") across task, risk, Kanban, Gantt-legend and export surfaces; the Daily Review status selects now show their labels instead of the stored value.

- [P1-6] Changed: top-bar titles and breadcrumbs now come from one route map (**`frontend/src/lib/routeMeta.ts`**, used by **`frontend/src/components/layout/TopBar.tsx`**), so no page falls back to "Solvro" and Projects reads "Projects" like its heading. Project pages show `Projects / customer / project` with the status chip, customer pages show `Customers / name`, long crumbs truncate, and below the `md` breakpoint only the current page shows; the redundant "Customers" back link on **`frontend/src/pages/CustomerDetail.tsx`** is gone.

- [P1-7] Added: a `text-meta` type role (12px, weight 500, line-height 1.35) in **`frontend/src/index.css`**, registered in the class merger in **`frontend/src/lib/utils.ts`** and documented in **`docs/DESIGN.md`**; status, priority, label and epic chips use it instead of a hard-coded 11px. Person names and emails on the Customers, Settings and Admin pages, and the stat counters on Daily Review, Overview, customer detail and Admin, now use the body font (counters with tabular digits), leaving monospace for IDs and code.

- [P2-4] Changed: label and epic chips show the user's colour as a small dot on a 14% tint with regular text colour instead of a solid coloured pill (**`frontend/src/components/LabelChip.tsx`**, **`frontend/src/components/EpicChip.tsx`**), so text stays readable in light and dark themes for any stored colour; the label colour picker no longer offers red, so a label never reads as an error (**`frontend/src/components/LabelPicker.tsx`**). Existing labels keep their colour.

- [P1-3] Changed: dates across the app now use one day-first formatter — `21 Aug`, `22 – 28 Aug`, `28 Sep, 14:22`, 24-hour time — replacing per-screen `toLocaleDateString` calls, duplicated month lists and relative-time helpers (**`frontend/src/pages/`**, **`frontend/src/components/`**, **`frontend/src/lib/`**). Due dates on Kanban cards, List rows and the Tasks page read `Today`, `Tomorrow` or `Nd late`, finished tasks never read late, and task dates no longer show the previous day for users west of UTC.

- [P2-1] Added: project lists and details now carry a `health` block — task progress, overdue count, open-risk count, and start and end dates taken from the tasks — on `GET /projects`, `GET /projects/:id` (plus schedule slip in days) and the projects nested in `GET /customers/:id`, each accepting an optional `today` day (**`backend/src/routes/projects.ts`**, **`backend/src/routes/customers.ts`**). It is computed in four batched queries by the new **`backend/src/lib/projectHealth.ts`**, which also now holds the slip and phase helpers shared with Daily Review; **`frontend/src/lib/queries.ts`** types the block and refreshes project and customer data after task and risk changes.

- [P3-4] Added: an "Actions" group in the ⌘K command palette — "New project", "New customer" and, on a project page, "Add task" — each shown only to users with the matching permission and opening the page's create form through a one-shot `?new=` link, so creating something no longer means navigating to the right page first (**`frontend/src/components/CommandPalette.tsx`**, **`frontend/src/lib/paletteActions.ts`**, **`frontend/src/hooks/useNewParam.ts`**).

- [P1-8] Changed: every hard-coded 9, 10 and 11px text size across **`frontend/src`** (pages, task and epic panels, Kanban, Gantt labels, Daily Review, iTop and layout components) now uses the shared type roles — `text-meta` for chips, links, counts and captions, `text-label-caps` for uppercase micro-labels, `text-xs` for helper and error text — so small text is at least 12px and consistent across screens.

- [P2-3] Changed: the project page header now shows a facts row — customer, dates, TAM, a progress bar and health (overdue tasks, schedule slip, open risks) — and moves "Delete project" into a ⋯ actions menu so the destructive action is out of the main button row; the Context button is now an icon toggle (**`frontend/src/components/ProjectHeaderFacts.tsx`**, **`frontend/src/pages/ProjectDetail.tsx`**, with Playwright coverage in **`e2e/tests/project-header.spec.ts`**).

- [P2-2] Changed: Kanban cards show the due date — `Today`, `Tomorrow`, or a red `Nd late` when overdue, the plain day for finished tasks — instead of an "N Days" duration; the comment count hides at zero, the Medium priority badge is hidden, the Critical Path mark is a compact icon with a tooltip, and the drag grip shows on hover or focus on desktop while staying visible on touch, so cards carry fewer marks and scan faster (**`frontend/src/components/kanban-v2/cards.tsx`**).

- [P2-5] Added: `GET /tasks` accepts `open`, `dueFrom`, `dueTo` and `sort` (`position` or `due`), its filters now combine instead of overwriting each other, and the response carries an `X-Total-Count` header with the full match count (**`backend/src/routes/tasks.ts`**); `GET /overview` returns `workCounts` — overdue, due this week, open risks (**`backend/src/routes/overview.ts`**); **`frontend/src/lib/queries.ts`** and **`frontend/src/lib/api.ts`** send the new filters and expose the total.

- [P2-8] Changed: project cards on the Projects page show a progress bar with percentage and task counts ("No tasks yet" for empty projects), overdue and open-risk chips when non-zero, a "Baseline locked" marker and the project's date range, so project health is visible without opening each project (**`frontend/src/pages/Projects.tsx`**).

- [P2-7] Added: saved views on the Tasks page — All open, My open, Overdue, This week, All — synced to `?view=` so each view has a shareable address; the page now opens on open work sorted by due date, the Overdue view replaces the "Overdue only" checkbox, and "Showing N of TOTAL" appears when more tasks match than the 200 loaded (**`frontend/src/pages/Tasks.tsx`**).

- [P2-9] Changed: the customer page is now an account page (**`frontend/src/pages/CustomerDetail.tsx`**, **`frontend/src/components/customer/AccountHeader.tsx`**, **`frontend/src/components/customer/AccountOverview.tsx`**): a header strip shows the name, AM / SA / TAM / iTop org and a one-line health roll-up (active projects, overdue tasks, open risks, latest weekly update) with Edit and a ⋯ menu holding Delete; the Overview tab lists the customer's projects with status, progress, health and dates, the latest weekly update (earlier weeks on demand), recent customer notes (new `useCustomerNotes` hook in **`frontend/src/lib/queries.ts`**) and a collapsed profile. The placeholder Topology, Organization Structure and Documents tabs, the "Soon" sections and the success banner are gone, and "Active projects" now counts only active projects.

- [P3-1] Added: loading skeletons — table, card-grid, board and project-page placeholders with a 150 ms delay so fast loads don't flash (**`frontend/src/components/skeletons/`**) — replace the grey blocks in the Epics, Kanban, Gantt and project-detail views, and give the project Services tab and the iTop token section in Settings a loading state they lacked.

- [P2-6] Changed: the Overview opens with a slim header and today's date and three linked tiles — Overdue (error tone when above zero) opens the Overdue tasks view, Due this week opens the This-week view, Open risks opens the Daily Review; "Projects needing attention" moves above the portfolio timeline with overdue-task and open-risk counts per project, row accents use design tokens instead of hard-coded colours, and portfolio timeline rows are compacted to 32px on both Overview and Executive (**`frontend/src/pages/Overview.tsx`**, **`frontend/src/components/portfolio/PortfolioCalendar.tsx`**, Help text in **`frontend/src/lib/helpContent.ts`**).

- [P3-5] Added: `GET /overview/badges` returns `dailyReviewPending` — how many of the caller's Daily Review customers still have an active project not reviewed today — using one scope helper shared with the Daily Review page so the two can never disagree (**`backend/src/lib/dailyReviewScope.ts`**, **`backend/src/routes/overview.ts`**); a `useNavBadges()` hook in **`frontend/src/lib/queries.ts`** refreshes when a project is marked or unmarked as reviewed.

- [P3-3] Changed: on phones the project page keeps the project name in the top bar, the facts row collapses to status, customer and progress, Edit and the Context toggle move into the ⋯ actions menu, and the tab row gets a right-edge scroll fade, freeing vertical space at 375px (**`frontend/src/pages/ProjectDetail.tsx`**, **`frontend/src/components/ProjectHeaderFacts.tsx`**, mobile check in **`e2e/tests/project-header.spec.ts`**).

- [P2-10] Changed: the Customers list is a sortable table — Customer, AM, TAM, Projects, Overdue, Risks, Weekly update — with a row menu for Edit and Delete, replacing the card grid (**`frontend/src/pages/Customers.tsx`**); `GET /customers` returns a `health` block per customer — overdue tasks and open risks summed over the projects the caller can see, plus this week's weekly-update status — and accepts an optional `today` (**`backend/src/routes/customers.ts`**).

- [P3-2] Changed: the sidebar is grouped into Workspace, Cadence, Insights and System — group labels when expanded, dividers when collapsed — with a pending-review count on Daily Review and an instant tooltip on collapsed items; it starts expanded on screens 1280px and wider, remembers the user's choice across reloads, and no longer collapses when a link is clicked on desktop, while the mobile drawer still closes on link click (**`frontend/src/components/layout/Sidebar.tsx`**, **`frontend/src/components/layout/SidebarContext.tsx`**, **`frontend/src/lib/navCommands.ts`**, **`frontend/src/components/ui/tooltip.tsx`**).

## Notes
- P1-4 note: one-sided ranges now read `From …`/`Until …`; empty range `No dates` (check width in QA). Run date-picker.spec (613, 843) + gantt-parity at batch integration.
- P1-5 follow-up (send to agent a6bae431187b45592 after P1-1 ends): convert remaining native confirm() — TaskFormModal.tsx:246, ServiceCatalogueManager.tsx:265, ProjectList.tsx:259, Admin.tsx x5 — to ConfirmModal danger. Spine: DateField.tsx/DateRangeField.tsx class-only edits need instant review. E2E to run: search, epics, subtask-edit, gantt-parity, customer-visibility, task-form-labels.
- P1-1 done. E2E to run: list-dnd, kanban-dnd, gantt-legend, filters-duplicate-chip, daily-review. Leftover: CustomerDetail.tsx:753 raw weekly-update category enum (give to P1-1 agent a91bd62371c6307b4 later).
- P1-6 done. E2E to run: search, smoke. Mobile: status chip hidden below md in TopBar — P3-3 must restore it in the mobile header.
- P1-5 follow-up done (no native confirm left). Extra e2e: flows deleting a task from the task-form drawer; admin specs if any.
- P1-7 done (agent a18953316936f3f8c waits for P1-8 follow-up after P1-3). QA: chips keep font-semibold (600) — check rendered weight.
- P2-4 done. E2E: task-form-labels, kanban-dnd. lib/contrast.ts pickContrast now unused (review decides).
- P1-3 done; fix round sent (Done tasks 'late' in ProjectList + Kanban no-start fallback; dueDateLabel/formatDate tests time bomb). E2E: date-picker, utilization, weekly-sync, daily-review.
- P1-3 fix round done. P1-8 sent to a18953316936f3f8c.
- P2-1 done (agent a66b65f7a68291231). Timing GET /projects 5–11 ms; health ~+1 ms in-process. Spine: routes/projects.ts, lib/queries.ts.
- P3-4 done. E2E: search.spec (group order Pages, Actions).
- P1-8 done (56 files). QA eyeball: PortfolioCalendar today badge 12px bold, AssigneeAvatar xs initials 12px, SolvroBar Gantt label fit, uppercase labels now bold. Spine: gantt-v2 SolvroBar/SolvroGantt/TreeCells class changes.
- PHASE 1 COMPLETE (all P1 tasks).
- P2-3 done (agent a6bcc010d206bb7ab — reuse for P3-3). Lock baseline/Export stay in Context panel (not reachable). E2E: gantt-parity 426-433, smoke, project-header (new).
- P2-2 done. E2E: kanban-dnd, critical-path, smoke.
- P2-5 done. useTasksWithTotal(filter) → {tasks,total}. Spine: tasks.ts, queries.ts — needs instant review (add to phase-2 review). CORS exposedHeaders not set (same-origin proxy OK).
- P2-8 done. E2E: projects-list (new), customer-visibility.
- P2-7 done. E2E: tasks-views (new), filters-duplicate-chip, kanban-dnd 926-1000. Tabs component lacks aria-current (review may flag).
- P2-9 done (agent aad3eee33754f982a); fix round sent: invalidate customer notes on note mutations. E2E: customer-account (new), itop-tickets, itop-board, itop-ticket-panel, itop-timer, customer-visibility, daily-review.
- P3-1 done. Spine: SolvroGantt one-line swap. E2E: epics, kanban-dnd, smoke.
- P2-9 fix done: customer-note mutations invalidate account notes (fold into P2-9 entry: done in text already implied).
- P2-6 done; helpContent Overview text fixed by orchestrator. E2E: overview (new), daily-review ~316, smoke. P3-3 sent to a6bcc010d206bb7ab.
- P3-5 done (3 queries; excludes no-customer projects). Spine: queries.ts.
- P3-3 done. E2E: smoke (mobile), kanban-dnd 1160, gantt-parity 426-433, project-header (both).
- PHASE 1 REVIEW done (a07b92e04f38178b8). Fix queue (send as slots free; continue owning agents):
  1. [done] BLOCKER date-picker.spec parse → P1-3 a2ea34bf270f9250f
  2. [done] invalidateProjectHealth prefix too wide (queries.ts:838 + duplicate hooks; customers prefix too) → P2-1 a66b65f7a68291231
  3. [done] Modal.tsx: initial focus, focus trap, focus return → P1-5 a6bae431187b45592
  4. [done] paired button size mismatch (LabelPicker 111/122, SolvroGantt 1386/1396, ProjectList 579/589 & 719/723 → text-xs font-semibold) + nit 8 SolvroGantt 1223 redundant classes → P1-8 a18953316936f3f8c
  5. [done] fmtTime HH:mm (ProjectCard TIME_FMT, DailyItopStrip:61, Utilization:27) + nit 6 fmtRange year for non-current-year same-year range → P1-2 a360c4744b52cb766
  6. [closed — not a bug: category is free text]
  7. [docs-keeper at end] DESIGN.md :222 font-mono Gantt dates stale; :320 "no 12px body token" stale
- P2-10 done (5 queries). TODO in QA: time GET /customers on dev stack. Spine: queries.ts (phase-2 review). E2E: customer-visibility, search 302-314.
- P3-2 done. ALL 23 TASKS IMPLEMENTED. Risk: sidebar expanded at 1440 narrows main by 196px — watch kanban-dnd/gantt coordinates in e2e. E2E: sidebar (new), search, smoke.
- Phase 2-3 review running (abaff9b3004a4e031).
- CHANGELOG.md: section appended (23 bullets) by orchestrator; later fix sentences already merged in log (P1-5). Re-sync if more fix sentences arrive.
- All phase-1 review fixes done. Next: gates.sh, then phase 2-3 review fixes, full e2e, QA (.qa-walkthrough.mjs in e2e/, delete after).
- PHASE 2-3 REVIEW done (abaff9b3004a4e031). Fix queue:
  A [done] P2-9 aad3eee: #1 BLOCKER customer-account pct text, #3 weekly-update list invalidation, #9 WEEKLY_STATUS_LABEL → labels.ts, #10 customerNotesRoot key
  B [done] P2-5 a1c99c84: #2 workCounts align with /tasks views (top-level, GET /tasks scope) + open risks = daily-review scope
  C [done] P2-2 ad59d440: #6 grip pointer-fine, #8 isTaskOverdue → formatDate
  D [done] P3-2 a1a2bf34: #4 sidebar group label text-on-surface-variant, #5 Tabs aria-pressed/aria-current
  E [done] P3-4 aabfbe52: #11 paletteActions merge ?new into existing search
  F [done] P2-3 a6bcc010: #12 slip "N d ahead" + prettier
  G [done] P2-10 a82859f9: #14 Customers SkeletonRows → TableSkeleton
  H [docs-keeper] #7 DESIGN.md §4 whitelist add ProjectDetail/Customers/AccountHeader menus (+ note SolvroKanban 130/490 pre-existing); §2 Gantt mono stale; 12px token note stale
  I [left] #13 pickContrast unused — keep (not deleting without user approval)
- Full e2e running in background (b63frqsu7) during fixes; rerun failures after fixes.
- E2E run 1 (04:31): 186 pass, 8 fail (pwa x4 by design on dev; customer-account x3 spec; itop-tickets h1 dup from sidebar brand), 6 flaky (date-picker Jakarta, gantt-parity connector, itop-task-ref x2, list-dnd cross-status, kanban mobile touch). Fixes sent: aad3eee (spec), a1a2bf34 (sidebar h1). Then rerun failed+flaky specs.
- LIVE QA run 1 (after demo reseed): 38 steps, 0 console errors, 0 failed API, 0 overflow. Backend timings 5–21 ms (Playwright client adds ~300 ms locally). Visual defects found → fixes:
  Q1 [done a6bcc010] header facts row overlap when task panel open
  Q2 [done aabfbe52] ⌘K list overflows popup (Add task below border)
  Q3 [done a18953316] Daily Review: raw RED health, NO BASELINE caps, risk chips raw colours/mono, "0 / 3" → "0 of 3", mono day labels
  Q4 [done a1a2bf34] collapsed-sidebar tooltip clipped by rail
  Q5 [done, DateRangeField emptyLabel = spine → review] TaskFormModal Spec K: placeholders ("Pick start and due", "Top level", "No section"), "Critical path", neutral Medium colour — keep FieldRow DOM + native selects
  Note (report only): Kanban desktop card title indent from invisible grip space.
- QA-fix review: 0 blockers; 2 nits fixed by orchestrator (TaskFormModal HIGH amber; DateRangeField empty trigger muted). gates3 17/17 PASS. Full e2e run 3 started (b-bg) → then reseed demo + QA run 2 + artifact report.
- RESUME POINT (container restart during e2e run 3; user at 99% of 5-hr limit). Code COMPLETE, gates3 17/17 PASS, QA-fix review clean + 2 nits fixed.
  Remaining, in order:
  1. Full e2e rerun (BASE_URL=http://localhost:5173 npx playwright test) — expect pwa x4 fail by design; DnD flakes known.
  2. Reseed demo: docker compose exec -T -e DEMO_SEED_CONFIRM=wipe backend npx tsx scripts/seed-demo.ts; then recreate qa@solvro.test (create-admin.ts, QaTest1234!).
  3. QA run 2: cd e2e && OUT=<scratchpad>/qa BASE_URL=http://localhost:5173 node .qa-walkthrough.mjs (run-1 shots saved in scratchpad/qa-run1 if scratchpad survived).
  4. Convert PNG→JPG, build report: scratchpad/build_report.py <qa_dir> <out_dir> <facts.json>; publish via Artifact (icon "checklist"); before/ = run-1 ids 08-task-panel, 23-palette, 16-daily-review, 03-sidebar-collapsed, 09-task-form.
  5. Delete e2e/.qa-walkthrough.mjs; TaskStop agents; stage all; draft commit msg (no AI attribution); wait for user approval.
- 05:50 UTC: scratchpad was wiped by the restart (qa-run1 before-shots, logs, builder lost). Moved all QA outputs to docs/plans/qa-run/ (local-only). build_report.py recreated there (no before/after pairs). e2e run 3 restarted in background → docs/plans/qa-run/e2e3.log.
