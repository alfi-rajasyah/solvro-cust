# UI/UX professional pass — spec and task plan

> Repo copy (2026-09-29) of the "Implementation spec and plan" tab in the Claude doc "Solvro — UI/UX Review & Proposal" (https://claude.ai/code/artifact/0a48762a-b62c-432f-bb60-4fecbedf3dfd). The review tab there holds the 20 findings and the 15 before/after drawings (A–O) this plan refers to. Status: all decisions resolved 2026-09-29 (see "Resolved decisions"); ready to start Phase 1 wave 1 on the user's go.

## Scope and assumptions

This tab turns the 20 findings and the 15 before/after drawings in the review tab into a buildable spec and an ordered task plan. The work runs in three phases, all on the current branch in this worktree, committed together on your approval and then PRed into `develop`; no Prisma schema change and no migration.

**In scope**

- Frontend: shared label, date and button foundations; the 15 screens A–O; loading skeletons; navigation.
- Backend: additive, read-only fields and query filters on existing GET endpoints (projects, customers, tasks). No new tables, no write paths.

**Out of scope**

- Visual system changes: tokens, colours, radii, fonts and the elevation rules in `docs/DESIGN.md` stay as they are.
- Timeline, Risks and Services tabs beyond the shared header, dates and skeletons.
- iTop screens (Tickets tab, Utilization data states) — not captured.
- The exporters (`lib/gantt/exportPdf.ts`, `exportExcel.ts`) beyond their status labels; the INTERNAL-notes guardrail is untouched.
- `Tasks.tsx` and the `/tasks` route stay; the Timeline tab stays (guardrails).

**Decisions this plan assumes** (the recommendations in the review tab; a different answer changes only the tasks named)

| # | Decision | Assumed | Tasks affected |
| --- | --- | --- | --- |
| 1 | Label and epic colours | Dot + 14% tint, `on-surface` text; red removed from the label picker | P2-4 |
| 2 | Placeholder tabs on customer detail | Hidden until built | P2-9 |
| 3 | Sidebar default | Expanded with labels at 1280px and wider; the user's choice persists | P3-2 |
| 4 | Kanban card date | Due date replaces the duration | P2-2 |
| 5 | Add "My tasks" (/tasks) to the sidebar | Not added (decided 2026-09-29); the /tasks guardrail stays as it is | P3-2 |

**Standing rules every task follows**: `CHANGELOG.md` entry per change (reported by the implementor, appended by the orchestrator); scoped checks per task, one serial `gates.sh` run per wave; spine-list files get an instant review; no commit or PR without the user's approval; no AI attribution.

## Spec 1 — Shared foundations

Four shared modules or rules replace today's scattered copies: one label map per enum, one date formatter, one button rule, one type scale for small text. Paths are under `frontend/src/`.

### 1.1 Labels — new `lib/labels.ts`

**Today:** 10 separate task-status maps with three wordings for IN\_PROGRESS ("In progress", "In Progress", "Active"); 3 risk-status maps; priority reads "Med" in `PriorityBadge.tsx:18-23` and "Medium" in `TaskPanel.tsx:49-54`; the task-label map inside `StatusChip.tsx:42` is not exported. Raw enum text reaches the screen at `pages/Tasks.tsx:77` and `:84` ("IN PROGRESS", "MEDIUM"), `TaskFormModal.tsx:341-345`, `pages/views/ProjectTimeline.tsx:237`, `ProjectFormModal.tsx:225-228` ("ON HOLD") and `pages/Admin.tsx:1591-1593`.

**Contract:**

```ts
export const TASK_STATUS_LABEL: Record<TaskStatus, string>   // To do · In progress · Done
export const PRIORITY_LABEL: Record<Priority, string>        // Low · Medium · High · Urgent
export const RISK_STATUS_LABEL: Record<RiskStatus, string>   // Open · Mitigated · Closed
export const RISK_CATEGORY_LABEL: Record<RiskCategory, string>
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> // Planning · Active · On hold · Completed · Cancelled
export const taskStatusOptions / priorityOptions / riskStatusOptions: { value; label }[] // enum order
export function riskLevel(probability: number, impact: number): "Low" | "Medium" | "High" // moved from RiskFormModal.tsx:267-271, same thresholds (≤8, ≤15)
```

**Rules:**

- Every map in the table below imports from `lib/labels.ts`; `StatusChip.tsx` keeps exporting `projectStatusLabel` as a re-export so current imports keep working.
- Kanban column headers, the mobile move sheet, the WIP-limit columns and the Gantt legend (`lib/gantt/palette.ts:238-240`) use the same words; so do the PDF and Excel exports (`lib/gantt/exportPdf.ts:52-56`, `exportExcel.ts:28-32`).
- Every `Select` whose value differs from its label passes `items={options}` to the root (Base UI 1.6 `Select.Root` — `components/ui/select.tsx:32-35` forwards props). Today only `daily-review/ProjectCard.tsx:261` and `:298` need it; confirm the prop name against the installed `.d.ts` inside the frontend container before merging.
- Tone maps follow `StatusChip.tsx:36-40`; the hand-rolled chips in `ProjectList.tsx:68-72` and `TaskPanel.tsx:42-46` (both paint IN\_PROGRESS emerald) switch to `TaskStatusChip` or its exported tone.

| Map replaced | File:line |
| --- | --- |
| `STATUS_LABEL` ("Active") | `pages/views/ProjectList.tsx:63-67` |
| `STATUS_LABEL` | `components/TaskPanel.tsx:37-41`, `EpicPanel.tsx:19-23`, `TaskFormModal.tsx:32-36` |
| `COLUMN_LABELS` / `COLUMNS` / `WIP_COLUMNS` | `kanban-v2/SolvroKanban.tsx:60-64`, `kanban-v2/MobileMoveSheet.tsx:12-16`, `ProjectFormModal.tsx:25-29` |
| `TASK_STATUS_OPTIONS` / `RISK_STATUS_OPTIONS` | `daily-review/ProjectCard.tsx:55-65` |
| Risk status maps | `RiskFormModal.tsx:20-24`, `pages/views/ProjectRisks.tsx:40-44` |
| Priority maps | `PriorityBadge.tsx:18-23`, `TaskPanel.tsx:49-54`, `kanban-v2/SolvroKanban.tsx:519-523` |
| Export maps | `lib/gantt/exportPdf.ts:52-56`, `lib/gantt/exportExcel.ts:28-32` |

### 1.2 Dates — new `lib/formatDate.ts`

**Today:** seven copies of `toLocaleDateString(undefined, {month: "short", day: "numeric"})`, five month-name arrays, four `relativeTime` functions, day-first helpers (`dueDateLabel` "24 Aug", `fmtDateRangeDDMM` "05 Aug – 12 Aug", `formatWeekRange` "24 – 30 Aug") and `dd/MM/yyyy` in the Epics table. `toLocaleDateString(undefined, …)` also formats in the viewer's time zone, so a UTC-midnight task date can show the previous day west of Greenwich.

**Contract** (decided 2026-09-29: day first, as the team and customers read dates; locale fixed to `en-GB`, 24-hour time; day values formatted in `UTC`, timestamps in local time):

| Function | Input | Output |
| --- | --- | --- |
| `fmtDay(v)` | day string or ISO | `21 Aug`; `21 Aug 2025` when not this year |
| `fmtDayFull(v)` | day or ISO | `21 Aug 2026` |
| `fmtDayLong(v)` | day or ISO | `Monday 28 September 2026` (Daily Review header) |
| `fmtRange(a, b)` | two days, either null | `22 – 28 Aug` (same month); `28 Sep – 4 Oct`; `29 Dec 2025 – 4 Jan 2026`; `21 Aug` when a = b; `From 21 Aug` / `Until 28 Aug` / `No dates` |
| `fmtDue(v, today)` | due day + today | `Today`, `Tomorrow`, `6d late`, else `fmtDay` |
| `fmtWeek(weekStart)` | Monday day string | `28 Sep – 4 Oct` (same output as today's `formatWeekRange`) |
| `fmtDateTime(ts)` | ISO timestamp | `28 Sep, 14:22` |
| `fmtAgo(ts, now)` | ISO timestamp | `just now`, `5 min ago`, `3 h ago`, `2 d ago`, else `fmtDay` |

**Out of scope (unchanged on purpose):** the `dd/MM/yyyy` text inside `DateField` / `DateRangeField` inputs (date-contract spine files, and the format users type); the vendored `reui/gantt/` header formats; machine-readable `yyyy-MM-dd` cells and file names in exports; the compact "Mon 24" day strip labels.

### 1.3 Buttons

**Today:** about 45 buttons and links use `font-display text-label-caps uppercase tracking-wider` — `Projects.tsx:104`, `Customers.tsx:51,210,220`, `CustomerDetail.tsx:216,269,278,1037`, `Settings.tsx:153,292,300`, `Tasks.tsx:303`, `ProjectRisks.tsx:183`, `ProjectEpics.tsx:211`, `Login.tsx:398`, 15 sites in `Admin.tsx`, `components/Tabs.tsx:23`, `DateField.tsx:153`, `DateRangeField.tsx:319`, `LabelPicker.tsx:80`, `services/ServiceCatalogueManager.tsx`, `admin/ItopTab.tsx`, three iTop components. No app page uses the shared `components/ui/button.tsx`; there are 297 raw `<button>`s.

**Rules:**

1. Sentence case on every button, link-button and tab; `text-label-caps` + `uppercase` stays only on column headers and micro labels (DESIGN §2).
2. "New …" opens a create form for a top-level entity (project, customer); "Add …" inserts into the current container (task, section, epic, risk, label).
3. One filled primary button per view.
4. Delete lives in a ⋯ menu and confirms through `ConfirmModal` with a new `confirmTone="danger"` (confirm button on `bg-error` / `text-on-error`, no new token); the three native `confirm()` calls (`ProjectDetail.tsx:121-137`, `Customers.tsx:27`, `CustomerDetail.tsx:193-208`) go, and the existing delete dialogs (task, epic, subtask) move to `danger` too.
5. Every icon-only button has an `aria-label` and a visible tooltip.

Adopting `components/ui/button.tsx` across 297 raw buttons is out of scope; this pass changes classes only.

### 1.4 Small text and monospace

**Today:** `text-[11px]` ×150 (the base size of every chip: `StatusChip.tsx:49`, `PriorityBadge.tsx:35`, `LabelChip.tsx:8`, `EpicChip.tsx:24`), `text-[10px]` ×51, `text-[9px]` ×1 (`PortfolioCalendar.tsx:183`); 103 `font-mono` uses outside `ui/`/`reui/`, including person names (`Customers.tsx:183`, `Settings.tsx:69,72`, `Admin.tsx:184`) and stat counters (`daily-review/StatsBar.tsx:84`, `Overview.tsx:203`, `CustomerDetail.tsx:620`, `Admin.tsx:653`).

**Rules:**

- Add one named role, `text-meta` (12px / 500 / 1.35, sentence case), to the `@theme` block in `index.css` and to the `tailwind-merge` list in `lib/utils.ts` (DESIGN §2 requires both). This is a design-system change: approved 2026-09-29, and P1-7 updates `docs/DESIGN.md` in the same change.
- Chips move from 11px to `text-meta`. `text-[10px]` and `text-[9px]` become `text-meta` or `text-label-caps` by role. The remaining `text-[11px]` sites move by folder in the same task.
- `font-mono` stays for IDs (`T-055`, `P-001`), code, tokens and keyboard hints only. Names, emails, dates and counts use the body font; counters add `tabular-nums`.

## Spec 2 — Backend additions

Additive, read-only changes to existing GET endpoints, plus one light new GET endpoint (B6); no schema change, no migration, no new permission. Every new count respects `projectVisibilityFilter` / `customerVisibilityFilter` and uses the existing `overdueBoundary(today)` from `backend/src/lib/dateBoundary.ts`.

**Facts from the code that shape these contracts**

- Projects have **no start or end date columns** (`schema.prisma:177-215`); start and end come from task dates, as `lib/portfolio.ts:59-76` already does (min `startDate`, max `dueDate`).
- Risks have **no severity enum**: `probability` and `impact` are integers 1–5 (`projects.ts:571-576`). The review drawings that say "High" for a risk map to a derived score, not a stored field.
- `GET /tasks` has **no pagination** and stops at `take: 200` (`tasks.ts:129-145`); its order is `position`, which means nothing across projects.
- Task dates are `DateTime` written as UTC midnight of a day string (`frontend/src/lib/dateField.ts`); older rows may hold non-midnight instants.
- Patterns to copy: the epics progress `groupBy` fold (`projects.ts:506-521`, "never N+1"), parallel `groupBy` in `overview.ts:42-56`, and the filtered relation count in `customers.ts:183`.

### B1 · Shared health helper (new file)

`backend/src/lib/projectHealth.ts` exports `computeProjectHealth(projectIds: number[], today?: string): Promise<Map<number, ProjectHealth>>`.

```ts
type ProjectHealth = {
  progress: { done: number; total: number }; // all tasks, subtasks included (matches project Overview "7 of 17")
  overdueCount: number;   // status != DONE and dueDate < overdueBoundary(today)
  openRiskCount: number;  // Risk.status = OPEN
  startDate: string | null; // min Task.startDate, yyyy-MM-dd
  endDate: string | null;   // max Task.dueDate, yyyy-MM-dd
};
```

It runs four queries in `Promise.all`, whatever the number of projects: `task.groupBy([projectId, status])`, `task.groupBy([projectId])` with the overdue filter, `risk.groupBy([projectId])` with `status: OPEN`, and `task.groupBy([projectId])` with `_min.startDate` / `_max.dueDate`. All hit existing indexes (`projectId`, `status`, `dueDate`). `computeSlipDays` and `currentPhase` move from `routes/dailyReview.ts:45-89` into the same file, exported, with Daily Review importing them (behaviour unchanged).

### B2 · `GET /projects` and `GET /projects/:id` gain `health` (spine: `routes/projects.ts`)

- Query: add optional `today` (yyyy-MM-dd, `isValidDayString`) to `projectListQuerySchema`; add a query schema with `today` to `GET /:id`.
- Response: each item gains `health: ProjectHealth`. `GET /:id` also gains `health.slipDays: number | null` (from `computeSlipDays`, needs the project's tasks' baseline dates — one extra `task.findMany` select for that single project).
- `GET /customers/:id` nested `projects[]` gain the same `health` (one `computeProjectHealth` call over their ids).
- Bare-array response shape and ordering stay the same; `health` is additive, so no current caller breaks.

### B3 · `GET /customers` gains `health` (`routes/customers.ts`, not spine)

- New `customersListQuerySchema = z.object({ today: dayString.optional() })` with `validate("query", …)` (the route has no query schema today).
- Each item gains:

```ts
health: {
  overdueCount: number;   // sum over the caller's visible projects of this customer
  openRiskCount: number;
  weeklyUpdate: { weekStart: string; status: "NOT_STARTED" | "DRAFT" | "DONE"; health: "GREEN" | "AMBER" | "RED" | null } | null; // this ISO week, from today
}
```

- Implementation: one `project.findMany({ where: { AND: [projectVisibilityFilter(user), { customerId: { in: ids } }] }, select: { id, customerId } })`, the overdue and risk `groupBy`s by `projectId`, one `weeklyUpdate.findMany` for this week's `weekStart`, then a roll-up map per customer (Prisma cannot group across relations).

### B4 · `GET /tasks` gains `open`, `dueFrom`, `dueTo`, `sort` (spine: `routes/tasks.ts`)

| Param | Type | Semantics |
| --- | --- | --- |
| `open` | `"true" \| "false"` | `true` adds `{ status: { not: "DONE" } }` to `where.AND` |
| `dueFrom` | yyyy-MM-dd | `dueDate >= utcMidnightOfDayString(dueFrom)` |
| `dueTo` | yyyy-MM-dd | `dueDate < utcMidnight(dueTo + 1 day)` — inclusive of the last day, safe for non-midnight rows |
| `sort` | `"position" \| "due"` | `due` = `[{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }]`; default stays `position` |

- Object `.refine`: `dueFrom <= dueTo` when both are set, else 400 `validation_error`.
- `where.AND` becomes an array that every filter appends to; today `overdue` assigns it (`tasks.ts:124`) and would clobber the new filters.
- The `take: 200` cap stays. The response adds header `X-Total-Count` (a `task.count` with the same `where`) so the UI can say "showing 200 of N".

### B5 · `GET /overview` gains `workCounts` (`routes/overview.ts`, not spine)

```ts
workCounts: { overdue: number; dueThisWeek: number; openRisks: number }
```

- Scope: the same visibility scope as the rest of the overview; top-level and subtasks both count.
- `overdue` = open and `dueDate < overdueBoundary(today)`; `dueThisWeek` = open and due from `today` through the ISO week's Sunday; `openRisks` = `Risk.status = OPEN` on projects in scope (decided 2026-09-29: this replaces the "Customer action" tile, because labels are per project).
- Three `count` calls in the existing `Promise.all`.

### B6 · `GET /overview/badges` — light sidebar counts (`routes/overview.ts`, not spine)

```ts
// GET /overview/badges?today=yyyy-MM-dd
{ dailyReviewPending: number }
```

- `dailyReviewPending` = the caller's Daily Review customers (same owned-or-attached scope, ACTIVE projects only) that still have at least one project without a `ProjectReview` row for the caller and `today`. Two queries: `project.findMany` (select `id`, `customerId`) and `projectReview.findMany` (caller, `reviewDate = today`, `projectId in ids`).
- The customer/project scope code moves out of `routes/dailyReview.ts:152-223` into `lib/dailyReviewScope.ts`, shared by both routes, so the badge and the page can never disagree.
- Two queries, no task rows loaded — cheap enough for every page load (the full daily-review endpoint runs 9–11 queries and returns every task).
- The response is an object so later badges can join it without a new endpoint.
- Frontend: `useNavBadges()` in `lib/queries.ts`, `staleTime: 60_000`, refetch on window focus; "Mark reviewed" invalidates it.

### Frontend contract (spine: `frontend/src/lib/queries.ts`)

- `ProjectSummary` (`:125-142`) gains `health?: ProjectHealth` (optional, so fixtures and older shapes still type-check); `ProjectDetail` gains `health.slipDays`.
- `CustomerSummary` (`:72-84`) gains `health?: CustomerHealth`.
- `TasksFilter` (`:327-335`) gains `open`, `dueFrom`, `dueTo`, `sort`; `useTasks` (`:747-778`) sends them and reads `X-Total-Count`.
- New `useNavBadges()` for B6.
- `useProjects`, `useProject`, `useCustomers`, `useCustomer`, `useNavBadges` send `today = dateToDay(new Date())` and put it in the query key, as `useTasks` does.
- Task and risk mutations also invalidate `["projects"]`, `["customers"]` and the badges key (today only partly, `:807-808`, `:839-843`), so health numbers do not go stale.

## Spec 3 — Screens A–O

Each screen lists where it lives, what changes, what must stay (because e2e specs or guardrails depend on it), and its acceptance criteria. Letters match the drawings in the review tab. Paths are under `frontend/src/` unless given.

### A · Project header — `pages/ProjectDetail.tsx:144-224`, `components/layout/TopBar.tsx:69-82`

- **Today:** the meta line reads `project.tam` and `_count.tasks` only (:150-156); Edit, Delete and Context are three equal buttons (:158-197); Delete uses the browser's native `confirm()` (:121-137); the breadcrumb and status chip live in the TopBar.
- **Change:** a facts row (Customer, Dates from `health.startDate/endDate`, TAM, Progress bar with `health.progress`, Health = overdue count + `health.slipDays`); actions become "Edit", a ⋯ menu built on `components/ui/dropdown-menu.tsx` (Base UI; reference use in `gantt-v2/SolvroGantt.tsx:1211-1261`) holding Lock baseline, Export, Delete project; Delete opens `ConfirmModal` with `confirmTone="danger"` instead of `confirm()`. The TopBar breadcrumb gains the customer segment.
- **Keep:** the Context toggle's `aria-label` "Show project context" / "Hide project context" and `aria-pressed` (gantt-parity.spec :426/:433); the `TABS` array and `NavLink` tab row; `canEdit` gating on `project:write`.
- **Accept when:** the header shows all five facts for a project with dated tasks and "No dates yet" for one without; Delete is reachable only through ⋯ and still confirms; no horizontal overflow at 375px (smoke.spec checks `/projects/:id`).

### B · Kanban card — `components/kanban-v2/cards.tsx:28-251` (not spine)

- **Change:** replace `getDuration` (:236-251, "N Days") with the due date in the short form, red with "Nd late" when overdue; hide the comment count when 0 (:170-173); hide `PriorityBadge` when MEDIUM (:179); render the epic as a dot + name (see P2-4); show `CriticalPathMark` as an icon with a tooltip; show the grip and ⋯ on hover or focus only at `md:` and up.
- **Keep:** `aria-label="Drag to reorder"` on the grip and `aria-label="Card options"` on mobile (kanban-dnd.spec); `data-testid="epic-chip"`; the text "Critical Path" inside `[data-slot="kanban-item"]` (critical-path.spec :165-185) — keep it as the icon's accessible name; `adapter.ts` and `commitMapper.ts` untouched.
- **Accept when:** a MEDIUM task with no comments shows title, epic, due date and avatar only; a HIGH overdue task shows the priority word and a red due date; the grip is reachable by keyboard.

### C · Overview — `pages/Overview.tsx`

- **Today:** four `Kpi` tiles from `useOverview()` (:56-85, mono values); `PortfolioCalendar` (:88-105); "Projects needing attention" = `data.portfolio` sorted by `healthRank` (:113-163) below the fold; `RecentNotesFeed` (:165-173); `healthColor` uses hard-coded hex (:328-332).
- **Change:** replace the greeting and the four tiles with three tiles from `workCounts` (B5): Overdue and Due this week link to the matching Tasks view (`/tasks?view=overdue`, `/tasks?view=week`); Open risks links to Daily Review, which lists open risks per project. Move "Needs attention" above the timeline with overdue and open-risk chips from project `health`; `healthColor` moves to tokens; `PortfolioCalendar` rows compact to 32px (it is shared with `Executive.tsx`; change the row height only).
- **Keep:** the "Recent notes" heading as a direct child of its panel (daily-review.spec :316-323 walks `ancestor::div[1]`).
- **Accept when:** at 1440×900 the three tiles and the first attention row are above the fold; the Overdue and Due this week counts equal the row counts of the Tasks views they open; the Open risks count equals the sum of open risks on the visible projects.

### D · Sidebar — `components/layout/Sidebar.tsx`, `SidebarContext.tsx`, `lib/navCommands.ts:14-25`

- **Today:** 9 flat items from `NAV_COMMANDS` (also the ⌘K list); `/tasks` is left out on purpose (guardrail; `lib/helpContent.ts:7` repeats it); `open` is a non-persisted boolean, default `false`; collapsed items use a native `title` tooltip (:72); every NavLink collapses the sidebar on click (:71).
- **Change:** add a `group` field to each nav command — Workspace (Overview, Projects, Customers), Cadence (Daily review, Weekly sync), Insights (Utilization, Executive), System (Settings, Admin) — with group labels expanded and dividers collapsed; a badge on Daily review from `useNavBadges()` (B6), hidden at 0; styled tooltip with no delay; persist `open` in `localStorage` (wrapped in try/catch) with default expanded at ≥1280px; stop collapsing on link click at `md:` and up.
- **Keep:** `/tasks` stays out of the sidebar (decided 2026-09-29, guardrail unchanged) — it stays reachable from Overview tiles and ⌘K search results; `navCommands.test.ts:41` route list unchanged; the rail stays fixed-dark; the mobile drawer and its "Close sidebar" backdrop.
- **Accept when:** groups and the badge match drawing D; the expanded state survives a reload; ⌘K lists the same pages as before.

### E · Customer detail — `pages/CustomerDetail.tsx`

- **Today:** back link + identity card + two `CustomerKpi`s (:213-310) — "Active projects" shows the total, not the active count (a bug); `TAB_ITEMS` (:80-87) includes Topology, Organization Structure, Documents placeholders (`EmptyState` :342-362) and "Soon" sections (:441-453, :634-665); the green `ProfileCompletionCard` (:971-980) uses raw `emerald-*` classes; no notes hook.
- **Change:** header strip (name, AM / SA / TAM, iTop org, health line), Edit + ⋯ (Delete via `ConfirmModal`); Overview tab = projects table with progress and health (nested `projects[].health`, B2), open risks (from the projects' risks), last weekly update (`useCustomerWeeklyUpdates(id, 1)`), recent notes (new `useCustomerNotes(id, 5)` hook on the existing `GET /customers/:id/notes`), then the profile collapsed; drop the placeholder tabs and "Soon" sections (decision 2); replace the success banner with a check beside the name.
- **Keep:** the Tickets tab gate (`ticketsAvailable`, :79) and its `button "Tickets"` role (itop specs); `?tab=`, `?ticket=`, `?view=board` sync (:89-118); `h1` name.
- **Accept when:** a customer page lists every visible project with progress and health; no tab or section says "Soon"; the active-project count counts ACTIVE only.

### F · Top bar and breadcrumbs — `components/layout/TopBar.tsx:10-82`

- **Change:** replace `PAGE_TITLES` with a route map (new `lib/routeMeta.ts`: path pattern → title + breadcrumb builder); project routes read `useProject` (same key, no extra fetch) and add the customer; customer detail reads `useCustomer`; remove the "‹ Customers" back link.
- **Keep:** `button /open search/i` (search.spec :194/:340), the timer link, Help, theme toggle, user menu.
- **Accept when:** no route shows "Solvro" as its title; Projects says "Projects" in both the top bar and the H1.

### G · Project List view — `pages/views/ProjectList.tsx`

- **Change:** status labels from the shared map (`:65` maps IN\_PROGRESS to "Active" today); priority as word + flag, hidden when MEDIUM; dates in the short form; epic and label chips per P2-4.
- **Keep:** `button "Filter"` (list-dnd.spec :286/:299), `button /^Due date/` row buttons (date-picker.spec :499), drag handles.
- **Accept when:** no task status reads "Active"; priority is never colour-only.

### H · Gantt tree dates — `components/gantt-v2/TreeCells.tsx:41-85` (spine)

- **Change:** `fmtDateRangeDDMM` → the shared range form; same-day range collapses; body font instead of mono.
- **Keep:** `title="Click to edit dates"` on the button (date-picker.spec :613/:843) and the sr-only "(overdue)".
- **Accept when:** the tree shows "21 Aug" for a one-day task and "22 – 28 Aug" for a range; instant review passes.

### I · Epics tab — `pages/views/ProjectEpics.tsx`

- **Change:** `fmtDate` (:21, `dd/MM/yyyy`) → the short form; owner with avatar; progress text "3 of 6"; table skeleton while loading (P3-1).
- **Keep:** `data-testid="epic-progress-text"`, the Rename / Delete `aria-label`s and the "Delete epic" dialog (epics.spec).
- **Accept when:** no numeric dates remain; the tab never renders an empty bordered box.

### J · Tasks page — `pages/Tasks.tsx` (never delete)

- **Today:** ReUI `Filters` + "Overdue only" / "Top-level only" checkboxes (:270-307); state in `useState`, no URL params; client-side sort `[{id:"due"}]` (:64); `useTasks(filter)` (:124); row click opens `TaskFormModal` (:321).
- **Change:** a saved-view tab row (All open · My open · Overdue · This week · All) that sets `open`, `assignedToId`, `overdue`, `dueFrom`/`dueTo` (B4) and syncs to `?view=` (keys: open, my-open, overdue, week, all); default view All open, `sort=due`; show "Showing 200 of N" from `X-Total-Count`; due column uses the relative form.
- **Keep:** `button "Filter"`, `button "Reset"`, `checkbox "Top-level only"`, rows as `tr` with `a[href="/projects/{id}"]`, the `dialog "Edit task"` (filters-duplicate-chip.spec, kanban-dnd.spec :110-145, :926-1000).
- **Accept when:** the page opens with no Done rows; each view's URL is shareable.

### K · Task form and task panel — `components/TaskFormModal.tsx:318-489`, `components/TaskPanel.tsx:335-716`

- **Change:** Priority and Status option labels from the shared map ("Medium", "To do"); placeholders say what to do ("Pick start and due", "Top level", "No section"); label chips per P2-4. TaskPanel: dates in the range form; labels per P2-4.
- **Keep:** the `FieldRow` DOM (`div.flex.items-center.gap-3` > icon + label span) and the native `<select>` elements — kanban-dnd.spec selects by `:has(span:text-is("Parent")) select`; TaskPanel's "Task options", "Critical Path: Yes/No", "Dates" + sibling button, and "Delete task" dialog.
- **Accept when:** the form and the panel show the same words for the same value.

### L · Daily Review — `components/daily-review/StatsBar.tsx`, `ProjectCard.tsx`

- **Change:** stat values in the body font with `tabular-nums`, "0 of 3" instead of "0 / 3"; the two `<SelectValue />` triggers (:251-270, :288-307) show labels; dates in the short form; "NO BASELINE" becomes sentence case.
- **Keep:** all `data-testid="stat-*"`, `combobox "Task status"` / `"Risk status"`, "Mark reviewed", "Hide lists"/"Show lists", the risk score helpers `scoreLevel`/`scoreClass` from `RiskFormModal.tsx:267-279` (≤8 Low, ≤15 Medium, else High).
- **Accept when:** no raw enum text is visible anywhere on the page.

### M · Projects list — `pages/Projects.tsx:98-211`

- **Change:** "+ New project" in sentence case; `ProjectCard` footer shows a progress bar with "41% · 7 of 17", overdue and open-risk chips from `health`, and "Baseline locked".
- **Keep:** the `?customerId=` filter sync; card `h3` titles.
- **Accept when:** every card shows progress; a project with no tasks shows "No tasks yet".

### N · Customers list — `pages/Customers.tsx`

- **Change:** the card grid becomes a ReUI data-grid (as on the Tasks page) with Customer, AM, TAM, Projects, Overdue, Risks, Weekly update (from `health`, B3), every column sortable; row click opens the account page; Edit and Delete move to a row ⋯ menu (Delete via `ConfirmModal`); initials tiles use tokens, not the hex hash palette (:232-237).
- **Keep:** `button /new customer/i` (search.spec :302-314); a heading element for each customer name (customer-visibility.spec :140-154 reads `h3`) — update the spec to the row cell in the same task if the `h3` goes.
- **Accept when:** 30 seeded customers fit on one screen at 1440×900 and sort by each column.

### O · Mobile project header — `pages/ProjectDetail.tsx`, `TopBar.tsx`

- **Change:** below `md`, the top bar shows the truncated project name (not "Projects /" + chip); the facts row collapses to status chip + customer + progress; all actions live in the ⋯ menu; the tab row scrolls sideways with an edge fade.
- **Keep:** smoke.spec's no-horizontal-overflow check on `/projects/:id` and `/projects/:id/kanban`; the Gantt tab stays `hidden md:inline-block`.
- **Accept when:** at 375px the project name is visible, nothing overlaps the search button, and the first Kanban column starts higher than today.

## Dependency graph

```
Phase 1 · Consistency (frontend only)
  Wave 1: P1-1 Label maps + Select fix | P1-2 Date formatter (day first) | P1-5 Buttons, verbs, danger tone
  Wave 2: P1-3 Dates on screens (needs P1-2) | P1-4 Dates in the Gantt (needs P1-2, spine) | P1-6 Titles, breadcrumbs
  Wave 3: P1-7 Type role + chips + DESIGN.md | P1-8 Small-size sweep (needs P1-7)
Phase 2 · Hierarchy (backend first)
  Wave 1: P2-1 API project health (spine) | P2-5 API task filters + work counts (spine) | P2-2 Kanban card
  Wave 2: P2-3 Project header (needs P2-1) | P2-4 Label and epic colours | P2-7 Tasks saved views (needs P2-5)
  Wave 3: P2-6 Overview My work (needs P2-5, P2-7) | P2-8 Project cards (needs P2-1) | P2-9 Customer account page (needs P2-1)
  Wave 4: P2-10 Customers table + API B3 (needs P2-1)
Phase 3 · Polish (one small backend task first)
  Wave 1: P3-1 Loading skeletons | P3-5 API nav badge | P3-4 Command palette actions
  Wave 2: P3-3 Mobile project header (needs P2-3) | P3-2 Grouped sidebar (needs P3-5)
Commit: one combined commit of the whole worktree at the end, on the user's approval.
```

A wave holds at most three tasks, the repo's limit for parallel implementors; a task starts only when every task it names under "needs" is merged into the phase branch. Tasks inside one wave touch different files, so they can run without worktree isolation except where the task plan says otherwise.

## Task plan

23 tasks in 3 phases. All work runs in this worktree on the current branch, which already sits on `origin/develop` (`48b8739`, checked 2026-09-29); tasks are the units of work, review and CHANGELOG text, and nothing is committed until the end, when you approve one combined commit (decided 2026-09-29). Sizes: S = 1–2 files, M = 3–5, L = 5–8 or a mechanical sweep. Paths are under `frontend/src/` or `backend/` as written.

### Phase 1 · Consistency

#### P1-1 · Label maps and Select fix — M · wave 1

- **Do:** create `lib/labels.ts` (Spec 1.1); replace the 10 task-status maps, 3 risk-status maps, 3 priority maps and the raw-enum sites; pass `items` to the two Daily Review selects; move `scoreLevel` to `riskLevel` and re-export from `RiskFormModal.tsx`.
- **Files:** `lib/labels.ts` (new), `lib/labels.test.ts` (new), `StatusChip.tsx`, `PriorityBadge.tsx`, `TaskPanel.tsx`, `EpicPanel.tsx`, `TaskFormModal.tsx`, `ProjectFormModal.tsx`, `RiskFormModal.tsx`, `kanban-v2/SolvroKanban.tsx`, `kanban-v2/MobileMoveSheet.tsx`, `daily-review/ProjectCard.tsx`, `pages/Tasks.tsx`, `pages/Admin.tsx`, `views/ProjectList.tsx`, `views/ProjectRisks.tsx`, `views/ProjectTimeline.tsx`, `lib/gantt/palette.ts`, `lib/gantt/exportPdf.ts`, `lib/gantt/exportExcel.ts`. Mechanical, so allowed above 5 files.
- **Accept:** \[ \] `grep -rn '"In Progress"\|"Active"' src` finds no task-status label; \[ \] no visible text equals an enum in upper snake case; \[ \] Daily Review selects show "In progress" and "Open"; \[ \] `TaskFormModal` keeps its native `<select>` and `FieldRow` DOM.
- **Verify:** `lib/labels.test.ts`; frontend typecheck; e2e `list-dnd.spec.ts` (update `:141` "Active" → "In progress"), `kanban-dnd.spec.ts` (`:201-202`, `:894-895` h3 text), `gantt-legend.spec.ts:70`, `daily-review.spec.ts`.
- **Needs:** none.

#### P1-2 · Date formatter — S · wave 1

- **Do:** create `lib/formatDate.ts` with the eight functions in Spec 1.2 and one month-name list; no call-site changes yet.
- **Files:** `lib/formatDate.ts`, `lib/formatDate.test.ts`.
- **Accept:** \[ \] every row of the Spec 1.2 table has a test; \[ \] a `TZ` matrix (UTC, Asia/Jakarta, America/Los\_Angeles) shows no day shift for `2026-09-28T00:00:00.000Z`.
- **Verify:** `docker compose exec frontend npx vitest run src/lib/formatDate.test.ts`.
- **Needs:** none.

#### P1-5 · Buttons and verbs — L (mechanical) · wave 1

- **Do:** remove `uppercase tracking-*` from the \~45 button, link and tab sites in Spec 1.3; rename create buttons per the verb rule; add `confirmTone="danger"` to `components/ConfirmModal.tsx` (confirm button on `bg-error` / `text-on-error`); replace the three native `confirm()` calls with `ConfirmModal` and move the existing delete dialogs (task `TaskPanel.tsx:894`, epic `ProjectEpics.tsx:~334`) to `danger`.
- **Files:** `components/ConfirmModal.tsx`, `pages/Projects.tsx`, `Customers.tsx`, `CustomerDetail.tsx`, `Settings.tsx`, `Tasks.tsx`, `Login.tsx`, `Admin.tsx`, `ProjectDetail.tsx`, `views/ProjectRisks.tsx`, `views/ProjectEpics.tsx`, `components/Tabs.tsx`, `TaskPanel.tsx`, `LabelPicker.tsx`, `services/ServiceCatalogueManager.tsx`, `admin/ItopTab.tsx`, iTop `TicketPanel.tsx`, `TicketLog.tsx`, `board/TicketCard.tsx`. `DateField.tsx:153` and `DateRangeField.tsx:319` are date-contract spine files: change the class only, and flag them for the instant review.
- **Accept:** \[ \] `grep -rn 'uppercase' src --include=*.tsx` finds no `<button>` or `<Link>` outside column headers; \[ \] every delete confirms through `ConfirmModal` with the danger tone; \[ \] the dialog name stays "Delete task" / "Delete epic" (e2e); \[ \] `button /new customer/i` still matches (search.spec :302-314).
- **Verify:** frontend typecheck; e2e `search.spec.ts`, `epics.spec.ts`, `subtask-edit.spec.ts:141`, `gantt-parity.spec.ts:985`, `customer-visibility.spec.ts`.
- **Needs:** none. Runs in wave 1 because it touches different lines from P1-1 in the shared files; use a worktree if the orchestrator sees overlap in `TaskFormModal.tsx`, `TaskPanel.tsx` or `Admin.tsx`.

#### P1-3 · Dates on screens — L · wave 2 (two commits: a, b)

- **Do (a, project views):** replace local formatters in `kanban-v2/cards.tsx:242`, `views/ProjectList.tsx:1289`, `views/ProjectTimeline.tsx:252`, `views/ProjectOverview.tsx:667,675`, `views/ProjectEpics.tsx:21`, `TaskPanel.tsx:73,1007,1017`, `EpicPanel.tsx:30`.
- **Do (b, other pages):** `pages/Tasks.tsx:384`, `lib/dailyReviewStats.ts:95-118` (`dueDateLabel` → `fmtDue`), `lib/isoWeek.ts:168-179` (`formatWeekRange` delegates to `fmtWeek`; same output), `portfolio/PortfolioCalendar.tsx:31,314`, `pages/Executive.tsx:333`, `pages/DailyReview.tsx:15`, `layout/RightSidebar.tsx:46,49,302,346`, `pages/CustomerDetail.tsx:865-866`, `pages/Settings.tsx:166,176,240`, `admin/ItopTab.tsx:88,98`, `itop/SyncedAgo.tsx:13`, `itop/TicketLog.tsx:112`, `pages/WeeklySync.tsx:30`, `daily-review/WeeklySyncRow.tsx:20`.
- **Accept:** \[ \] no `toLocaleDateString(undefined` remains outside `lib/formatDate.ts`; \[ \] one month-name list in the app (plus `reui/`); \[ \] every screen reads day first.
- **Verify:** day-first keeps today's outputs for `dailyReviewStats.test.ts:305-316` ("24 Aug"), `isoWeek.test.ts:138-158` and `utilization.spec.ts:131` ("7 – 13 Sep") — they must pass unchanged; update `date-picker.spec.ts:792-813`, which builds the expected label with `toLocaleDateString(undefined, …)` (month first on the CI browser), to the new form.
- **Needs:** P1-2.

#### P1-4 · Dates in the Gantt — S · wave 2 · spine

- **Do:** `lib/gantt/geometry.ts:58-68` (`fmtDateDDMM`, `fmtDateRangeDDMM`) delegates to `fmtDay` / `fmtRange`; `gantt-v2/TreeCells.tsx:62` drops `font-mono`; `gantt-v2/SolvroGantt.tsx:490` uses `fmtDateTime`.
- **Accept:** \[ \] tree shows `21 Aug and 22 – 28 Aug`; \[ \] `title="Click to edit dates"` and sr-only "(overdue)" unchanged.
- **Verify:** `TreeCells.test.ts`; e2e `date-picker.spec.ts:613,843`, `gantt-parity.spec.ts`; instant review.
- **Needs:** P1-2.

#### P1-6 · Titles and breadcrumbs — M · wave 2

- **Do:** new `lib/routeMeta.ts` (route pattern → title + crumbs); `TopBar.tsx:10-82` renders crumbs for every route, adding the customer to project crumbs and a crumb for customer detail; remove the back link at `CustomerDetail.tsx:216`.
- **Files:** `lib/routeMeta.ts`, `lib/routeMeta.test.ts`, `layout/TopBar.tsx`, `pages/CustomerDetail.tsx`.
- **Accept:** \[ \] no route shows "Solvro"; \[ \] Projects shows "Projects" in top bar and H1; \[ \] no extra network request (reuses `useProject` / `useCustomer` keys).
- **Verify:** `routeMeta.test.ts` walks every route in `App.tsx`; e2e `search.spec.ts`, `smoke.spec.ts`.
- **Needs:** none (wave 2 only to keep a wave at three tasks).

#### P1-7 · Type role and chips — M · wave 3

- **Do:** add `text-meta` (12px / 500 / 1.35, approved 2026-09-29) to `index.css` `@theme` and to `lib/utils.ts` `extendTailwindMerge`; in the same change, add the role to `docs/DESIGN.md` (frontmatter `typography.roles` and the §2 Named roles table), so the doc never lists a token the code lacks; chips move to it (`StatusChip.tsx:49`, `PriorityBadge.tsx:35`, `LabelChip.tsx:8`, `EpicChip.tsx:24`); person names and emails leave `font-mono` (`Customers.tsx:183`, `Settings.tsx:69,72`, `Admin.tsx:184`); stat counters get the body font + `tabular-nums` (`StatsBar.tsx:84`, `Overview.tsx:203`, `CustomerDetail.tsx:620`, `Admin.tsx:653`).
- **Accept:** \[ \] `cn("text-meta", "text-primary")` keeps both classes (tailwind-merge test); \[ \] chips render at 12px in both themes; \[ \] `docs/DESIGN.md` §2 and its frontmatter list `text-meta` with the same values as `index.css`.
- **Verify:** unit test in `lib/utils.test.ts`; `daily-review.spec.ts` stat assertions still pass (text unchanged); the docs-keeper checks DESIGN.md against `index.css` at phase close.
- **Needs:** none.

#### P1-8 · Small-size sweep — L (mechanical) · wave 3

- **Do:** replace `text-[9px]` (1), `text-[10px]` (51) and `text-[11px]` (150, 55 files) with `text-meta`, `text-label-caps` or `text-xs` by role; one commit per top-level folder.
- **Accept:** \[ \] `grep -rnE 'text-\[(9|10|11)px\]' src` returns nothing outside `ui/` and `reui/`.
- **Verify:** frontend typecheck; full e2e at the phase checkpoint; visual pass on the 15 screens.
- **Needs:** P1-7.

**Checkpoint — end of Phase 1:** full `gates.sh` green; phase review; docs-keeper verifies the `docs/DESIGN.md` update from P1-7; all 15 screens checked against the drawings for words, dates and buttons. No commit: the work stays in the worktree.

### Phase 2 · Hierarchy

#### P2-1 · API: project health — M · wave 1 · spine

- **Do:** `backend/src/lib/projectHealth.ts` (B1, with `computeSlipDays` and `currentPhase` moved from `routes/dailyReview.ts:45-89`); `health` on `GET /projects`, `GET /projects/:id` (+ `slipDays`), and nested `GET /customers/:id` projects (B2); `ProjectSummary.health?` and `today` in the keys of `useProjects` / `useProject` / `useCustomer` (`lib/queries.ts`); task and risk mutations invalidate `["projects"]` and `["customers"]`.
- **Files:** `backend/src/lib/projectHealth.ts`, `backend/src/routes/projects.ts`, `backend/src/routes/customers.ts`, `backend/src/routes/dailyReview.ts`, `backend/test/projectHealth.test.ts`, `frontend/src/lib/queries.ts`.
- **Accept:** \[ \] the B1 test list passes; \[ \] `dailyReview.test.ts` unchanged and green; \[ \] `GET /projects` under 200 ms on the demo seed.
- **Verify:** backend single-file tests; backend and frontend typecheck; instant review.
- **Needs:** none.

#### P2-5 · API: task filters and work counts — M · wave 1 · spine

- **Do:** B4 on `GET /tasks` (`open`, `dueFrom`, `dueTo`, `sort`, `X-Total-Count`, `where.AND` as an array); B5 `workCounts { overdue, dueThisWeek, openRisks }` on `GET /overview`; `TasksFilter` and `useTasks` send the new params and expose the total.
- **Files:** `backend/src/routes/tasks.ts`, `backend/src/routes/overview.ts`, `backend/test/tasksFilters.test.ts`, `backend/test/overviewWorkCounts.test.ts`, `frontend/src/lib/queries.ts`.
- **Accept:** \[ \] B4 and B5 tests pass; \[ \] `tasksOverdue.test.ts` still green (the `AND` refactor).
- **Verify:** backend tests; typechecks; instant review.
- **Needs:** none. Conflicts with P2-1 only in `lib/queries.ts` — run in a worktree, merge P2-1 first.

#### P2-2 · Kanban card — S · wave 1

- **Do:** Spec 3-B in `kanban-v2/cards.tsx` only.
- **Accept:** \[ \] Spec 3-B criteria; \[ \] `adapter.ts` / `commitMapper.ts` untouched (`git diff --stat`).
- **Verify:** e2e `kanban-dnd.spec.ts`, `critical-path.spec.ts`, `date-picker.spec.ts:813`, `smoke.spec.ts`.
- **Needs:** P1-2 (Phase 1 merged).

#### P2-3 · Project header — M · wave 2

- **Do:** Spec 3-A: facts row, ⋯ menu on `components/ui/dropdown-menu.tsx`, Delete via `ConfirmModal`, customer crumb.
- **Files:** `pages/ProjectDetail.tsx`, `components/ProjectHeaderFacts.tsx` (new), `layout/TopBar.tsx`, `layout/RightSidebar.tsx` (Baseline and Export actions exposed to the menu).
- **Accept:** \[ \] Spec 3-A criteria; \[ \] context toggle aria-labels unchanged.
- **Verify:** e2e `gantt-parity.spec.ts:426-433`, `smoke.spec.ts` (mobile overflow); a new e2e: delete through ⋯ confirms.
- **Needs:** P2-1.

#### P2-4 · Label and epic colours — S · wave 2 · decision 1

- **Do:** `LabelChip.tsx` and `EpicChip.tsx` render a dot in the user colour + a 14% tint via `color-mix()` + `on-surface` text (in-file; no rebase onto `reui/badge`); drop `pickContrast` for these two; remove red from the label colour choices in `LabelPicker.tsx`.
- **Accept:** \[ \] contrast ≥ 4.5:1 for chip text in both themes; \[ \] `data-testid="epic-chip"` stays.
- **Verify:** e2e `task-form-labels.spec.ts`, `kanban-dnd.spec.ts` (epic chip).
- **Needs:** P1-7 (chip size).

#### P2-8 · Project cards — S · wave 3

- **Do:** Spec 3-M in `pages/Projects.tsx` `ProjectCard` (:156-211).
- **Accept:** \[ \] Spec 3-M criteria.
- **Verify:** typecheck; a new e2e check for the progress text.
- **Needs:** P2-1.

#### P2-6 · Overview: My work — M · wave 3

- **Do:** Spec 3-C: Overdue and Due this week tiles link to `/tasks?view=overdue` and `?view=week`; the Open risks tile links to `/daily-review`; Needs attention above the timeline with health chips; `healthColor` to tokens; `PortfolioCalendar` row height 32px.
- **Files:** `pages/Overview.tsx`, `portfolio/PortfolioCalendar.tsx`, `lib/queries.ts` (type only).
- **Accept:** \[ \] Spec 3-C criteria; \[ \] `Executive.tsx` still renders the calendar.
- **Verify:** e2e `daily-review.spec.ts:316-323` (Recent notes), `smoke.spec.ts`.
- **Needs:** P2-5, P2-7 (the `?view=` links).

#### P2-7 · Tasks: saved views — M · wave 2

- **Do:** Spec 3-J in `pages/Tasks.tsx`: view tabs synced to `?view=`, default "All open" + `sort=due`, "Showing 200 of N", relative due column.
- **Accept:** \[ \] Spec 3-J criteria; \[ \] `Tasks.tsx` and `/tasks` stay, still out of the sidebar.
- **Verify:** e2e `filters-duplicate-chip.spec.ts`, `kanban-dnd.spec.ts:110-145, 926-1000`; a new e2e: default view has no Done rows.
- **Needs:** P2-5.

#### P2-9 · Customer account page — L · wave 3 · decision 2

- **Do:** Spec 3-E: header strip, ⋯ menu, Overview tab sections, hidden placeholder tabs, fixed active-project count, `useCustomerNotes` hook (`lib/queries.ts`, spine) on the existing `GET /customers/:id/notes`.
- **Files:** `pages/CustomerDetail.tsx` (split: new `components/customer/AccountHeader.tsx`, `AccountOverview.tsx`), `lib/queries.ts`.
- **Accept:** \[ \] Spec 3-E criteria; \[ \] Tickets tab gate and `?tab=` sync unchanged.
- **Verify:** e2e `itop-tickets.spec.ts:180,225`, `itop-board.spec.ts`, `customer-visibility.spec.ts`; a new e2e: the customer page lists its projects.
- **Needs:** P2-1.

#### P2-10 · Customers table and API — M · wave 4

- **Do:** B3 (`GET /customers` health, `backend/test/customersHealth.test.ts`); `CustomerSummary.health?` in `lib/queries.ts`; Spec 3-N data-grid in `pages/Customers.tsx`; update `customer-visibility.spec.ts:140-154` if the `h3` goes.
- **Accept:** \[ \] B3 tests; \[ \] Spec 3-N criteria; \[ \] `GET /customers` under 200 ms.
- **Verify:** backend test; typechecks; e2e `search.spec.ts:302-314`, `customer-visibility.spec.ts`; instant review (queries.ts).
- **Needs:** P2-1.

**Checkpoint — end of Phase 2:** full `gates.sh` green; phase review; timings for the four endpoints recorded for the PR body; every Phase 2 screen matches its drawing in both themes at 1440 and 390. No commit.

### Phase 3 · Polish

#### P3-1 · Loading skeletons — M · wave 1

- **Do:** `components/skeletons/` with `TableSkeleton`, `CardGridSkeleton`, `BoardSkeleton` on `ui/skeleton.tsx`, shown after 150 ms; use them in `ProjectEpics.tsx:145-148`, `SolvroKanban.tsx:441-451`, `SolvroGantt.tsx:1407-1408` (spine: one-line swap), `ProjectDetail.tsx:97-103`, `ProjectServices.tsx` (handle the unhandled `useCustomer` load), `Settings.tsx:194`.
- **Accept:** \[ \] no view renders an empty bordered box or a single grey block while loading.
- **Verify:** e2e with network throttling on Epics and Kanban.
- **Needs:** none.

#### P3-5 · API: nav badges — S · wave 1

- **Do:** B6: move the Daily Review customer/project scope from `routes/dailyReview.ts:152-223` into `lib/dailyReviewScope.ts`; add `GET /overview/badges?today=` returning `{ dailyReviewPending }`; `useNavBadges()` in `lib/queries.ts`, invalidated by "Mark reviewed".
- **Files:** `backend/src/lib/dailyReviewScope.ts`, `backend/src/routes/dailyReview.ts`, `backend/src/routes/overview.ts`, `backend/test/navBadges.test.ts`, `frontend/src/lib/queries.ts`.
- **Accept:** \[ \] `dailyReviewPending` equals the count the Daily Review page shows as not reviewed today; \[ \] a TAM sees only their own scope; \[ \] 2 queries, under 50 ms on the demo seed; \[ \] `dailyReview.test.ts` unchanged and green.
- **Verify:** backend single-file tests; typechecks; instant review (`lib/queries.ts`).
- **Needs:** none.

#### P3-2 · Grouped sidebar — M · wave 2 · decision 3

- **Do:** Spec 3-D: `group` on `NAV_COMMANDS` (`lib/navCommands.ts:14-25`); group labels and dividers in `Sidebar.tsx`; the Daily review badge from `useNavBadges()`; a styled tooltip (Base UI Tooltip in `components/ui/`); persisted `open` state with default expanded at ≥1280px; no auto-collapse on desktop link click.
- **Files:** `lib/navCommands.ts`, `layout/Sidebar.tsx`, `layout/SidebarContext.tsx`, `components/ui/tooltip.tsx` (new or existing).
- **Accept:** \[ \] Spec 3-D criteria; \[ \] the badge hides at 0 and updates after "Mark reviewed"; \[ \] `navCommands.test.ts:41` route list unchanged — `/tasks` stays out.
- **Verify:** `navCommands.test.ts`; e2e `search.spec.ts` (the palette uses the same list).
- **Needs:** P3-5.

#### P3-4 · Command palette actions — S · wave 1

- **Do:** an "Actions" group in `CommandPalette.tsx` (New project, New customer, Add task in the current project, Go to …), gated by permission; list new shortcuts in `lib/helpContent.ts:454-463`.
- **Accept:** \[ \] actions respect `hasPermission`; \[ \] `helpContent.test.ts` green.
- **Verify:** e2e `search.spec.ts`.
- **Needs:** none.

#### P3-3 · Mobile project header — S · wave 2

- **Do:** Spec 3-O in `ProjectDetail.tsx` and `TopBar.tsx` below `md`.
- **Accept:** \[ \] Spec 3-O criteria.
- **Verify:** e2e mobile project: `smoke.spec.ts`, `kanban-dnd.spec.ts:1160` (mobile card options); a new e2e: project name visible at 375px.
- **Needs:** P2-3.

**Checkpoint — end of Phase 3, the commit:** full `gates.sh`; phase review; docs-keeper if triggered; the 15 drawings re-captured as screenshots; the orchestrator appends every task's CHANGELOG entry. Then everything in the worktree — this plan's work, the demo seed (`backend/scripts/seed-demo.ts` + its CHANGELOG line) and your pending `CLAUDE.md` / `.claude/agents/` edits — is staged and a commit message drafted; the commit and the PR into `develop` happen only on your approval.

## Testing and verification

Every task proves itself with scoped checks; every wave and phase proves itself with the full, serial `gates.sh` run the orchestrator owns.

### Per task (implementor, scoped only)

| Area | Command | Rule |
| --- | --- | --- |
| Frontend types | `docker compose exec frontend npm run typecheck` | One at a time across the whole wave — concurrent runs thrashed the container on 2026-09-09 |
| Backend types | `docker compose exec backend npx tsc --noEmit` |  |
| Backend tests | `TEST_URL=$(docker compose exec backend printenv DATABASE_URL \| tr -d '\r\n' \| sed 's\|/solvro?\|/solvro_test?\|') && docker compose exec -e DATABASE_URL="$TEST_URL" backend npx vitest run test/<file>.test.ts` | Isolated `_test` DB only; plain `npm test` refuses the dev DB |
| Frontend unit | `docker compose exec frontend npx vitest run <file>` | Only the files the task touched |
| E2E | `cd e2e && npx playwright test <spec>` | Only specs whose text or selectors the task changed |

### New automated tests

**Backend (vitest + supertest, `backend/test/`)**

- `projectHealth.test.ts` — progress counts subtasks; overdue uses `overdueBoundary(today)` and excludes DONE, under a `TZ` matrix as `tasksOverdue.test.ts` does; open-risk count ignores MITIGATED and CLOSED; start/end come from min `startDate` / max `dueDate`; null when no dated tasks; a TAM gets health only for visible projects.
- `tasksFilters.test.ts` — `open`; `dueFrom`/`dueTo` inclusive, including a non-midnight row on the last day; `sort=due` puts null due dates last; `dueFrom > dueTo` returns 400 `validation_error`; `overdue` + `status` + `open` + range compose through `AND` without clobbering; `X-Total-Count` equals the full match count above 200 rows.
- `customersHealth.test.ts` — roll-up counts only the caller's visible projects of each customer; weekly update is this ISO week's; a customer with no projects returns zeros.
- `overviewWorkCounts.test.ts` — overdue, due this week (boundary on Sunday) and open risks, within the visibility scope.
- `navBadges.test.ts` — `dailyReviewPending` drops by one when the caller marks a customer's last project reviewed for today; another user's review does not count; a TAM sees only their scope.
- Existing `dailyReview.test.ts`, `epics.test.ts`, `portfolio*.test.ts`, `projectVisibility.test.ts`, `customerVisibility.test.ts` pass unchanged after `computeSlipDays` / `currentPhase` and the Daily Review scope move into `lib/`.

**Frontend (vitest)**

- `lib/labels.test.ts` — every enum value has a label; no label equals its raw value in upper snake case.
- `lib/formatDate.test.ts` — the six forms in Spec 1, current year vs other year, same-day range collapse, month-crossing range, null input, and a `TZ` matrix (UTC, Asia/Jakarta, America/Los\_Angeles) so a UTC-midnight day never shifts by one.
- Route-map test — every route in `App.tsx` resolves to a title; no page falls back to "Solvro".

**E2E (Playwright, desktop + mobile projects)**

- Update every assertion that reads changed text ("NEW PROJECT", "Active" for a task, "In Progress", "To Do", "Delete project", "My Projects", day-first dates) in the same task that changes the text.
- New smoke checks: the project header shows customer and progress; Delete lives in the ⋯ menu and still asks for confirmation; the Tasks page opens with no Done rows; the customer page lists its projects; at 390px the project name is visible and no element overlaps the search button.

### Per wave and per phase (orchestrator)

- One full `.claude/scripts/gates.sh` run at each wave integration and at phase close; it holds a lock and refuses a second run.
- Instant review for spine tasks: P1-4 (`gantt-v2/`), P2-1 (`routes/projects.ts`, `lib/queries.ts`), P2-5 (`routes/tasks.ts`, `lib/queries.ts`), P2-10 (`lib/queries.ts`), P3-5 (`lib/queries.ts`), and any task that touches the date-contract files (`DateField.tsx`, `DateRangeField.tsx`). The spine entry `lib/export/` has no folder today; the exports live in `lib/gantt/exportPdf.ts` and `exportExcel.ts`. One phase review on the combined diff before each PR.

### Manual checks before each PR

- Hard-reload the tab first: Vite HMR does not survive the dev tunnel, so an old tab shows old code.
- Check dark (default) and light themes, at 1440×900 and 390×844, against the matching drawing in the review tab.
- Time `GET /projects`, `GET /customers`, `GET /tasks?open=true&sort=due` and `GET /overview` on the demo seed before and after (`curl -w '%{time_total}'`); each stays under the 200 ms target in `backend/CLAUDE.md`. Record the numbers in the PR body.

## Risks and open questions

The largest risks are e2e churn from text changes and stale health numbers; each has a named mitigation inside a task.

| Risk | Impact | Mitigation | Task |
| --- | --- | --- | --- |
| E2E specs assert on text that changes ("Active" at `list-dnd.spec.ts:141`, "In Progress" at `kanban-dnd.spec.ts:201-202, 894-895` and `gantt-legend.spec.ts:70`, dates at `date-picker.spec.ts:792-813` and `utilization.spec.ts:131`) | Medium | The task that changes the text updates the spec in the same commit; the per-task check runs those specs | P1-1, P1-3 |
| Health numbers go stale after a task or risk edit | Medium | Task and risk mutations invalidate `["projects"]` and `["customers"]` | P2-1 |
| A `today`-dependent count survives midnight in the cache | Low | `today` is part of every health query key | P2-1, P2-5 |
| `GET /tasks` stops at 200 rows, so a saved view can be incomplete | Medium | `X-Total-Count` + "Showing 200 of N"; pagination is a later change | P2-5, P2-7 |
| Four extra aggregate queries per list push an endpoint over 200 ms | Low | Fixed query count on existing indexes; timings recorded before and after | P2-1, P2-5, P2-10 |
| Moving `computeSlipDays` / `currentPhase` changes Daily Review | Low | Pure move; `dailyReview.test.ts` must pass unchanged | P2-1 |
| `toLocaleDateString(undefined, …)` shows the previous day west of UTC today; the new formatter fixes it, which changes some visible dates | Low | `TZ` matrix tests; note it in the CHANGELOG as a fix | P1-2, P1-3 |
| Shared files edited in the same wave (`TaskFormModal.tsx`, `Admin.tsx`, `lib/queries.ts`) | Medium | Worktree isolation for P1-5 and P2-5; merge order P2-1 before P2-5 | P1-5, P2-5 |
| The `TaskFormModal` DOM is load-bearing for `kanban-dnd.spec.ts` | Medium | Keep `FieldRow` markup and native `<select>`; change labels only | P1-1, P1-5 |
| New `text-meta` role changes the design system | Low | Approved 2026-09-29; P1-7 updates `docs/DESIGN.md` in the same change as `index.css` | P1-7 |
| Five spine tasks queue for instant review | Low | Spine tasks are spread over waves; each is small | P1-4, P2-1, P2-5, P2-10 |

**Resolved decisions (2026-09-29)**

1. **Decisions 1–4** — accepted as recommended: dot + tint for labels and epics; placeholder tabs hidden; sidebar expanded at ≥1280px; due date on Kanban cards.
2. **"My tasks" in the sidebar** — not added; the `/tasks` guardrail stays unchanged.
3. **Third Overview tile** — Open risks, linking to Daily Review (the "Customer action" tile and the `label` filter on `GET /tasks` are dropped).
4. **Risk wording** — keep the derived Low / Medium / High from probability × impact (≤8, ≤15).
5. **Progress basis** — keep: projects count subtasks, epics count top-level tasks.
6. **Daily review badge** — kept, from the light `GET /overview/badges` endpoint (B6, task P3-5).
7. **Delete tone** — `ConfirmModal` gains `confirmTone="danger"` on error tokens (task P1-5).
8. **Date order** — day first (`28 Sep`, `22 – 28 Aug`, `28 Sep – 4 Oct`), `en-GB`, 24-hour time.
9. **`text-meta` role** — approved; `docs/DESIGN.md` is updated in the same change as `index.css` (P1-7).
10. **Branch and commits** — all work stays in this worktree on the current branch (already on `origin/develop`); one combined commit at the end, with the demo seed and your pending `CLAUDE.md` / agent edits, on your approval.

No decision is open. The plan is ready to start with Phase 1, wave 1 (P1-1, P1-2, P1-5) when you say go.
