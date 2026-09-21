# Solvro Project Sub-Views — Complete Design-Extraction Reference

> Raw mapping report (views-mapper agent, 2026-07-21). Covers ProjectDetail shell, all 7 sub-views, RightSidebar, and the full hand-rolled Gantt. NOTE: hex values quoted below are the LIGHT theme; Paper artboards are built DARK-first — use the dark column from `pages.md` / `components.md` token tables for fills.

---

## 0 · GLOBAL DESIGN TOKENS (from `tailwind.config.ts` + `index.css`, LIGHT theme)

**Radii** (small by design; large radii forbidden): `sm 2px` · `DEFAULT 4px` · `md 6px` · `lg 8px` · `xl 12px` · `full 9999px` (pills/avatars only).
**Font**: Source Sans 3 everywhere (`font-display` = `font-body`). `font-mono` = default mono stack (used for dates/IDs/numbers).
**Font sizes** (custom scale, +1px vs Tailwind default): `xs 13px` · `sm 15px` · `base 17px` · `lg 19px` · `xl 21px` · `2xl 25px` · `3xl 31px`. Named roles: `label-caps` = 12px / weight 700 / letter-spacing 0.05em (the ubiquitous uppercase micro-header); `data-mono` = 13px / -0.01em / weight 500 / tabular.
**Elevation**: NO card shadows. Elevation = 1px outlines (`outline-variant`) + tonal surface shifts. The ONE sanctioned shadow token is `shadow-overlay` = `0 4px 24px rgba(0,0,0,0.18)` — used only for modals, dropdown menus, popovers, drag overlay, the right context panel.

**Color hex (light theme):** surface #F9F9F7 · surface-container-lowest #FFFFFF · surface-container-low #F2F2EE · surface-container #EBEBE7 · surface-container-high #E4E4E0 · surface-container-highest #DEDEDA · on-surface #1A1A18 · on-surface-variant #4A4A47 · outline #9A9A97 · outline-variant #D0D0CC · primary #2D9042 · on-primary #FFFFFF · primary-container #C8E6CF · error #BA1A1A · error-container #FFDAD6 · on-error-container #93000A · chip-emerald #DCFCE7/#16A34A · chip-amber #FEF3C7/#D97706 · chip-rose #FEE2E2/#DC2626 · chip-violet #EDE9FE/#6D28D9 · sidebar (fixed) #232321 · ink #191919.

Note: `IN_PROGRESS` status chip uses tone "blue" = `bg-primary/10 text-primary` (green-tinted, NOT literal blue).

---

## 1 · ProjectDetail.tsx — THE TAB SHELL

Wrapper `<div>` is `flex h-full flex-col`, with a right margin that animates (200ms ease-out) to make room for panels: `md:mr-80` (320px) when context panel open, `md:mr-[380px]` when a task panel is open, else `mr-0`.

**Meta row** (`mb-3`, flex, stacks column on mobile → row `md:`, `justify-between`):
- Left: project `description` (`text-sm text-on-surface-variant`, `max-w-2xl`); below it a 12px line: `SA {username} → TAM {username} · {n} tasks` (the SA/TAM names are `font-medium text-on-surface`).
- Right (shrink-0, gap-2): two buttons.
  - **Edit project** button: `rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-bold`, icon `edit` (16px) + "Edit project". Hover → `bg-surface-container`. (Only if `project:write`.)
  - **Context** toggle: same shape; when OFF `border-outline-variant bg-surface-container-lowest`, when ON `border-primary bg-primary/10 text-primary`. Icon swaps `right_panel_open` ⇄ `right_panel_close`. Label "Context".

**Tab bar** (`<nav>`): `mb-6 flex gap-6 border-b border-outline-variant`, horizontally scrollable, `whitespace-nowrap`. Order:
`Overview · List · Kanban · Gantt · Timeline · Risks · Services`
Each tab: `-mb-px border-b-2 px-1 pb-3 text-sm`. **Active**: `border-primary text-primary`. **Inactive**: `border-transparent text-on-surface-variant`, hover → `text-on-surface`. The **Gantt** tab is `hidden md:inline-block` (desktop-only). No pill/background — pure underline indicator.

Below tabs: `<Outlet>` renders the active view. Modals mounted here: `ProjectFormModal` (edit), `RightSidebar`, and `TaskPanel` (deep-linked via `?task=<id>`).

---

## 2 · RightSidebar.tsx (project context panel)

Fixed panel, `right-0 top-14 bottom-0`, `w-full md:w-context-panel` (320px). `border-l border-outline-variant bg-surface-container-low/95 backdrop-blur-md`, slides in via `translate-x-0 / translate-x-full` (200ms). On mobile a `bg-black/40 backdrop-blur-[1px]` scrim sits behind. `font-display` throughout.

- **Header** (`px-5 py-4`, border-b): left label "Project context" in `label-caps uppercase tracking-widest text-on-surface-variant`; right a 28×28 `close` icon button.
- **Body**: `space-y-6 px-5 py-5`, scrollable. Sections:
  1. **Status + name**: `ProjectStatusChip` (pill), then `h2` project name (`text-base font-semibold`), then 3-line-clamped description (`text-xs`).
  2. ~~**Blueprint reference**: `label-caps` heading; a bordered card (`rounded border p-3`) with filled `schema` icon (primary), "SA Blueprint v2.4" title, subtitle "Source-of-truth payload (JSONB) — read-only.", and a primary link "View source documentation" + `open_in_new` (15px).~~ **Removed 2026-08-03** — Secure Ingestion Port cancelled; this card no longer exists in `RightSidebar.tsx`. Do not regenerate DESIGN.md with this section.
  3. **Stakeholders**: `label-caps` heading; a `<dl>` of `text-[13px]` rows (label left in variant color, value right in `font-medium`): TAM, SA, Customer (customer is a primary link), Tasks count.
  4. **Export schedule** (only when Gantt is mounted): heading + a 3-col grid of outline buttons (`rounded border px-2.5 py-2 text-[12px] font-semibold`, hover → primary): **Excel** (`table_view` icon), **PDF** (`picture_as_pdf`), **View** (`open_in_new`). Caption below explains each. Icons 17px.
  5. **Documents** (if customer): a bordered link card with filled `description` icon, "Customer documents" title, "Go to Documents" + `chevron_right`.

---

## 3 · ProjectOverview.tsx

Vertical `space-y-4`.

**A. KPI strip** — responsive grid `sm:grid-cols-2 lg:grid-cols-4`, gap-4. Each `Kpi` card: `rounded border border-outline-variant bg-surface-container-lowest p-4`.
- Top row: `label-caps uppercase` label (left) + material icon (right, 16px, colored by accent).
- Value: `text-3xl font-bold tabular-nums`, colored by accent (`text-emerald-600` / `text-error` / `text-primary` / default `text-on-surface`).
- Hint line: `text-on-surface-variant` (13px).
The four KPIs, in order:
  1. **Total tasks** — icon `checklist`; hint `"{n} top-level · {m} subtasks"`.
  2. **Completion** — icon `task_alt`; value `"{pct}%"`; hint `"{done} of {total} done"`; accent emerald when 100%.
  3. **Overdue** — icon `warning`; hint "open tasks past due date" / "nothing overdue"; accent error if >0 else emerald.
  4. **Baseline** — icon `lock`/`lock_open`; value "Locked"/"Not set"; hint = who locked + date, or "Lock to capture planned dates"; accent primary when locked.

**B. Progress S-Curve section** — `rounded border bg-surface-container-lowest p-5`.
- Header: `h3` "Progress S-Curve" (`text-base font-semibold`) + subtitle (12px). When no baseline (and the user has `project:write`), a right-aligned outline button "Lock baseline" with `lock` icon — opens the Context panel (outlet context `openContext()`), where the lock action lives since 2026-08-31.
- Chart: recharts `LineChart`, height `h-72` (288px), `ResponsiveContainer`.
  - `CartesianGrid` dashed `3 3`, horizontal only, `outline-variant`.
  - X axis = date labels ("Jul 12"), 11px variant. Y axis = cumulative count, 11px, no decimals.
  - **Current line**: `stroke primary`, width 2.5, no dots. **Baseline line** (only if locked): `stroke on-surface-variant`, width 2, dashed `6 4`.
  - `ReferenceLine` at today: dashed `4 4`, label "Today" top-right.
- Legend footer (when baseline present): dot swatches — grey "Baseline (planned)", primary "Current (re-planned)", emerald "Completed today: X/Y" — plus right-aligned mono "Slip: +N days" (error if positive, emerald if ≤0).
- Empty state: dashed-border box `h-72` with `show_chart` icon (31px) + "No scheduled tasks yet".

Sample data fields: task `status`, `dueDate`, `baselineDueDate`, `parentTaskId`.

---

## 4 · ProjectList.tsx (table view)

Top-right toolbar (`mb-3 justify-end gap-2`): **Add section** (outline `rounded-lg` button, `add` icon) + **Add task** (solid primary `rounded-lg` button, `add` icon). Both gated on `task:write`.

**Table** wrapper: `overflow-x-auto rounded border bg-surface-container-lowest`.
Column header row (desktop only, `hidden md:grid`): grid template **`[28px_minmax(200px,1fr)_60px_70px_50px_100px]`**, gap-2, `px-3 py-2`, `label-caps uppercase tracking-widest text-on-surface-variant`. Columns: `(drag) · Name · Owner · Due · Prio · Status`.

**Section group** (`SectionGroup`): header bar `bg-surface-container-low px-3 py-1.5`, drop-target ring `ring-2 ring-inset ring-primary/40` when hovered during drag. Contains: chevron (`chevron_right`/`expand_more`), a `h-2 w-2 rounded-full` **section color dot** (uses `section.color`), section name (`text-sm font-semibold`; "No section" italic variant), a count pill (`rounded-full bg-surface-container-high px-1.5 font-mono text-[11px]`), and (canEdit) right-aligned `edit` + `delete` icon buttons (17px).

**Task row** (`TaskRow`, desktop grid, same template): `cursor-pointer border-t px-3 py-1.5 hover:bg-surface-container-low`, `opacity-40` while dragging. Cells:
- Drag handle `drag_indicator` 16px `text-on-surface-variant/50`.
- Name: optional subtask chevron (15px) + title `text-sm` (DONE → `line-through text-on-surface-variant`).
- Owner: `AssigneeSelect` (avatar button, opens a dropdown of users; "Unassigned" option).
- Due: `DueDateEditor` — shows `fmt(dueDate)` ("Jul 16" / "—"); click opens a `<input type=date>` popover with Cancel/Save.
- Prio: a `flag` icon (15px) whose color cycles LOW `text-on-surface-variant` → MED `text-chip-amber-text` → HIGH/URGENT `text-error`; click cycles priority.
- Status: `StatusSelect` chip — pill `rounded-full px-2 py-0.5 text-[11px] font-semibold` with tone (`TODO` = `bg-surface-container-high text-on-surface-variant`, `IN_PROGRESS`/`DONE` = `bg-chip-emerald-bg text-chip-emerald-text`) + `expand_more`; dropdown of To do / Active / Done.

**Subtask row** (`SubtaskRow`): indented `pl-[34px]`, `bg-surface-container-low/40`, `text-[12.5px]`. Drag handle (14px) + a round checkbox (`h-3.5 w-3.5 rounded-full border`; DONE → `border-emerald-500 bg-emerald-500 text-white` with `check` glyph) + title (strikethrough when done). Below subtasks (canEdit): an "Add subtask…" ghost button (`pl-[52px]`, `add` 14px).

**Mobile card** variant (`md:hidden`) per row: title + `flag`, then avatar + due date + status pill.
Add-section inline form appears at table bottom: text input + primary "Add" + "Cancel".

---

## 5 · ProjectKanban.tsx

Toolbar (`mb-3 justify-end`): **Filter** button (outline `rounded-lg`; when active → `border-primary bg-primary/10 text-primary` with a count badge `h-4 w-4 rounded-full bg-primary text-[10px]`), opens a `w-64` popover (`shadow-overlay`) with Assignee + Priority selects and "Clear filters". Then **Add task** solid primary button.

Mobile-only pager header (`md:hidden`): `chevron_left` / centered column label + count pill / `chevron_right`, plus a row of dot indicators (`h-1.5 w-1.5 rounded-full`, active = `bg-primary`).

**Board**: on mobile a horizontal snap-scroller; on desktop `md:grid md:grid-cols-3 gap-4`.

**Column**: `flex flex-col gap-2.5 rounded-xl bg-surface-container p-2`; drop-over ring `ring-2 ring-inset ring-primary/40`. Columns: **To Do · In Progress · Done**.
- Header (`px-1 pb-1`): `h3 text-sm font-bold`, a count pill (`rounded-full px-2 py-0.5 text-[11px]`; over WIP-limit → `bg-chip-amber-bg text-chip-amber-text` showing `"{n} / {limit}"`), spacer, `more_horiz` menu button (opens "Add task here").
- Empty state: dashed box "Drop tasks here" `px-3 py-8 text-[12px]`.

**TaskCard**: `rounded border bg-surface-container-lowest p-3`, `hover:border-primary`. Dragging overlay variant: `rotate-[-1.2deg] border-[1.5px] border-primary shadow-overlay ring-2 ring-primary`; source card `opacity-40`. Anatomy top→bottom:
1. **Title row**: optional `drag_indicator` handle (16px) + title `text-[15px] font-bold leading-tight` (DONE prefixed with primary `check_circle` 14px). Right side: a duration chip (`schedule` icon 15px + `"{n} Days"` / date / "—") and a mobile `more_horiz`.
2. **Labels**: up to 2 `LabelChip`s (custom bg color) + "+N" overflow.
3. **Description**: `line-clamp-2 text-[13px] text-on-surface-variant`.
4. **Subtask checklist**: a `label-caps` "Subtasks {done}/{total}" header with `check_circle` (12px), then a `border-l pl-2` list of subtask rows (drag handle + round checkbox + title + xs avatar). Drop indicator = `h-0.5 rounded-full bg-primary` line.
5. **Footer**: left `chat_bubble` (14px) + comment count; right `PriorityBadge` + `AssigneeAvatar size="sm"`.

**MobileMoveSheet**: bottom sheet (`rounded-t-2xl`, `bg-inverse-surface/40 backdrop-blur-sm` scrim) listing the 3 columns as radio rows (selected = primary filled circle + `check`).

---

## 6 · ProjectGantt.tsx (wrapper only)

Renders `<GanttFrame>` inside `hidden md:block` (desktop) and `<ProjectList>` inside `md:hidden` (mobile fallback). Owns the create/edit `TaskFormModal`s.

---

## 7 · ProjectTimeline.tsx (phase-level vertical timeline)

An ordered list `<ol class="relative ml-3 border-l border-outline-variant">` — a single vertical spine. Tasks sorted by start → due → priority → id. Each `TimelineItem` (`<li class="mb-4 ml-6">`):
- **Node dot** on the spine: `absolute -left-[34px] h-4 w-4 rounded-full border-2 border-surface-container-lowest`; fill by status — DONE `bg-emerald-500`, IN_PROGRESS `bg-primary`, TODO `bg-surface-container-highest`.
- **Card**: `rounded border p-4 hover:border-primary/40`.
  - Header row: left chips — `TaskStatusChip` + `PriorityBadge compact` + up to 4 `LabelChip compact`; right a mono date range `"{start} → {due}"` (`font-mono text-[12px]`), turning `font-bold text-error` + " · OVERDUE" when overdue.
  - Title (button, `text-sm font-medium`, hover primary) + `AssigneeAvatar size="xs"` right.
  - Optional description (`text-[12px]`).
  - Subtask sub-list (`border-l pl-3`, `text-[12px]`): each prefixed `✓` (done, strikethrough) or `·`.
  - canEdit: 3 status buttons (To do / In progress / Done) — `label-caps uppercase`; active = `bg-primary text-on-primary`, others outline hover-primary.
Empty state: dashed box "No tasks yet. Add tasks from the Kanban board."

---

## 8 · ProjectRisks.tsx

Vertical `space-y-4`.
**Summary + add row**: left cluster of 4 `Stat` badges (`rounded border px-3 py-1.5 label-caps uppercase`, mono value): **High** (error tone `border-error/40 bg-error-container`), **Medium** (`border-amber-300 bg-amber-50 text-amber-800`), **Low** (`border-emerald-300 bg-emerald-50 text-emerald-700`), **Open** (neutral). Right: **Add risk** solid primary button.

**Filter bar**: `rounded border bg-surface-container-lowest p-3`, flex-wrap. A search input (`type=search`, `sm:w-72`), a **Category** select, a **Status** select (each is a `label-caps` label + native `<select>`), plus a "Reset" text button when any filter active.

**Desktop table** (`hidden md:block`, `rounded border`): `<table class="w-full text-sm">`. Head `bg-surface-container-low label-caps uppercase tracking-widest`. Columns + widths:
| Description | Category | Prob (w-24, center) | Impact (w-24, center) | Score (w-28, center) | Status (w-32) | (actions w-20) |
Row (`hover:bg-surface-container-low`, `divide-y`):
- Description cell (`max-w-[28rem]`): title button (`text-sm font-medium`, hover primary) + optional 2-line-clamped Mitigation / Contingency (each label `font-display font-bold uppercase`).
- Category: `text-xs text-on-surface-variant` label.
- Prob / Impact: native `<select>` 1–5 (`font-mono text-xs`), or plain mono number if read-only.
- **Score cell**: a badge `flex items-center justify-center gap-1 rounded border px-2 py-1 font-mono text-xs font-bold tabular-nums` colored by `scoreClass`: **≤8** `border-emerald-300 bg-emerald-50 text-emerald-700` (Low) · **9–15** `border-amber-300 bg-amber-50 text-amber-800` (Medium) · **>15** `border-error/40 bg-error-container text-on-error-container` (High). Shows the number + a `label-caps` level word.
- Status: native `<select>` styled with tone, or a pill. `STATUS_TONE`: OPEN `bg-error-container text-on-error-container`, MITIGATED `bg-amber-100 text-amber-800`, CLOSED `bg-emerald-100 text-emerald-700`.
- Actions: `edit` + `delete` icon buttons.

**Mobile cards** (`md:hidden`): title + score badge (top), then category · "P{p} · I{i}" · status pill, then edit/delete.

Sample data: `description`, `category` (EXTERNAL/INTERNAL/TECHNICAL/ORGANIZATIONAL/FINANCIAL), `probability` 1–5, `impact` 1–5, `status`, `mitigationPlan`, `contingencyPlan`. Score = p×i (live).

---

## 9 · ProjectServices.tsx

Thin wrapper (`space-y-4`). Optional **Bulk actions** row: `label-caps` "Bulk actions" left, an outline **"Add all subscribed"** button (`playlist_add` icon) right. Then delegates to `<ServiceMappingList>` (titled "Services in Scope"; see components.md §18). Error banner uses the standard `border-error/30 bg-error-container` style.

---

## 10 · THE GANTT (hand-rolled) — EXHAUSTIVE

### 10.0 Geometry constants (`lib/gantt/constants.ts`)
- `AXIS_HEIGHT = 44` (two 22px bands)
- `ROW_HEIGHT = 30`
- `BAR_HEIGHT = 14` (subtasks render at 0.8× = 11.2px)
- `MILESTONE_SIZE = 12` (diamond)
- `RESIZE_HANDLE_PX = 6`
- List pane sub-columns: `AVATAR_COL_WIDTH = 22`, `NAME_COL_WIDTH = 220`, `DATE_RANGE_COL_WIDTH = 118`, `ROW_PAD_X = 8`. Default pane width = **384px**; resizable, clamped 180–560; divider 4px.
- **Column widths per zoom** (fixed — chart never stretches): `day 60` · `week 140` · `month 220` · `quarter 260`.
- Chart is padded ±1 year around the task date-range, snapped to unit boundary.

### 10.1 Palette (`lib/gantt/palette.ts`)
Bars colored by 3 modes:
- **status**: TODO `#bae6fd` · IN_PROGRESS `#60a5fa` · DONE `#34d399`.
- **priority**: LOW `#94a3b8` · MEDIUM `#3b82f6` · HIGH `#f59e0b` · URGENT `#ef4444`.
- **section**: uses each Section's own `color` (default `#94a3b8`).
Bar "track" (unfilled) = fill color at **opacity 0.28**; progress overlay = SAME color at full opacity from left up to `progressPct%`.
Weekend shade `#e2e8f0`; holiday `#fecaca`; today `#3aae51`.
Section color-picker presets: `#94a3b8 #3b82f6 #0ea5e9 #14b8a6 #10b981 #f59e0b #ef4444 #8b5cf6`.

### 10.2 GanttFrame — outer frame + toolbar
Outer: `rounded border border-outline-variant bg-surface-container-lowest overflow-hidden`.
**Toolbar** (`border-b bg-surface-container-lowest px-3 py-1.5`, flex gap-2):
1. **Zoom pill group** (`inline-flex rounded-md bg-surface-container-low p-0.5`): Day / Week / Month / Quarter segments (`rounded px-2.5 py-1 text-[11.5px] font-semibold`). Active = `bg-primary text-on-primary`. Default **Week**.
2. (canEdit) vertical divider (`h-4 w-px bg-outline-variant`) then **+ Task** and **+ Section** in one segmented pill (`text-[11.5px] font-medium`, sentence case like every other toolbar item — was `label-caps uppercase` until 2026-08-31; `add` 15px, hover primary).
3. `font-mono text-[12px]` status "{n} dated · {m} sections" (`lg:` only).
4. Right cluster (`flex-1 min-w-0 flex-wrap justify-end gap-2` since 2026-08-31 — folds one group at a time, never as a block; ≈510px wide), every group a segmented pill (`rounded-md bg-surface-container-low p-0.5`, items `h-7 text-[11.5px] font-medium`):
   - **Today ‹ ›** pill (`today` 15px + prev/next chevrons) then the period title as plain text ("August 2026").
   - **Baseline** ghost toggle (`show_chart` 15px) — ON: `bg-primary text-on-primary`, `aria-pressed`. Tooltip reports the lock state.
   - **Color by** menu button (10px caps "COLOR BY" + current mode + `expand_more`): Base-UI dropdown (`positionerClassName="z-50"`, `shadow-overlay`, `bg-surface-container-lowest`, `w-60`) with `status / section / priority` radio items on top and, in a `role="group"` "Key", the full color key (8px swatches + labels, no cap). Picking a radio keeps the menu open. No inline legend, no native `<select>`.
   - **Export** icon-only (`download` 15px, `aria-label`/`title` "Export") → hand-rolled dropdown (`shadow-overlay w-32`): **Excel** / **PDF** rows.
   - **Lock baseline / Reset baseline** is NOT in the toolbar — it lives in the Context panel's "Baseline" section (`RightSidebar.tsx`, `project:write`): locked date · user (or "Not yet"), the button (`bookmark_add` / `bookmark`), ConfirmModal with as-of date + "Clear baseline instead", inline `text-primary` status line.
Inline **Add-section form**: `bg-surface-container-low px-3 py-2`, input + primary "Add" + "Cancel".
Empty state: dashed box "No tasks have start or due dates yet…".
**Success toast** (baseline locked): fixed bottom-center pill, `rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 label-caps`, `check_circle` icon.

**Scroller layout**: one horizontal scroller: **[sticky ListPane] · [4px drag divider] · [ChartPane]**. Divider: `cursor-col-resize bg-outline-variant/40 hover:bg-primary/60 active:bg-primary`, sticky at `left: listPaneWidth`.

### 10.3 GanttListPane + GanttListRow (left table)
Sticky-left (`sticky left-0 z-30 border-r bg-surface-container-lowest`).
- **Header** (height 44, `bg-surface-container-low border-b`): "Task" (`label-caps uppercase tracking-widest`) + "Dates" right-aligned in the 118px column.
- **Rows** (height 30, `border-b`, `group`):
  - Section rows: `bg-surface-container-low hover:bg-surface-container`; drop-hover `ring-2 ring-inset ring-primary`; dragging `opacity-40`.
  - Task rows: `bg-surface-container-lowest hover:bg-surface-container-low`; hovered (synced with chart) `bg-surface-container-low/70`.
  - **Indent** = `depth × 14px`. Then: `drag_indicator` (15px, top-level tasks + sections only) → chevron for sections/parents (17px) → sections get a **color dot** button (`h-2 w-2 rounded-full`) opening the preset-swatch popover (`shadow-overlay`, 8 × `h-4 w-4` circles, hover `ring-2 ring-primary`).
  - **Name**: sections `text-[13px] font-bold uppercase tracking-wider`; top-level `text-[13px]`; subtasks `text-[12px]`; DONE non-section → `line-through` muted. Hover → primary. Truncates.
  - "(No section)" pseudo-row: mono hint "· drop a task here to clear its section".
  - Non-section rows: `AssigneeAvatar xs` in a 22px slot.
  - **Dates column** (118px, right): `font-mono text-[11px]` "12 Jul – 16 Jul". Click (canEdit) opens `InlineDateRangeEditor`. Empty on sections.

### 10.4 GanttDateAxis (sticky top, height 44)
`sticky top-0 z-20 border-b bg-surface-container-lowest`. Two 22px bands:
- **Top band**: grouped labels — month+year ("JUL 2026") for day/week/month zoom, year for quarter. `text-[12px] font-semibold uppercase tracking-wider`, group `border-r border-outline-variant/60`.
- **Bottom band**: one label per column (`border-r /40`, `text-[11px]`), weekends dimmed `/60`: day → mono "07"; week → semibold "W{ISO}"; month → "Jan"; quarter → "Q{n}".
- **Today pill**: `rounded-full bg-primary px-2 text-[11px] font-bold text-on-primary shadow`, centered on today's column, hanging at `-bottom-2`.

### 10.5 GanttColumnGrid (background)
`absolute inset-0 z-0`. Column separators `border-r border-outline-variant/40`. **Weekend shading** (day/week zoom): `bg-slate-900/[0.04]` (dark: `bg-white/[0.05]`). **Holiday shading** (all zooms): `bg-rose-500/10` (dark `bg-rose-400/15`), tooltip "{name} — {iso}".

### 10.6 GanttTodayLine
2px `bg-primary` vertical line on today's column, full height, `z-5`.

### 10.7 GanttRow + GanttSectionBar
Rows height 30, `border-b`, hovered `bg-surface-container-low/70`. Section rows render **GanttSectionBand** = full-width tint `rgba(sectionColor, 0.07)`.

### 10.8 GanttBar — critical detail
- **Position**: `left = positionFor(start)`, right = `positionFor(dueDate + 1 day)` (inclusive). Min width = `columnWidth/7`.
- **Height**: 14px (subtasks 11.2px), centered in 30px row.
- **Track**: `rounded-[3px] overflow-hidden`, `backgroundColor rgba(fill, 0.28)`. Drag ring `ring-2 ring-primary/60`.
- **Progress overlay**: `inset-y-0 left-0 rounded-[3px]`, width `progressPct%`, solid fill. (DONE=100; parent = done/total; else 0.)
- **Resize handles** (hover-reveal): 6px strips each end, `bg-white/35`, `cursor-ew-resize`.
- **Connector dots**: two `h-3 w-3 rounded-full border-2 border-white bg-primary shadow` dots at left/right mid-edges, `cursor-crosshair`, row-hover only.
- **Milestone**: **12px green diamond** SVG `path d="M6 0 L12 6 L6 12 L0 6 Z"` fill `rgb(var(--primary))` (always green), centered on date.
- **Baseline ghost** (Baseline on + task has baseline dates): thin **3px** bar, `rgb(136,135,128)` at opacity 0.6, `rounded-[1.5px]`, 2px BELOW the main bar (milestones: rounded-full). Tooltip "Baseline: {start} → {end}".
- Bar tooltip: `"{name} · {status} · {progress}%"`.

### 10.9 GanttConnectors (dependency arrows)
SVG overlay (`z-5`). Stepped orthogonal path in `on-surface-variant`:
- Route: predecessor right edge → 8px forward → vertical to successor row → 8px back-nudge into successor left edge → **arrowhead** (`M0,0 L10,5 L0,10z`, 6×6). Detours around row band if successor is behind/above.
- Stroke: 1.25px at opacity 0.75; **HARD** solid, **SOFT** dashed `5 4`.
- Hover: recolors `primary`, 2px, opacity 1, shows **delete control** at midpoint — 8px `fill primary stroke white` circle with white ✕. Fat 14px transparent hit-stroke.

### 10.10 Connect-drag rubber band
Dashed `4 4` primary line from source dot to cursor + 4px primary dot at cursor.

---

## 11 · SHARED CHIP / BADGE / AVATAR ANATOMY

- **StatusChip / ProjectStatusChip**: `CHIP_BASE = inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-display text-[11px] font-semibold leading-[18px]`. Task tones: TODO gray, IN_PROGRESS blue(=primary tint), DONE emerald. Project tones: PLANNING blue, ACTIVE emerald, ON_HOLD amber, COMPLETED blue, CANCELLED rose.
- **PriorityBadge**: pill `rounded-full text-[11px] font-semibold leading-[18px]`, `px-1.5` compact / `px-2` normal. LOW & MEDIUM gray, HIGH amber, URGENT rose. Labels "Low / Med / High / Urgent".
- **LabelChip**: pill with custom `label.color` bg; auto-contrast fg (`#191b23` / `#ffffff`). `text-[11px] font-semibold`.
- **AssigneeAvatar**: `rounded-full bg-primary text-white font-bold`, initials ≤2. xs `h-5 w-5 text-[10px]` · sm `h-6 w-6 text-[11px]` · md `h-8 w-8 text-xs`. Unassigned = dashed circle "?".

---

## 12 · MATERIAL-SYMBOLS ICONS INVENTORY (name · where · size)

`edit` (16px), `right_panel_open`/`right_panel_close` (16px), `close` (16px), `schema` (filled), `open_in_new` (15–17px), `description` (filled), `table_view`/`picture_as_pdf` (17px), `checklist`/`task_alt`/`warning`/`lock`/`lock_open` (16px), `show_chart`/`download`/`today`/`bookmark`/`bookmark_add` (15px), `add` (14–16px), `chevron_right`/`expand_more` (15–17px), `drag_indicator` (14–16px), `flag` (15px), `check` (10–11px), `check_circle` (12–14px), `schedule` (15px), `chat_bubble` (14px), `more_horiz` (16–17px), `filter_alt` (16px), `chevron_left`/`chevron_right` (mobile pager), `delete` (16–17px), `playlist_add` (16px).
