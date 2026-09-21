# ReUI Gantt Swap Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled Gantt at `/projects/:id/gantt` with ReUI's vendored Gantt at full feature parity (dependency arrows, baselines, milestones, Excel/PDF export, re-skin semantics), then delete the old engine.

**Architecture:** ReUI's `<Gantt>`/`<GanttView>` becomes the rendering/interaction engine, fed by a pure adapter (`Task`/`Section` → `GanttResource`/`GanttEvent`, owning the inclusive→exclusive date conversion). Solvro parity features live in two extension points: the `renderEvent` slot (solid fills, labels, milestone diamonds, AI-glow, connect dots) and one DOM-measured SVG overlay (connectors + baselines). `lib/gantt/geometry.ts` + `palette.ts` survive as the export data layer — `exportExcel`/`exportPdf` ship unchanged.

**Tech Stack:** `@reui/gantt` (vendored via shadcn CLI), `@base-ui/react`, `date-fns` + `@date-fns/tz`, existing TanStack Query hooks.

**Spec:** `docs/superpowers/specs/2026-07-24-reui-gantt-swap-design.md`. **Hard prerequisite:** Plan A (`2026-07-24-tailwind-v4-shadcn-bootstrap.md`) exit gate passed, on the same branch or its successor.

## Global Constraints

- **Never commit directly** — stage + draft message; user approves every commit (repo guardrail). No Claude co-author trailers. PRs target `develop`.
- **CHANGELOG.md entry with every change set** (append-only, `[Unreleased]`).
- npm installs: container **and** host; `docker compose restart frontend` after dep changes.
- Typecheck: `docker compose exec frontend npm run typecheck`. E2E: `cd e2e && npm test`. No frontend unit runner is introduced (spec decision) — pure-logic confidence comes from typecheck + Playwright assertions.
- The old Gantt keeps working until Task 9 deletes it — never edit `frontend/src/components/gantt/*` in Tasks 1–8 except the one export added in Task 2.
- Guardrails: never `npm install gantt-task-react`; `Tasks.tsx`/`/tasks` untouched; Timeline tab untouched; Gantt stays desktop-only (`hidden md:block`, `ProjectList` mobile fallback).
- DESIGN.md binding: solid bar fills (no washed-out tracks), elevation via outlines, theme via the Plan A bridge — never hardcode hexes outside `palette.ts`.
- Solvro dates: `Task.startDate`/`dueDate` are ISO strings, **inclusive**. ReUI `GanttEvent.end` is **exclusive**. Only `adapter.ts` converts.

---

### Task 1: Vendor the ReUI Gantt source

**Files:**
- Create: `frontend/src/components/reui/gantt/{gantt,gantt-bar,gantt-dnd,gantt-i18n,gantt-lib,gantt-nav,gantt-recurrence,gantt-types,gantt-view}.tsx` (CLI-generated)
- Modify: whichever vendored files import `@/app/(create)/components/icon-placeholder`

**Interfaces:**
- Produces: `Gantt`, `GanttApi`, `GanttColumn` from `@/components/reui/gantt/gantt`; `GanttView` from `…/gantt-view`; `GanttNav`, `GanttToolbar` from `…/gantt-nav`; types `GanttEvent<TData>`, `GanttResource`, `GanttScale`, `GanttProposedUpdate<TData>`, `GanttUpdateResult`, `GanttResourceReorder`, `GanttOffDaysConfig` from `…/gantt-types`.

- [ ] **Step 1: Install via CLI (host), sync container**

```bash
cd frontend && npx shadcn@latest add @reui/gantt && cd ..
docker compose exec frontend npm i && docker compose restart frontend
```

Expected new npm deps: `@base-ui/react`, `date-fns`, `@date-fns/tz` (note the exact versions for the CHANGELOG).

- [ ] **Step 2: Replace `IconPlaceholder` imports**

`grep -rn "icon-placeholder" frontend/src/components/reui/` — replace each usage with an inline SVG matching the icon's intent (chevrons, plus, calendar), copying the pattern used by existing Solvro components (inline SVGs, `currentColor`).

- [ ] **Step 3: Base-UI primitive swap** (decision 2026-07-24, user-approved)

The `@reui/gantt` registry item composes primitives via Base UI's render-prop APIs (`useRender`, `render` props, Base-UI Tooltip timing props), while the shadcn-served `ui/*` set from Plan A Task 4 is Radix-based — 23 TS errors at that seam, and no published Base-UI set exists to vendor (ReUI's public repo is still Radix; their Base-UI code is internal). Decision: **Solvro's `ui/*` primitives go Base-UI** — sustainable because future ReUI pulls are authored against Base UI, and nothing in Solvro app code consumes `ui/*` yet.

- Rewrite as Base-UI-backed shadcn-style wrappers (same exported names, semantic-token classes carried over from the Radix versions): `button` (must support the `render` prop via `useRender`; keep `buttonVariants` export for calendar), `tooltip` (Base UI timing props: `delay`/`closeDelay`), `popover`, `dropdown-menu`, `context-menu`, `checkbox`, `scroll-area`.
- `calendar.tsx` stays react-day-picker-based (not Radix); it keeps working through the rewritten `button`.
- Remove `radix-ui` from `package.json` (container + host) — single behavior stack: `@base-ui/react`.
- The vendored gantt files stay pristine EXCEPT three documented local fixes: 2 unused imports (repo has `noUnusedLocals`), 1 genuine upstream bug (`gantt.tsx:1645` readonly-ref assignment) — each marked with a `// SOLVRO PATCH:` comment for future re-pulls.

- [ ] **Step 4: Typecheck**

```bash
docker compose exec frontend npm run typecheck
```

Expected: PASS (the 23 seam errors resolve) with gantt files unmodified except the three `SOLVRO PATCH` sites.

- [ ] **Step 4: Stage + draft commit** — paths: `frontend/src/components/reui frontend/package.json frontend/package-lock.json CHANGELOG.md`. CHANGELOG: `### Added — <date> — ReUI Gantt vendored (Plan B Task 1)` listing the 9 files + new deps. Message: `feat(gantt): vendor ReUI gantt source via shadcn registry (Plan B Task 1)`

---

### Task 2: Pure adapter module

**Files:**
- Create: `frontend/src/components/gantt-v2/adapter.ts`
- Modify: `frontend/src/lib/gantt/geometry.ts` (export the existing private `progressForTask`, one-line change: `function progressForTask` → `export function progressForTask`)

**Interfaces:**
- Consumes: `Task`, `Section` from `@/lib/queries`; `barFillHex`, `resolveSectionColors`, `ColorByMode` from `@/lib/gantt/palette`; `progressForTask` from `@/lib/gantt/geometry`; ReUI types from Task 1.
- Produces (exact signatures later tasks rely on):
  - `taskNodeId(taskId: number): string` / `sectionNodeId(sectionId: number | null): string` / `parseTaskId(nodeOrEventId: string): number | null`
  - `buildResources(tasks: Task[], sections: Section[]): GanttResource[]`
  - `buildEvents(tasks: Task[], sections: Section[], mode: ColorByMode, canEdit: boolean): GanttEvent<Task>[]`
  - `buildRollupEvents(tasks: Task[], sections: Section[]): GanttEvent<Task>[]` (section rollup pills — read-only synthetic events on group rows)
  - `eventPatch(update: GanttProposedUpdate<Task>): { id: number; patch: { startDate: string; dueDate: string } } | null`
- Date convention note: the old engine is strict UTC-midnight ISO (`geometry.ts:55`); the adapter's `parseISO(iso.slice(0,10))` → local midnight + `format(…, "yyyy-MM-dd")` roundtrip is date-stable regardless — the Task 8 drag-commit spec is the regression net for this.

- [ ] **Step 1: Write `frontend/src/components/gantt-v2/adapter.ts`**

```ts
import { addDays, format, parseISO } from "date-fns";
import type {
  GanttEvent,
  GanttProposedUpdate,
  GanttResource,
} from "@/components/reui/gantt/gantt-types";
import { progressForTask } from "@/lib/gantt/geometry";
import { barFillHex, resolveSectionColors, type ColorByMode } from "@/lib/gantt/palette";
import type { Section, Task } from "@/lib/queries";

// ID scheme shared by the container, overlay, and e2e specs.
export const taskNodeId = (taskId: number) => `task-${taskId}`;
export const sectionNodeId = (sectionId: number | null) =>
  sectionId === null ? "section-none" : `section-${sectionId}`;
export function parseTaskId(id: string): number | null {
  const m = /^task-(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

const byPosition = <T extends { position: number; id: number }>(a: T, b: T) =>
  a.position - b.position || a.id - b.id;

/** Section groups → top-level task nodes → subtask children. */
export function buildResources(tasks: Task[], sections: Section[]): GanttResource[] {
  const colors = resolveSectionColors(sections);
  const childrenOf = (parentId: number): GanttResource[] =>
    tasks
      .filter((t) => t.parentTaskId === parentId)
      .sort(byPosition)
      .map((t) => ({
        id: taskNodeId(t.id),
        title: t.title,
        scheduleMode: "single" as const,
        children: childrenOf(t.id),
      }));
  const topLevel = tasks.filter((t) => t.parentTaskId === null).sort(byPosition);
  const bySection = (sectionId: number | null) =>
    topLevel
      .filter((t) => t.sectionId === sectionId)
      .map((t) => ({
        id: taskNodeId(t.id),
        title: t.title,
        scheduleMode: "single" as const,
        children: childrenOf(t.id),
      }));
  const groups: GanttResource[] = [...sections].sort(byPosition).map((s) => ({
    id: sectionNodeId(s.id),
    title: s.name,
    color: colors.get(s.id),
    children: bySection(s.id),
  }));
  const orphans = bySection(null);
  return orphans.length
    ? [...groups, { id: sectionNodeId(null), title: "No section", children: orphans }]
    : groups;
}

/**
 * Solvro dueDate is INCLUSIVE; ReUI event.end is EXCLUSIVE — convert here and
 * only here. Due-only tasks anchor a 1-day bar on the due date; start-only
 * tasks a 1-day bar on the start (geometry.ts due-only rule carried over).
 * Tasks with neither date have no bar.
 */
export function taskToEvent(
  task: Task,
  mode: ColorByMode,
  sectionColors: Map<number, string>,
  canEdit: boolean,
): GanttEvent<Task> | null {
  const startIso = task.startDate ?? task.dueDate;
  const endIso = task.dueDate ?? task.startDate;
  if (!startIso || !endIso) return null;
  return {
    id: taskNodeId(task.id),
    title: task.title,
    start: parseISO(startIso.slice(0, 10)),
    end: addDays(parseISO(endIso.slice(0, 10)), 1),
    allDay: true,
    progress: progressForTaskSafe(task),
    color: barFillHex(
      {
        status: task.status,
        priority: task.priority,
        sectionColor: task.sectionId != null ? sectionColors.get(task.sectionId) : null,
      },
      mode,
    ),
    readOnly: !canEdit,
    resizable: canEdit && !task.isMilestone,
    resourceId: taskNodeId(task.id),
    data: task,
  };
}

// progressForTask needs the project-wide parent→children map; build it once
// per buildEvents call and close over it.
let cachedChildren: Map<number, Task[]> | null = null;
function progressForTaskSafe(task: Task): number {
  return cachedChildren ? progressForTask(task, cachedChildren) : 0;
}

export function buildEvents(
  tasks: Task[],
  sections: Section[],
  mode: ColorByMode,
  canEdit: boolean,
): GanttEvent<Task>[] {
  const colors = resolveSectionColors(sections);
  cachedChildren = new Map<number, Task[]>();
  for (const t of tasks) {
    if (t.parentTaskId !== null) {
      const arr = cachedChildren.get(t.parentTaskId) ?? [];
      arr.push(t);
      cachedChildren.set(t.parentTaskId, arr);
    }
  }
  const events = tasks
    .map((t) => taskToEvent(t, mode, colors, canEdit))
    .filter((e): e is GanttEvent<Task> => e !== null);
  cachedChildren = null;
  return events;
}

/**
 * Section rollup pills: one synthetic read-only event per section spanning its
 * children's date range, rendered as a slim pill on the group row (parity with
 * GanttSectionBar.tsx:62-89 — the pill is the collapsed-section affordance).
 */
export function buildRollupEvents(
  tasks: Task[],
  sections: Section[],
): GanttEvent<Task>[] {
  const colors = resolveSectionColors(sections);
  return sections.flatMap((s) => {
    const dated = tasks.filter(
      (t) => t.sectionId === s.id && (t.startDate ?? t.dueDate),
    );
    if (!dated.length) return [];
    const starts = dated.map((t) => parseISO((t.startDate ?? t.dueDate)!.slice(0, 10)));
    const ends = dated.map((t) => parseISO((t.dueDate ?? t.startDate)!.slice(0, 10)));
    return [{
      id: `section-rollup-${s.id}`,
      title: s.name,
      start: new Date(Math.min(...starts.map(Number))),
      end: addDays(new Date(Math.max(...ends.map(Number))), 1),
      allDay: true,
      color: colors.get(s.id),
      readOnly: true,
      resourceId: sectionNodeId(s.id),
    }];
  });
}

/** Exclusive ReUI end → inclusive Solvro dueDate. Null when not a task event. */
export function eventPatch(
  update: GanttProposedUpdate<Task>,
): { id: number; patch: { startDate: string; dueDate: string } } | null {
  const task = update.event.data;
  if (!task) return null;
  return {
    id: task.id,
    patch: {
      startDate: format(update.start, "yyyy-MM-dd"),
      dueDate: format(addDays(update.end, -1), "yyyy-MM-dd"),
    },
  };
}
```

Adjust `progressForTask`'s exact call signature to what `geometry.ts:317` actually declares (`(task: Task, childrenById: Map<number, Task[]>) => number`) — if it differs, adapt the two call sites above, not geometry.

- [ ] **Step 2: Export `progressForTask` from geometry.ts** (`export function progressForTask(...)` — no other change).

- [ ] **Step 3: Typecheck** — `docker compose exec frontend npm run typecheck`. Expected: PASS.

- [ ] **Step 4: Stage + draft commit** — paths: `frontend/src/components/gantt-v2/adapter.ts frontend/src/lib/gantt/geometry.ts CHANGELOG.md`. CHANGELOG: `### Added — <date> — Gantt v2 data adapter (Plan B Task 2)` noting the inclusive/exclusive conversion ownership. Message: `feat(gantt): pure Task/Section → ReUI adapter (Plan B Task 2)`

---

### Task 3: `SolvroGantt` container + route swap on the branch

**Files:**
- Create: `frontend/src/components/gantt-v2/SolvroGantt.tsx`
- Modify: `frontend/src/pages/views/ProjectGantt.tsx` (swap `GanttFrame` → `SolvroGantt`; props stay: `projectId`, `projectName`, `baselineLockedAt`, `baselineLockedBy`, `onEditTask`, `onCreateTaskOpen`)

**Interfaces:**
- Consumes: Task 1 components, Task 2 adapter, hooks from `@/lib/queries`: `useProjectTasks(projectId)`, `useProjectSections(projectId)`, `useProjectDependencies(projectId)`, `useHolidays(years)`, `useAuth`.
- Produces: `<SolvroGantt {...sameProps}/>`; internal state it must own: `colorBy: ColorByMode` (default `"status"`), `scale: "day" | "week" | "month" | "quarter"` (default `"week"`), `showBaseline: boolean`.

- [ ] **Step 1: Write the container skeleton**

```tsx
import { useMemo, useState } from "react";
import { Gantt } from "@/components/reui/gantt/gantt";
import { GanttView } from "@/components/reui/gantt/gantt-view";
import type { GanttScale } from "@/components/reui/gantt/gantt-types";
import { buildEvents, buildResources } from "./adapter";
import { legendEntries, type ColorByMode } from "@/lib/gantt/palette";
import {
  useHolidays,
  useProjectDependencies,
  useProjectSections,
  useProjectTasks,
} from "@/lib/queries";
import { useAuth } from "@/lib/auth";

const SCALES: Array<{ mode: GanttScale; label: string }> = [
  { mode: "day", label: "Day" },
  { mode: "week", label: "Week" },
  { mode: "month", label: "Month" },
  { mode: "quarter", label: "Quarter" },
];

export function SolvroGantt(props: SolvroGanttProps) {
  const { user } = useAuth();
  const canEdit = /* same permission check GanttFrame.tsx uses today — copy it verbatim */;
  const { data: tasks = [] } = useProjectTasks(props.projectId);
  const { data: sections = [] } = useProjectSections(props.projectId);
  const { data: dependencies = [] } = useProjectDependencies(props.projectId);
  const [colorBy, setColorBy] = useState<ColorByMode>("status");
  const [scale, setScale] = useState<GanttScale>("week");
  const [showBaseline, setShowBaseline] = useState(false);

  const resources = useMemo(() => buildResources(tasks, sections), [tasks, sections]);
  const events = useMemo(
    () => buildEvents(tasks, sections, colorBy, canEdit),
    [tasks, sections, colorBy, canEdit],
  );
  const years = useMemo(() => yearsCoveredBy(events), [events]);
  const { data: holidays = [] } = useHolidays(years);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="solvro-gantt">
      {/* Toolbar: zoom pills, color-by toggle + legend, baseline toggle,
          lock-baseline flow, export buttons — port the JSX from
          GanttFrame.tsx's toolbar region, restyled only where v4 renames hit. */}
      <Gantt
        events={events}
        resources={resources}
        scale={scale}
        interactions={{ drag: canEdit, resize: canEdit, selectSlot: false }}
        offDays={{ dates: holidays.map((h) => parseISO(h.date)) }}
        /* onEventUpdate / onResourceReorder wired in Task 5 */
      >
        <GanttView />
      </Gantt>
    </div>
  );
}
```

Fill the elided pieces from the current `GanttFrame.tsx`: the `canEdit` permission expression, `yearsCoveredBy` (port of the `yearsCovered` memo at `GanttFrame.tsx:364`'s input), toolbar JSX (zoom pill group at `GanttFrame.tsx:751`, legend via `legendEntries(colorBy, sections)` **capped at 6 entries with "+N more"** as today at `GanttFrame.tsx:841`, baseline lock flow at `GanttFrame.tsx:97–101`, the "Today" scroll-to-center button at `GanttFrame.tsx:578/711`). **Color-by persists to localStorage — port the exact key and read/write from `GanttFrame.tsx:72,151`.** `SolvroGanttProps` = the exact prop list `ProjectGantt.tsx` passes today.

Additional parity pieces (inventory findings, 2026-07-24):

- **Tree-pane inline editors:** the old list pane offers an inline date-range popover (`InlineDateRangeEditor`, `GanttListRow.tsx:258`) and a section color-picker popover (`GanttListRow.tsx:164–193`). Port both into ReUI's tree pane via consumer `GanttColumn` render props (a dates column on task rows, the color swatch on section group rows) — the editor components themselves move over intact; only their mounting changes. Color picks commit via `useUpdateSection`, dates via `useUpdateTask`.
- **Section rollup pills:** merge `buildRollupEvents(tasks, sections)` (Task 2) into the `events` array so each section group row carries a slim read-only pill spanning its children — the collapsed-section affordance. Task 4 renders the `section-rollup-*` variant.
- **Accepted deviation:** the old engine shades weekends only at Day/Week zoom while holidays shade at all zooms (`GanttColumnGrid.tsx:41–61`); ReUI's `offDays` is zoom-uniform. Accept uniform shading — note it in the CHANGELOG entry.

- [ ] **Step 2: Swap the mount in `ProjectGantt.tsx`** — import `SolvroGantt` instead of `GanttFrame`, identical props, `hidden md:block` wrapper unchanged.

- [ ] **Step 3: Verify in the browser** — `/projects/:id/gantt` renders section groups with task bars, collapsible tree, zoom pills switch scale, weekends + holidays shaded, today highlighted, legend matches Color-by mode. Drag does nothing yet (Task 5).

- [ ] **Step 4: Typecheck + stage + draft commit** — paths: `frontend/src/components/gantt-v2/SolvroGantt.tsx frontend/src/pages/views/ProjectGantt.tsx CHANGELOG.md`. Message: `feat(gantt): SolvroGantt container on ReUI engine, mounted at /projects/:id/gantt (Plan B Task 3)`

---

### Task 4: `renderEvent` — solid fills, labels, milestones, AI-glow

**Files:**
- Create: `frontend/src/components/gantt-v2/SolvroBar.tsx`
- Modify: `frontend/src/components/gantt-v2/SolvroGantt.tsx` (pass `renderEvent` + `classNames.event` through the view config)

**Interfaces:**
- Consumes: the render-props object ReUI passes to `renderEvent` (event + segment + labels; read the exact shape from `gantt-bar.tsx`'s `renderProps`).
- Produces: `SolvroBar` render function; **every bar root child carries `data-task-id={task.id}`** — the overlay (Task 6) and e2e specs (Task 8) depend on this attribute.

- [ ] **Step 1: Solid fills.** ReUI's default bar is a 20%-opacity track (`bg-(--gantt-event-color)/20` in `gantt-bar.tsx`) — exactly the ghost look the 2026-07 re-skin eliminated. Override via the view `classNames.event` with `bg-(--gantt-event-color)` (solid) + readable foreground, and render the 0<p<100 progress portion as a darker overlay (`rgba(0,0,0,0.28)` left-anchored — same PROGRESS_OVERLAY_ALPHA semantics as `palette.ts:32`).

- [ ] **Step 2: `SolvroBar` content** — inside `renderEvent`:

```tsx
export function solvroBarContent(task: Task, title: string) {
  if (task.isMilestone) {
    return (
      <span data-task-id={task.id} data-milestone className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block size-2.5 rotate-45 bg-(--gantt-event-color)" />
        <span className="truncate">{title}</span>
      </span>
    );
  }
  return (
    <span data-task-id={task.id} className="truncate">
      {title}
    </span>
  );
}
```

AI-glow hook: when `task` later carries `blueprintId` (ingestion port), add `data-ai-breakdown` + an amber ring class — leave the conditional in place reading `(task as { blueprintId?: number }).blueprintId != null`.

Rollup pills: events whose id starts with `section-rollup-` render as a slim (~6px) solid pill in the section's color with no label, no progress overlay, no connect dots — `data-rollup` attribute for e2e. Inside-bar text color for regular bars: port the fill-luminance picker from the old `GanttBar.tsx:60–74` so dark fills get light text (part of the GH #58 semantics).

- [ ] **Step 3: Labels vs GH #58.** ReUI auto-flips titles outside narrow bars (`gantt-view.tsx:207`). Verify against the GH #58 acceptance: label inside **iff the full name fits**, outside labels visually tied to their bar. If ReUI's threshold is width-based rather than measured-fit, port the measured-fit check from the old `GanttBar.tsx` into `renderEvent` and force the outside variant via the `data-label-outside` styling hook. Record which path was taken in the CHANGELOG entry.

- [ ] **Step 4: Verify in browser** (solid bars in all three Color-by modes, diamond milestones, progress overlay, labels per GH #58) **+ typecheck + stage.** Message: `feat(gantt): Solvro bar rendering — solid fills, milestones, labels (Plan B Task 4)`

---

### Task 5: Commit pipeline — drag/resize + reorder

**Files:**
- Modify: `frontend/src/components/gantt-v2/SolvroGantt.tsx`

**Interfaces:**
- Consumes: `useUpdateTask(projectId)` (optimistic; `mutate({ id, patch })` with `patch: { startDate?, dueDate?, sectionId?, position? }`), `eventPatch` + `parseTaskId` + `sectionNodeId` from the adapter.
- Produces: `onEventUpdate` and `onResourceReorder` wired; ReUI reverts gestures we reject.

- [ ] **Step 1: Wire `onEventUpdate`**

```tsx
const updateTask = useUpdateTask(props.projectId);

const handleEventUpdate = (update: GanttProposedUpdate<Task>): GanttUpdateResult => {
  const p = eventPatch(update);
  if (!p || !canEdit) return false;
  updateTask.mutate(p);          // optimistic; onError rolls back (queries.ts)
  return true;
};
```

- [ ] **Step 2: Wire `onResourceReorder`** — mirror the old drop logic (`GanttFrame.tsx:444–464`): compute the target top-level `position` from the proposal's `parentId`/`index` against the current sibling order; map `parentId` → `sectionId` via `sectionNodeId` parsing (drop into a section group) or `parentTaskId` via `parseTaskId` (drop under a task). Return `false` for drops that don't map to a legal Solvro move (e.g. a section group dragged under a task).

- [ ] **Step 3: Verify in browser** — drag a bar: dates change, survives reload; resize: due date changes; a failed PATCH (kill backend briefly) rolls the bar back; reorder a row: order matches in List and Kanban views (one canonical order).

- [ ] **Step 4: Typecheck + stage.** Message: `feat(gantt): drag/resize/reorder commit pipeline via optimistic mutations (Plan B Task 5)`

---

### Task 6: Chart-space overlay — connectors + baselines + connect dots

**Files:**
- Create: `frontend/src/components/gantt-v2/connector-paths.ts` (pure; ported verbatim from `frontend/src/components/gantt/GanttConnectors.tsx`: `polylineToPath`, the polyline trim helper, the stepped-route builder with `FORWARD_NUDGE`/`BACK_NUDGE`/`ARROW_INSET`/`HIT_TRIM` constants — signatures preserved, geometry-type params replaced by plain rects)
- Create: `frontend/src/components/gantt-v2/GanttOverlay.tsx`
- Modify: `frontend/src/components/gantt-v2/SolvroGantt.tsx` (mount overlay; pass dependencies + `showBaseline`), `SolvroBar.tsx` (connect dots)

**Interfaces:**
- Consumes: `TaskDependency[]` (`predecessorTaskId`, `successorTaskId`, `type: "HARD" | "SOFT"`), `useCreateDependency(projectId)` / `useDeleteDependency(projectId)`, bars located by `[data-task-id]` (Task 4).
- Produces: `<GanttOverlay containerRef dependencies events showBaseline canEdit onCreate onDelete />` — an absolutely-positioned `<svg>` over the timeline pane; connectors carry `data-connector-id={dep.id}` and `data-connector-type` (e2e hooks).

- [ ] **Step 1: Measurement core**

```tsx
/** Rects of every bar keyed by taskId, in the scroll-content coordinate space. */
function measureBars(pane: HTMLElement): Map<number, DOMRect> {
  const paneRect = pane.getBoundingClientRect();
  const out = new Map<number, DOMRect>();
  pane.querySelectorAll<HTMLElement>("[data-task-id]").forEach((el) => {
    const bar = el.closest<HTMLElement>('[data-slot="gantt-bar"]');
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    out.set(
      Number(el.dataset.taskId),
      new DOMRect(
        r.left - paneRect.left + pane.scrollLeft,
        r.top - paneRect.top + pane.scrollTop,
        r.width,
        r.height,
      ),
    );
  });
  return out;
}
```

Re-measure on: pane scroll, `ResizeObserver` on the pane, scale/collapse changes (re-render), and drag end — batched through one `requestAnimationFrame`.

- [ ] **Step 2: Connectors.** For each dependency with both endpoint rects present (collapsed-away bars simply don't draw — accepted behavior per spec), route predecessor-right-edge → successor-left-edge through the ported stepped-path builder; render solid for HARD, `stroke-dasharray` for SOFT, arrowhead marker, transparent fat hit path with hover `×` calling `onDelete(dep.id)` (only when `canEdit`).

- [ ] **Step 3: Connect dots + drag-create.** In `SolvroBar`, when `canEdit`, render left/right edge dots (`data-connect-dot`); pointer-down starts a rubber-band line drawn by the overlay; releasing over another bar's dot calls `useCreateDependency.mutate({ predecessorTaskId, successorTaskId, type: "HARD" })` with the same direction rules as the old `handleConnectStart` (`GanttFrame.tsx:268`). Stop pointer-down propagation so ReUI doesn't treat it as a bar move.

- [ ] **Step 4: Baselines.** When `showBaseline` and the project baseline is locked: derive the time scale from any one measured bar and its event (`pxPerDay = rect.width / diffDays(event.end, event.start)`; `x(date) = rect.x + diffDays(date, event.start) * pxPerDay`), then for every task with both `baselineStartDate`/`baselineDueDate` draw a 3px muted rect at `rect.bottom + 2`, spanning the baseline range **+1 day exclusive-end padding to match live bars**. No bars rendered → nothing to draw.

- [ ] **Step 5: Verify in browser** — arrows match the old Gantt for the same project (open both branches side by side), HARD/SOFT styles, create + delete round-trip persists, baselines toggle on/off and shift when a bar is dragged.

- [ ] **Step 6: Typecheck + stage.** Message: `feat(gantt): DOM-measured overlay — dependency connectors, drag-create, baselines (Plan B Task 6)`

---

### Task 7: Export re-registration

**Files:**
- Modify: `frontend/src/components/gantt-v2/SolvroGantt.tsx`

**Interfaces:**
- Consumes: `useGanttExport()` (`register`/`handlers`, from `@/lib/gantt/exportContext`), `exportGanttToExcel` / `exportGanttToPdf` (dynamic `import()` — keep them out of the main bundle), and `buildRows` from `@/lib/gantt/geometry` for the export `Row[]`.
- Produces: Excel/PDF buttons in the new toolbar producing byte-equivalent output to the old Gantt (same rows, same palette hexes).

- [ ] **Step 1:** Port the registration effect from `GanttFrame.tsx:597–674` unchanged: build `Row[]` via geometry's row builder from the same `tasks`/`sections`/`colorBy` inputs, register `{ excel, pdf }` handlers, unregister on unmount.
- [ ] **Step 2: Verify** — export both formats from the new Gantt and from the old branch for the same project; diff visually (columns, colors, baseline columns when locked). Dynamic-import check: `docker compose exec frontend npm run build` and confirm `exceljs`/`jspdf` still land in separate chunks.
- [ ] **Step 3: Stage.** Message: `feat(gantt): Excel/PDF export re-registered on geometry data layer (Plan B Task 7)`

---

### Task 8: E2E adaptation + new parity specs

**Files:**
- Modify: `e2e/tests/gantt-bar-labels.spec.ts`, `e2e/tests/gantt-legend.spec.ts` (selector updates to `[data-slot="gantt-bar"]` / `[data-task-id]`)
- Create: `e2e/tests/gantt-parity.spec.ts`

**Interfaces:**
- Consumes: `data-task-id`, `data-milestone`, `data-connector-id`, `data-connector-type`, `data-testid="solvro-gantt"` from Tasks 3–6.

- [ ] **Step 1: Update the two existing specs** to the new DOM; behavioral assertions (measured-fit labels, legend entries per mode) stay identical.

- [ ] **Step 2: Write `gantt-parity.spec.ts`** (desktop project only — Gantt is `hidden md:block`):

```ts
test("drag-move commits new dates and survives reload", async ({ page }) => {
  await gotoSeededGantt(page);
  const bar = page.locator('[data-task-id="1"]').locator('xpath=ancestor::*[@data-slot="gantt-bar"]');
  const before = await bar.boundingBox();
  await bar.hover();
  await page.mouse.down();
  await page.mouse.move(before!.x + before!.width / 2 + 80, before!.y + before!.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.reload();
  const after = await page.locator('[data-task-id="1"]').locator('xpath=ancestor::*[@data-slot="gantt-bar"]').boundingBox();
  expect(after!.x).toBeGreaterThan(before!.x + 40);
});

test("connector create + delete round-trip", async ({ page }) => {
  await gotoSeededGantt(page);
  await dragBetweenDots(page, 1, 2); // helper: right dot of task 1 → left dot of task 2
  const connector = page.locator("[data-connector-id]").first();
  await expect(connector).toHaveAttribute("data-connector-type", "HARD");
  await connector.hover();
  await page.getByRole("button", { name: /delete dependency/i }).click();
  await expect(page.locator("[data-connector-id]")).toHaveCount(0);
});

test("baseline toggle shows ghosts; milestone renders as diamond", async ({ page }) => {
  await gotoSeededGantt(page);
  await page.getByRole("button", { name: /baseline/i }).click();
  await expect(page.locator("[data-baseline-rect]").first()).toBeVisible();
  await expect(page.locator("[data-milestone]").first()).toBeVisible();
});
```

Reuse the existing suite's seeded-project fixture/login helpers (see how `gantt-legend.spec.ts` boots); add `dragBetweenDots` + `gotoSeededGantt` helpers to the spec file itself, and give the overlay's baseline rects `data-baseline-rect` in Task 6 if not already present.

- [ ] **Step 3: Run** — `cd e2e && npm test`. Expected: all green except the known `pwa.spec.ts`-on-dev-server caveat.

- [ ] **Step 4: Stage.** Message: `test(e2e): gantt specs on ReUI engine + parity coverage (Plan B Task 8)`

---

### Task 9: Delete the old engine + docs closeout

**Files:**
- Delete: `frontend/src/components/gantt/` (all 11 files)
- Keep: `frontend/src/lib/gantt/` in full (export data layer)
- Modify: `CLAUDE.md` (Facts), `CHANGELOG.md`; dispatch `solvro-docs-keeper` for DESIGN.md/ISSUES.md reconciliation

- [ ] **Step 1: Final parity walkthrough** — spec's acceptance: side-by-side on a real seeded project, checking every feature in the spec's parity list. Only proceed when clean.
- [ ] **Step 2: Delete + fix imports**

```bash
git rm -r frontend/src/components/gantt
docker compose exec frontend npm run typecheck   # expect PASS: nothing else imports the old engine
grep -rn "components/gantt/" frontend/src | grep -v "components/gantt-v2\|components/reui" # expect empty
```

- [ ] **Step 3: Full gates** — frontend typecheck + build, backend `npx tsc --noEmit`, backend `npm test`, full e2e.
- [ ] **Step 4: Docs** — CLAUDE.md Facts: Gantt section now "ReUI-based vendored engine in `components/reui/gantt` + `components/gantt-v2`; export layer in `lib/gantt`"; remove the stale "hand-rolled" phrasing (Guardrails block untouched — user-owned). CHANGELOG `### Removed` entry for the 11 files + `### Changed` closeout. Dispatch `solvro-docs-keeper` per the agent roster flow.
- [ ] **Step 5: Stage + draft final commit.** Message: `feat(gantt)!: ReUI Gantt replaces hand-rolled engine at full parity (Plan B Task 9)`

---

## Self-Review

1. **Spec coverage:** vendoring (T1) = spec Phase 1.1; adapter incl. date conversion + due-only rule (T2) = Phase 1.3; container/zoom/offDays/toolbar (T3) = Phase 1.2/1.4; solid fills/labels/milestones/AI-glow (T4) = Phase 1.5 + Phase 2.1; commit pipeline (T5) = Phase 1.3 drag/reorder; overlay connectors + baselines (T6) = Phase 2.2; export (T7) = Phase 2.3; e2e (T8) = Testing section; deletion + docs (T9) = "Deletion & docs (at merge)". ✔
2. **Placeholder scan:** two intentional execution-time reads remain: the `canEdit` expression and toolbar JSX are ported *verbatim from named line-anchored regions of GanttFrame.tsx* (the code exists in-repo at the cited lines — porting instructions, not placeholders); `progressForTask`'s exact signature is verified at its cited line. ✔
3. **Type consistency:** `taskNodeId`/`parseTaskId`/`sectionNodeId` names match across T2/T5/T6/T8; `eventPatch` return shape matches `useUpdateTask.mutate({ id, patch })`; `data-task-id`/`data-milestone`/`data-connector-*`/`data-baseline-rect` attributes introduced in T4/T6 are the same ones T8 asserts. ✔
