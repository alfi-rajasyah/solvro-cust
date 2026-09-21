# ReUI Gantt Swap — Design Spec

**Date:** 2026-07-24
**Status:** Approved (user), pending implementation plan
**Supersedes:** the "Evaluated and rejected: ReUI Gantt swap" decision of 2026-07-22 in `docs/ideas/gantt-bar-reskin.md`

## Context

The 2026-07-22 evaluation rejected adopting ReUI's Gantt and chose a paint-only
re-skin of the hand-rolled engine instead (now shipped). That evaluation was made
from ReUI's documentation site. On 2026-07-24 the component's actual vendored
source (9 files, ~8.8k LOC, fetched from the shadcn registry at `reui.io/r/`)
was audited, which **confirmed** the four cited gaps — ReUI's Gantt has no
dependency connectors, no baselines, no milestone markers, and no export — and
surfaced one new constraint: the source requires **Tailwind v4** syntax, while
Solvro's frontend is on Tailwind 3.4.

With that evidence on the table, the user decided to reverse the standing
decision and adopt ReUI's Gantt anyway, rebuilding the missing features on top.
Decisions made interactively during brainstorming:

| Decision | Choice |
|---|---|
| Outcome | Full swap of the Gantt engine (not a feasibility doc, not selective borrowing) |
| Parity bar | All four: dependency arrows, baselines, milestones, Excel/PDF export |
| Stack posture | Full shadcn bootstrap (`components.json`, official `npx shadcn add @reui/gantt`) |
| Tailwind gap | Migrate the whole frontend to Tailwind v4 (no v3 down-port fork) |
| Migration | Branch big-bang: build on a feature branch to parity, replace directly, delete the old engine |

The `gantt-task-react` guardrail is untouched — that library is still never
installed. ReUI's Gantt arrives as vendored source via the shadcn registry, not
as an npm Gantt dependency.

## What ReUI's Gantt provides (verified from source)

- Collapsible resource-tree pane + timeline pane with synced scrolling
- Drag-to-move (x-axis only, never across rows), resize with per-event
  `draggable`/`resizable`/`readOnly` overrides, drag-to-reorder tree rows
  (`GanttResourceReorder` includes reparenting)
- Scales: `day | week | month | quarter | year`; today highlight; off-day
  shading (`weekendDays`, explicit `dates`, predicate)
- `progress` fill (0–100), per-event `color` via `--gantt-event-color`
- `renderEvent` consumer slot: custom bar content suppresses built-ins;
  built-in inside/outside auto-flip bar labels
- Update pipeline: `GanttProposedUpdate` → callback returns
  `GanttUpdateResult` (`false` = revert, object = accept-with-adjustment)
- Recurrence, i18n, timezone support (unused by Solvro; harmless)
- **Not provided:** dependency connectors, baselines, milestones, export,
  virtualization

Hard dependencies of the vendored source: `@base-ui/react` (`useRender`,
`mergeProps`, scroll-area primitive), `date-fns`, `@date-fns/tz`, `cn()`
(clsx + tailwind-merge), and 8 shadcn ui components: button, calendar,
checkbox, context-menu, dropdown-menu, popover, scroll-area, tooltip.
Tailwind v4-only class syntax throughout (`bg-(--var)/20`, `pointer-coarse:`,
container queries, bare `data-*:` variants).

## Phase 0 — Tailwind v4 migration + shadcn bootstrap (prerequisite)

1. Upgrade `tailwindcss` 3.4 → 4.x; replace PostCSS/autoprefixer wiring with
   `@tailwindcss/vite`; run the official upgrade tool, then hand-port the
   Technical Precision theme from `frontend/tailwind.config.ts` into CSS-first
   `@theme` in `frontend/src/index.css`. All custom tokens survive by name
   (`w-sidebar` 260px, `w-context-panel` 320px, colors, the full DESIGN.md
   port). Dark mode stays class-driven via `@custom-variant dark` so
   `frontend/src/lib/theme.tsx` keeps working unmodified.
2. Bootstrap `components.json` with `cn()` at `frontend/src/lib/utils.ts`.
   Map shadcn's semantic CSS variables (`--background`, `--foreground`,
   `--primary`, `--muted`, `--border`, …) to Technical Precision values in
   both light and dark blocks, so vendored shadcn/ReUI components inherit the
   design system without per-component restyling. DESIGN.md remains binding;
   the variable map is the enforcement point.
3. Install the 8 shadcn ui deps listed above. New npm deps:
   `@base-ui/react`, `date-fns`, `@date-fns/tz`, `clsx`, `tailwind-merge`.
   Per repo rules: install inside the frontend container **and** on the host,
   then restart the frontend service (tailwind config changes need it).
4. **Exit gate (blocks Phase 1):** frontend typecheck passes; full-app visual
   sweep — every sidebar screen in light and dark at desktop and 375px —
   shows no regressions; existing Playwright suite passes. This phase is the
   project's largest regression risk and gets its own QA pass and CHANGELOG
   entry before any Gantt work starts.

## Phase 1 — ReUI install + Solvro adapter

1. `npx shadcn@latest add @reui/gantt` → `frontend/src/components/reui/gantt/`
   (9 files). Replace the registry's `IconPlaceholder` imports with inline
   SVGs or existing Solvro icons.
2. New `SolvroGantt` container (successor to `GanttFrame.tsx`'s wiring) reuses
   the existing TanStack hooks unchanged: `useProjectTasks`,
   `useProjectSections`, `useProjectDependencies`, `useUpdateTask`,
   `useCreateDependency`/`useDeleteDependency`, `useLockBaseline`,
   `useHolidays`, and the `useGanttExport` register pattern.
3. Data mapping (the adapter is the single owner of all conversions):
   - Section → parent `GanttResource` (collapsible group; `color` from the
     section palette). Task → child node, `scheduleMode: "single"`. Subtasks →
     nested children per `parentTaskId`.
   - Task → `GanttEvent`: `start` = `startDate`; **`end` = `dueDate` + 1 day**
     (ReUI ends are exclusive; Solvro due dates are inclusive — the adapter
     converts on the way in and back on the way out). Due-only tasks anchor a
     1-day bar on the due date (rule ported from
     `frontend/src/lib/gantt/geometry.ts:394`). `progress`, `readOnly` from
     permissions (`canEdit`), `data` carries the raw `Task`.
   - `color` = the color-by mode logic from `frontend/src/lib/gantt/palette.ts`
     (status / section / priority modes preserved, including the deterministic
     vivid fallback for legacy-slate sections).
   - Drag/resize → `onEventUpdate`: convert exclusive end back to inclusive
     `dueDate`, commit via optimistic `useUpdateTask`; return `false` to
     revert on validation or mutation failure.
   - Row reorder → the existing canonical shared-order mutation (one manual
     order across List/Kanban/Gantt). Reparent drops map to section /
     `parentTaskId` reassignment; drops that don't map to a legal Solvro move
     are rejected in the reorder callback.
   - `offDays`: default weekends + explicit dates from `useHolidays`.
4. Solvro chrome stays custom around the component: zoom pills (day / week /
   month / quarter mapped to ReUI `scale`), color-by toggle, legend, baseline
   toggle + lock-baseline confirm/toast flow, export buttons, create-task
   entry points (`TaskFormModal` wiring in `ProjectGantt.tsx` is unchanged).
5. `renderEvent` slot renders Solvro bar content:
   - **Solid fills** — override ReUI's default 20%-opacity track via
     `classNames.event`; the 2026-07-22 re-skin decision (solid bars, darker
     progress overlay) carries over. The washed-out default is exactly what
     the re-skin removed; it must not return.
   - AI Breakdown amber glow for blueprint-generated tasks (styling hook now;
     activates when the ingestion port ships).
   - Bar labels: adopt ReUI's built-in inside/outside auto-flip, verified
     against the GH #58 acceptance criteria (label inside iff the full name
     fits; outside labels visually tied to their bar). If the built-in cannot
     satisfy GH #58, port the measured-fit logic into `renderEvent`.

## Phase 2 — parity rebuilds

1. **Milestones (easiest):** `isMilestone` tasks render a diamond via
   `renderEvent` with `resizable: false`; drag-to-move stays allowed.
2. **Chart-space SVG overlay (connectors + baselines), one component:**
   - Positioned over ReUI's timeline pane. Bar anchors come from **DOM
     measurement**: `renderEvent` injects `data-task-id`, and the overlay
     resolves each bar's rect relative to the pane, re-measuring on scroll,
     zoom, collapse/expand, and drag via rAF-batched ResizeObserver + scroll
     listeners. DOM measurement (not math re-derivation) because ReUI owns
     layout — collapsed groups and future upstream changes would silently
     break recomputed coordinates.
   - Connectors: port the stepped-path builder, HARD-solid/SOFT-dashed
     styling, hover ×-delete, and hit-path trimming from
     `frontend/src/components/gantt/GanttConnectors.tsx` as pure functions.
     Connector-dot drag-create is re-injected through `renderEvent`, reusing
     the existing `onConnectStart` → `useCreateDependency` flow.
   - Baselines: when the toolbar toggle is on and the project baseline is
     locked, draw 3px ghost rects under each bar from
     `baselineStartDate`/`baselineDueDate`. They live in the overlay because
     a baseline range can extend outside the live bar's box. Time→x scale
     derives from any one measured bar with known dates (px-per-day = width /
     duration; origin backed out from its start) — pure DOM, no dependency on
     ReUI internals. A row with no rendered bar has no baseline to draw
     (baseline snapshots copy the task's own dates, so bar-less tasks are
     baseline-less too).
   - Connectors whose endpoint bar is hidden by a collapsed group are not
     drawn — this falls out of DOM measurement naturally and is the accepted
     behavior.
3. **Export (zero rebuild):** `exportExcel.ts`/`exportPdf.ts` already build
   from `Row[]` + palette hexes, not the DOM. `frontend/src/lib/gantt/
   geometry.ts` and `palette.ts` are **retained as the export data layer**;
   only the on-screen components are replaced. Screen/export color parity is
   preserved because the screen adapter and the exports read the same palette.

## Deletion & docs (at merge)

- Delete `frontend/src/components/gantt/` (all 11 files). Keep
  `frontend/src/lib/gantt/` (constants, exportContext, exportExcel, exportPdf,
  geometry, palette) for the export layer.
- `Tasks.tsx` and `/tasks` are untouched (guardrail).
- CLAUDE.md Facts: Gantt described as ReUI-based vendored source; the
  "shadcn declined 2026-07-22" bullet amended with the 2026-07-24 reversal;
  frontend conventions gain the shadcn/`components.json` facts; DESIGN.md sync
  via docs-keeper (tailwind.config.ts is a trigger file and it is being
  replaced by the `@theme` block).
- `docs/ideas/gantt-bar-reskin.md` gets a dated addendum pointing here.
- CHANGELOG entries per phase (Tailwind v4 migration; shadcn bootstrap + new
  deps; Gantt swap + deletion), append-only as always.

## Testing

- **Phase 0 gate:** typecheck, full Playwright suite, manual light/dark sweep.
- **Adapter conversions:** the inclusive/exclusive date conversion and
  due-only anchor rule are exercised through Playwright assertions on rendered
  bar spans and committed dates. No frontend unit runner is introduced —
  consistent with the repo's standing posture (frontend = typecheck only).
- **E2E:** adapt `gantt-bar-labels` and `gantt-legend` specs to the new DOM
  (`data-slot="gantt-bar"` + injected `data-task-id` anchors). New specs:
  drag-move commits new dates; connector create + delete; baseline toggle
  shows/hides ghosts; milestone renders as diamond; export download smoke.
- **Acceptance:** feature-parity walkthrough against the current Gantt on a
  real seeded project before the old engine is deleted.

## Risks

| Risk | Standing |
|---|---|
| Tailwind v4 app-wide visual regressions | Largest risk; contained by the Phase 0 exit gate |
| ReUI has no virtualization | Fine at Solvro's ~50-task scale; revisit if projects reach several hundred rows |
| Vendored source drift | Upstream ReUI updates are manual re-pulls + re-applying Solvro overrides; acceptable, source is ours after install |
| Overlay DOM-measurement fragility | Anchored to our own injected `data-task-id`, not ReUI internals; e2e connector specs guard it |
| Sub-200ms API NFR | Unaffected — no backend changes anywhere in this project |

## Out of scope

- Network Diagram tab (still never built; `sourceHandle`/`targetHandle` stay
  unused), critical-path highlighting (still deferred), any backend or schema
  change, mobile Gantt (unchanged `hidden md:block` + `ProjectList` fallback),
  recurrence/i18n features of ReUI's Gantt (unused).
