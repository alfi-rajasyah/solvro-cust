# Gantt UX + Production Export Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four TAM-reported bugs: truncated Gantt dates column, grey-only Gantt bars (add "Color by" selector + section color picker), forced milestone inference on same-day tasks (add explicit `isMilestone` flag + dependency handles on milestones), and clipboard copy failing on the plain-HTTP prod origin — plus a "View PDF in tab" action (Task 8) as the in-app mitigation for the production download hang. The hang's root fix is environmental — diagnostics and browser/DNS options are in the Appendix, not code tasks.

**Architecture:** Backend gains one boolean column on `Task` with a backfill migration and route plumbing. Frontend changes concentrate in the hand-rolled Gantt (`frontend/src/components/gantt/`, `frontend/src/lib/gantt/`): `palette.ts` becomes the single color resolver feeding live bars and both exports; `geometry.ts` reads the explicit milestone flag; `GanttBar.tsx` gains connector dots in its milestone branch. A tiny `lib/clipboard.ts` helper wraps clipboard writes with an insecure-origin fallback.

**Tech Stack:** Existing only — React + TailwindCSS + TanStack Query, Express + Prisma + PostgreSQL, exceljs/jspdf behind dynamic `import()`. **No new npm dependencies.**

## Global Constraints

- **CHANGELOG discipline (CLAUDE.md):** every task's commit step includes appending to `CHANGELOG.md` under `[Unreleased]` — same commit, never skipped, append-only.
- **No unit test runner is wired in either tier** (CLAUDE.md). Verification per task = in-container type-check + explicit manual checks in the dev stack (`docker compose up -d`, app at `http://localhost:5173`, seeded login `admin@solvro.local` / `password123`). Playwright e2e exists (`e2e/`) but adding Gantt e2e coverage is explicitly out of scope for this plan.
- Type-check commands: `docker compose exec frontend npm run typecheck` and `docker compose exec backend npx tsc --noEmit`.
- Backend conventions: Zod via `validate("body", schema)`; import prisma from `../prisma.js`; routes mounted WITHOUT `/api` prefix; `@map("snake_case")` DB names with camelCase TS surface.
- Frontend conventions: all server state hooks in `frontend/src/lib/queries.ts`; `@/` path alias; theme tokens over inline hex in components (`lib/gantt/palette.ts` is the established hex home for Gantt/export colors); heavy export libs stay behind dynamic `import()`.
- Commit style per repo history: `fix(scope): …` / `feat(scope): …`. **No Claude co-author trailers.**
- Prisma migration gotcha (CLAUDE.md): `prisma migrate dev` is interactive — always `-it` and `--name <slug>`; this plan uses `--create-only` so the backfill SQL can be appended before applying.
- Milestone convention (decided in refinement): a flagged milestone anchors to its **due date**; writes keep `startDate` synced to `dueDate`. Same-day dates alone no longer imply milestone after this plan.

**Task order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Task 1 and Task 7 are independent of everything; 3 and 4 depend on 2; 6 depends on 5 (shares `SECTION_COLOR_PRESETS` in `palette.ts`); 8 depends on 5 (both extend `ExportPdfOpts`).

---

### Task 1: Widen the Gantt dates column

The dates sub-column is fixed at 92 px but `fmtDateRangeDDMM` emits up to 15 chars ("12 Jul – 16 Jul"), needing ~99 px at 11 px mono plus 16 px `px-2` padding. The name column is `flex-1`, so neither window resizing nor the pane divider ever widens the dates cell.

**Files:**
- Modify: `frontend/src/lib/gantt/constants.ts` (line 6)

**Interfaces:**
- Consumes: nothing.
- Produces: `DATE_RANGE_COL_WIDTH = 118`; `DEFAULT_LIST_PANE_WIDTH` self-derives to 384 (22 + 220 + 118 + 3×8).

- [ ] **Step 1: Change the constant**

In `frontend/src/lib/gantt/constants.ts` replace:

```ts
export const DATE_RANGE_COL_WIDTH = 92;
```

with:

```ts
// Fits the widest fmtDateRangeDDMM output ("12 Jul – 16 Jul", 15 chars at
// 11px mono ≈ 99px) plus the cell's px-2 padding. 92 truncated every range.
export const DATE_RANGE_COL_WIDTH = 118;
```

- [ ] **Step 2: Type-check**

Run: `docker compose exec frontend npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Manual verify**

Open a project → Gantt tab. Expected: every task row shows the full range ("12 Jul – 16 Jul") with no `…`; single-date rows ("20 Jul") right-aligned; dragging the pane divider narrower truncates the *name* column first, dates stay whole; header "Dates" label still aligns over the column (`GanttListPane.tsx` uses the same constant).

- [ ] **Step 4: CHANGELOG + commit**

Append to `CHANGELOG.md` under `[Unreleased]` → `### Fixed`:

```markdown
- Gantt task-list dates column truncated every range ("12 Jul – 1…"); widened
  `DATE_RANGE_COL_WIDTH` 92 → 118 in `frontend/src/lib/gantt/constants.ts` to
  fit the bounded "DD Mon – DD Mon" format (window/divider resizing feeds the
  flex name column, so the fixed sub-column could never grow).
```

```bash
git add frontend/src/lib/gantt/constants.ts CHANGELOG.md
git commit -m "fix(gantt): widen dates column so ranges render untruncated"
```

---

### Task 2: Backend — explicit `isMilestone` on Task

**Files:**
- Modify: `backend/prisma/schema.prisma` (Task model, after `dueDate`)
- Create: `backend/prisma/migrations/<generated>_task_is_milestone/migration.sql` (generated, then backfill appended)
- Modify: `backend/src/routes/projects.ts` (`createTaskSchema` line 80, create handler line 331)
- Modify: `backend/src/routes/tasks.ts` (`updateTaskSchema` line 20, PATCH data-build ~line 170)

**Interfaces:**
- Consumes: nothing.
- Produces: `Task.isMilestone: boolean` (DB `tasks.is_milestone`, default false, backfilled); `POST /projects/:id/tasks` and `PATCH /tasks/:id` accept optional `isMilestone: boolean`; both writes enforce `startDate = dueDate` whenever the task ends up a milestone with a due date. Task 3 relies on `isMilestone` appearing in task JSON payloads (it will — task routes return full model rows, no explicit `select` on task reads).

- [ ] **Step 1: Add the schema field**

In `backend/prisma/schema.prisma`, Task model, directly under `dueDate`:

```prisma
  // Explicit milestone flag. Historically derived in the frontend
  // (startDate === dueDate, or dueDate-only); backfilled once by the
  // task_is_milestone migration, user-controlled thereafter.
  isMilestone       Boolean    @default(false) @map("is_milestone")
```

- [ ] **Step 2: Generate the migration without applying**

```bash
docker compose exec -it backend npx prisma migrate dev --name task_is_milestone --create-only
```

Expected: new folder `backend/prisma/migrations/<timestamp>_task_is_milestone/` containing only the `ALTER TABLE`.

- [ ] **Step 3: Append the backfill to the generated migration.sql**

```sql
-- Backfill: preserve current visuals. Tasks the frontend previously derived
-- as milestones (same-day range, or due-date-only) become explicit ones.
UPDATE "tasks" SET "is_milestone" = true
WHERE ("start_date" IS NOT NULL AND "due_date" IS NOT NULL
       AND "start_date"::date = "due_date"::date)
   OR ("start_date" IS NULL AND "due_date" IS NOT NULL);
```

(Subtasks match too; harmless — Gantt rows exclude subtasks and no other view reads the flag.)

- [ ] **Step 4: Apply + regenerate client + restart**

```bash
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npx prisma generate
docker compose restart backend
```

Expected: migrate deploy reports the migration applied.

- [ ] **Step 5: Accept the field in both write schemas**

`backend/src/routes/projects.ts`, `createTaskSchema`, after the `dueDate` line:

```ts
  isMilestone: z.boolean().optional(),
```

`backend/src/routes/tasks.ts`, `updateTaskSchema`, after the `dueDate` line: same addition.

- [ ] **Step 6: Write the field + due-date sync in the create handler**

`backend/src/routes/projects.ts` create handler — in `tx.task.create({ data: { … } })` replace the `startDate` line and add `isMilestone`:

```ts
          // Milestones anchor to their due date; keep startDate in lockstep
          // so geometry and exports see a single-day marker.
          startDate:
            body.isMilestone && body.dueDate
              ? body.dueDate
              : body.startDate ?? null,
          dueDate: body.dueDate ?? null,
          isMilestone: body.isMilestone ?? false,
```

- [ ] **Step 7: Write the field + due-date sync in the PATCH handler**

`backend/src/routes/tasks.ts`, in the `const data: Prisma.TaskUpdateInput = {};` block, after the `dueDate` line:

```ts
      if (body.isMilestone !== undefined) data.isMilestone = body.isMilestone;
      // Milestone due-date lockstep: whatever this patch results in, a
      // milestone with a due date must have startDate === dueDate.
      const willBeMilestone = body.isMilestone ?? current.isMilestone;
      const effectiveDue =
        body.dueDate !== undefined ? body.dueDate : current.dueDate;
      if (willBeMilestone && effectiveDue) data.startDate = effectiveDue;
```

(`current` is the pre-fetched task already used by this handler for sibling-key logic.)

- [ ] **Step 8: Type-check + API verify**

Run: `docker compose exec backend npx tsc --noEmit` → exit 0.

Then (token from a dev login):

```bash
TOKEN=$(curl -s localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@solvro.local","password":"password123"}' | jq -r .token)
curl -s localhost:3000/tasks/1 -H "authorization: Bearer $TOKEN" | jq .isMilestone
curl -s -X PATCH localhost:3000/tasks/1 -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"isMilestone":true}' \
  | jq '{isMilestone, startDate, dueDate}'
```

Expected: first call returns `true`/`false` (not null); after the PATCH, `isMilestone` is `true` and `startDate` equals `dueDate` (when task 1 has a due date). Backfill spot-check: `docker compose exec backend npx prisma studio` → tasks with same-day ranges show `is_milestone = true`. Revert the PATCH if task 1 wasn't a milestone: `-d '{"isMilestone":false}'`.

- [ ] **Step 9: CHANGELOG + commit**

`CHANGELOG.md` → `### Added`:

```markdown
- `Task.isMilestone` boolean (`tasks.is_milestone`, default false) with
  one-time backfill marking previously derived milestones (same-day range or
  due-only) — `backend/prisma/schema.prisma`, migration
  `task_is_milestone`. `POST /projects/:id/tasks` and `PATCH /tasks/:id`
  accept `isMilestone`; both enforce startDate = dueDate for milestones.
```

```bash
git add backend/prisma CHANGELOG.md backend/src/routes/projects.ts backend/src/routes/tasks.ts
git commit -m "feat(tasks): explicit isMilestone flag with derived-state backfill"
```

---

### Task 3: Frontend — consume the flag + Task/Milestone toggle in TaskPanel

**Files:**
- Modify: `frontend/src/lib/queries.ts` (Task interface line 118; task create-body and patch types)
- Modify: `frontend/src/lib/gantt/geometry.ts` (`isMilestoneTask` line 326; `buildRows` parents loop line 402)
- Modify: `frontend/src/components/TaskPanel.tsx` (after the Priority button, line ~448)

**Interfaces:**
- Consumes: `Task.isMilestone` from Task 2's API payloads; TaskPanel's existing `patch()` helper (line 150) and `canEdit`.
- Produces: `Row.isMilestone` now mirrors the explicit flag (GanttBar/GanttConnectors read it unchanged); due-only non-milestone tasks render as 1-day bars anchored on the due date.

- [ ] **Step 1: Extend the types**

`frontend/src/lib/queries.ts` — in `interface Task` after `dueDate: string | null;`:

```ts
  isMilestone: boolean;
```

Find the task write payload types: `grep -n "startDate?" frontend/src/lib/queries.ts` — in each hit's type (task create body and task patch), add alongside:

```ts
  isMilestone?: boolean;
```

- [ ] **Step 2: Replace the derivation**

`frontend/src/lib/gantt/geometry.ts` lines 326–331, replace the body:

```ts
function isMilestoneTask(task: Task): boolean {
  // Explicit flag (Task.isMilestone) — the old same-day/due-only derivation
  // now lives only in the one-time DB backfill.
  return task.isMilestone;
}
```

- [ ] **Step 3: Keep due-only unflagged tasks drawable**

In `buildRows`'s parents loop (`geometry.ts:402`), replace the `start:` line of the pushed row:

```ts
        // A due-only task that is NOT a milestone still needs a drawable
        // range — anchor a 1-day bar on its due date. (GanttBar returns null
        // for non-milestones missing either endpoint.)
        start: p.startDate
          ? parseISODate(p.startDate)
          : !isMilestoneTask(p) && p.dueDate
            ? parseISODate(p.dueDate)
            : null,
```

- [ ] **Step 4: Add the toggle to TaskPanel**

`frontend/src/components/TaskPanel.tsx`, directly after the Priority `</button>` (line ~448), matching the existing label/control grid rows:

```tsx
            <span className="self-center font-display text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
              Type
            </span>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => patch({ isMilestone: !task.isMilestone })}
              className="flex items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-surface-container-high disabled:cursor-default"
              title={canEdit ? "Toggle between task bar and milestone diamond" : undefined}
            >
              <span
                className={`material-symbols-outlined text-[15px] ${task.isMilestone ? "text-primary" : "text-on-surface-variant"}`}
              >
                {task.isMilestone ? "diamond" : "check_box_outline_blank"}
              </span>
              <span className="text-on-surface">
                {task.isMilestone ? "Milestone" : "Task"}
              </span>
            </button>
```

- [ ] **Step 5: Type-check**

Run: `docker compose exec frontend npm run typecheck` → exit 0.

- [ ] **Step 6: Manual verify**

In the Gantt: (a) existing diamonds unchanged (backfill); (b) open a normal task in the panel → "Type: Task" → click → row becomes a diamond at its due date, dates in list show the single day; (c) toggle back → 1-day bar (start was synced to due); (d) create a new task with start = due → renders a short **bar**, not a diamond; (e) a task with only a due date and Type = Task shows a 1-day bar.

- [ ] **Step 7: CHANGELOG + commit**

`CHANGELOG.md` → `### Changed`:

```markdown
- Gantt milestone rendering now follows the explicit `isMilestone` flag
  (Task/Milestone toggle in TaskPanel) instead of inferring from same-day
  dates — `frontend/src/lib/gantt/geometry.ts`,
  `frontend/src/components/TaskPanel.tsx`, `frontend/src/lib/queries.ts`.
  Due-only non-milestone tasks render as 1-day bars.
```

```bash
git add frontend/src/lib/queries.ts frontend/src/lib/gantt/geometry.ts frontend/src/components/TaskPanel.tsx CHANGELOG.md
git commit -m "feat(gantt): task/milestone toggle driven by explicit isMilestone flag"
```

---

### Task 4: Dependency connector dots on milestone diamonds

The milestone branch early-returns before the connector-dot block, so diamonds can only *receive* dependency drops, never start them.

**Files:**
- Modify: `frontend/src/components/gantt/GanttBar.tsx` (milestone branch, lines 222–269)

**Interfaces:**
- Consumes: existing `onConnectStart(taskId, side, clientX, clientY)` prop and the frame-level gesture capture (`GanttFrame.tsx:192-281`); `cx`, `cy`, `half` locals of the milestone branch.
- Produces: nothing new — same callback contract as regular bars.

- [ ] **Step 1: Add the dots inside the milestone fragment**

In the milestone branch's returned fragment, after the diamond `</div>` (line 267) and before `</>`:

```tsx
        {canEdit && onConnectStart && (
          <>
            <div
              title="Drag from another task to make this milestone depend on it"
              className="pointer-events-none absolute z-[3] h-3 w-3 cursor-crosshair rounded-full border-2 border-white bg-primary opacity-0 shadow transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:opacity-100"
              style={{
                left: cx - half - 4,
                top: cy,
                transform: "translate(-50%, -50%)",
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onConnectStart(row.taskId!, "left", e.clientX, e.clientY);
              }}
            />
            <div
              title="Drag to a task to create a dependency"
              className="pointer-events-none absolute z-[3] h-3 w-3 cursor-crosshair rounded-full border-2 border-white bg-primary opacity-0 shadow transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:opacity-100"
              style={{
                left: cx + half + 4,
                top: cy,
                transform: "translate(-50%, -50%)",
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onConnectStart(row.taskId!, "right", e.clientX, e.clientY);
              }}
            />
          </>
        )}
```

(Same classes as the bar-branch dots at lines 340–371, so hover reveal via the row-level `group` class behaves identically; dots sit 4 px outside the 12 px diamond so they don't cover it.)

- [ ] **Step 2: Type-check**

Run: `docker compose exec frontend npm run typecheck` → exit 0.

- [ ] **Step 3: Manual verify**

Hover a milestone row → two green dots flank the diamond. Drag the right dot onto a task bar → dependency arrow appears (milestone as predecessor); drag another bar's right dot onto the diamond → arrow in (still works as target); left-dot drag creates the reverse direction; reload → arrows persist; clicking the diamond (not the dots) still opens the task panel. `GanttConnectors.tsx:118-138` already anchors milestone endpoints — no change expected there.

- [ ] **Step 4: CHANGELOG + commit**

`CHANGELOG.md` → `### Fixed`:

```markdown
- Milestone diamonds can now initiate dependency drags (connector dots were
  unreachable in the milestone render branch) —
  `frontend/src/components/gantt/GanttBar.tsx`.
```

```bash
git add frontend/src/components/gantt/GanttBar.tsx CHANGELOG.md
git commit -m "fix(gantt): dependency connector dots on milestone diamonds"
```

---

### Task 5: "Color by" selector (Status | Section | Priority) for bars + exports

**Files:**
- Modify: `frontend/src/lib/gantt/palette.ts` (resolver + legend + type)
- Modify: `frontend/src/components/gantt/GanttFrame.tsx` (state, toolbar control, legend, export opts)
- Modify: `frontend/src/components/gantt/GanttBar.tsx` (line 76 color source; new prop)
- Modify: whichever component instantiates `<GanttBar` (find via `grep -rn "<GanttBar" frontend/src` — thread the prop through)
- Modify: `frontend/src/lib/gantt/exportPdf.ts` (opts + line 292), `frontend/src/lib/gantt/exportExcel.ts` (opts + line 258)

**Interfaces:**
- Consumes: `Row.status`, `Row.priority`, `Row.sectionColor`; existing `STATUS_FILL_HEX` / `PRIORITY_BORDER_HEX` / `DEFAULT_SECTION_COLOR`.
- Produces: `type ColorByMode = "status" | "section" | "priority"`; `barFillHex(opts, mode): string`; `legendEntries(mode): Array<[string, string]>`; `colorBy: ColorByMode` prop on GanttBar; `colorBy` field on `ExportPdfOpts` / `ExportExcelOpts`. Task 6 consumes `SECTION_COLOR_PRESETS` (defined here).

- [ ] **Step 1: Add resolver, legend, presets to palette.ts**

Append to `frontend/src/lib/gantt/palette.ts`:

```ts
export type ColorByMode = "status" | "section" | "priority";

// Single fill resolver for live bars AND both exports — keeps the screen and
// generated documents in agreement whichever mode is active. TaskStatus and
// Priority are already imported at the top of this file, and the two Records
// are strictly keyed — hence the enum-typed opts (not string).
export function barFillHex(
  opts: {
    status?: TaskStatus | null;
    priority?: Priority | null;
    sectionColor?: string | null;
  },
  mode: ColorByMode,
): string {
  if (mode === "status") return STATUS_FILL_HEX[opts.status ?? "TODO"];
  if (mode === "priority") return PRIORITY_BORDER_HEX[opts.priority ?? "MEDIUM"];
  return opts.sectionColor ?? DEFAULT_SECTION_COLOR;
}

export function legendEntries(mode: ColorByMode): Array<[string, string]> {
  if (mode === "status") {
    return [
      ["To Do", STATUS_FILL_HEX.TODO],
      ["In Progress", STATUS_FILL_HEX.IN_PROGRESS],
      ["Done", STATUS_FILL_HEX.DONE],
    ];
  }
  if (mode === "priority") {
    return [
      ["Low", PRIORITY_BORDER_HEX.LOW],
      ["Medium", PRIORITY_BORDER_HEX.MEDIUM],
      ["High", PRIORITY_BORDER_HEX.HIGH],
      ["Urgent", PRIORITY_BORDER_HEX.URGENT],
    ];
  }
  // Section mode: the colored dots on section rows are the legend.
  return [];
}

// Preset swatches for the section color picker (Task 6). First entry is the
// schema default. Curated set that reads on both light and dark surfaces.
export const SECTION_COLOR_PRESETS = [
  "#94a3b8", // slate (default)
  "#3b82f6", // blue
  "#0ea5e9", // sky
  "#14b8a6", // teal
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // rose
  "#8b5cf6", // violet
] as const;
```

- [ ] **Step 2: State + persistence in GanttFrame**

`frontend/src/components/gantt/GanttFrame.tsx`, near the other view-state hooks (`const [viewMode, setViewMode] = useState<ViewMode>("week");`, line 134):

```ts
const COLOR_BY_STORAGE_KEY = "solvro.gantt.colorBy";
```

(module scope), and in the component:

```ts
  // Default "section" (decided 2026-07-20): upgrade-day visuals stay exactly
  // as before — status/priority coloring is one click away in the toolbar.
  const [colorBy, setColorBy] = useState<ColorByMode>(() => {
    const v = localStorage.getItem(COLOR_BY_STORAGE_KEY);
    return v === "section" || v === "priority" || v === "status" ? v : "section";
  });
  useEffect(() => {
    localStorage.setItem(COLOR_BY_STORAGE_KEY, colorBy);
  }, [colorBy]);
```

Import `ColorByMode`, `legendEntries` from `@/lib/gantt/palette`.

- [ ] **Step 3: Toolbar control + legend**

In the Gantt toolbar, next to the existing Baseline toggle, add (reusing the toolbar's existing control styling conventions):

```tsx
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
              Color
            </span>
            <div className="flex items-center gap-0.5 rounded border border-outline-variant p-0.5">
              {(["status", "section", "priority"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setColorBy(m)}
                  className={[
                    "rounded px-2 py-0.5 text-[11px] capitalize",
                    colorBy === m
                      ? "bg-primary text-on-primary"
                      : "text-on-surface-variant hover:bg-surface-container-high",
                  ].join(" ")}
                >
                  {m}
                </button>
              ))}
            </div>
            {legendEntries(colorBy).length > 0 && (
              <div className="ml-2 hidden items-center gap-2 lg:flex">
                {legendEntries(colorBy).map(([label, hex]) => (
                  <span
                    key={label}
                    className="flex items-center gap-1 text-[10px] text-on-surface-variant"
                  >
                    <span
                      className="h-2 w-2 rounded-[2px]"
                      style={{ backgroundColor: hex }}
                      aria-hidden="true"
                    />
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
```

- [ ] **Step 4: Bar fill follows the mode**

`GanttBar.tsx`: add to props `colorBy: ColorByMode;` (import from `@/lib/gantt/palette` along with `barFillHex`), and replace line 76:

```ts
  const color = row.sectionColor ?? DEFAULT_SECTION_COLOR;
```

with:

```ts
  const color = barFillHex(
    { status: row.status, priority: row.priority, sectionColor: row.sectionColor },
    colorBy,
  );
```

Track opacity (`BAR_TRACK_OPACITY`) and solid progress fill logic are untouched — only the source hex changes. The milestone diamond stays `rgb(var(--primary))`. Thread the prop from GanttFrame through the component(s) found via `grep -rn "<GanttBar" frontend/src`.

- [ ] **Step 5: Exports honor the mode**

`exportPdf.ts`: add `colorBy: ColorByMode;` to `ExportPdfOpts` (import type from `./palette`), destructure it, and replace line 292:

```ts
        const [fr, fg, fb] = hexToRgb(STATUS_FILL_HEX[status]);
```

with:

```ts
        const [fr, fg, fb] = hexToRgb(
          barFillHex(
            { status, priority, sectionColor: row.sectionColor },
            colorBy,
          ),
        );
```

`exportExcel.ts`: same opts addition; replace line 258:

```ts
      const fillHex = STATUS_FILL_HEX[status].replace(/^#/, "");
```

with:

```ts
      const fillHex = barFillHex(
        { status, priority, sectionColor: r.sectionColor },
        colorBy,
      ).replace(/^#/, "");
```

Keep the priority left-edge border in both exports (redundant-but-harmless in priority mode). In `GanttFrame.tsx`'s export `register({ excel, pdf })` block (line 482), pass `colorBy` into both calls and add `colorBy` to both effects' dependency arrays.

- [ ] **Step 6: Type-check**

Run: `docker compose exec frontend npm run typecheck` → exit 0.

- [ ] **Step 7: Manual verify**

Gantt loads in Section mode looking exactly as before (grey until Task 6 sets colors); switching to Status shows To Do sky / In Progress blue / Done emerald with the legend; Priority recolors likewise; reload keeps the last mode; Excel and PDF exports match the active mode in each of the three modes. **Note:** because exports now follow the mode, an untouched install exports section-grey instead of today's hardcoded status colors — switch to Status (persists) or set section colors to get colored exports.

- [ ] **Step 8: CHANGELOG + commit**

`CHANGELOG.md` → `### Added` (and the export-default nuance under `### Changed`):

```markdown
### Added
- Gantt "Color by" selector (Status | Section | Priority) with legend,
  persisted in localStorage (`solvro.gantt.colorBy`), defaulting to Section
  so upgrade-day visuals are unchanged; shared `barFillHex` resolver drives
  live bars and both exports — `frontend/src/lib/gantt/palette.ts`,
  `GanttFrame.tsx`, `GanttBar.tsx`, `exportPdf.ts`, `exportExcel.ts`.
### Changed
- Excel/PDF Gantt exports now color by the selected mode instead of always
  status — in the default Section mode with unset section colors they render
  grey until a mode is chosen or colors are set (screen and export now
  always agree).
```

```bash
git add frontend/src/lib/gantt frontend/src/components/gantt CHANGELOG.md
git commit -m "feat(gantt): color-by selector for bars and exports with legend"
```

---

### Task 6: Section color swatch picker

Backend already accepts it: `updateSectionSchema` in `backend/src/routes/sections.ts` validates `color: z.string().regex(/^#[0-9a-fA-F]{6}$/)`. Only the UI path is missing.

**Files:**
- Modify: `frontend/src/lib/queries.ts` (section update patch type)
- Modify: `frontend/src/components/gantt/GanttFrame.tsx` (handler; pass to list pane)
- Modify: `frontend/src/components/gantt/GanttListPane.tsx` (prop pass-through)
- Modify: `frontend/src/components/gantt/GanttListRow.tsx` (dot → picker popover, lines 131–135; props line 13)

**Interfaces:**
- Consumes: `SECTION_COLOR_PRESETS` from Task 5; existing `useUpdateSection(projectId)` (already instantiated in GanttFrame line 88); backend PATCH `/sections/:id` `{ color }`.
- Produces: `onSetSectionColor(sectionId: number, color: string): void` prop threaded GanttFrame → GanttListPane → GanttListRow.

- [ ] **Step 1: Allow `color` in the section patch type**

In `frontend/src/lib/queries.ts`, find the section update patch type (`grep -n "useUpdateSection" frontend/src/lib/queries.ts`, then its patch type — the one with `name?` / `position?`) and add:

```ts
  color?: string;
```

- [ ] **Step 2: Handler in GanttFrame, threaded down**

In `GanttFrame.tsx` (has `updateSection` at line 88):

```ts
  const onSetSectionColor = useCallback(
    (sectionId: number, color: string) => {
      updateSection.mutate({ id: sectionId, patch: { color } });
    },
    [updateSection],
  );
```

Pass `onSetSectionColor={onSetSectionColor}` to `<GanttListPane …>`; in `GanttListPane.tsx` add it to props and forward to each `<GanttListRow …>`.

- [ ] **Step 3: Dot becomes a picker in GanttListRow**

Add to `GanttListRowProps`: `onSetSectionColor: (sectionId: number, color: string) => void;`. Add local state `const [pickingColor, setPickingColor] = useState(false);`. Import `SECTION_COLOR_PRESETS` from `@/lib/gantt/palette`. Replace the section color dot (lines 131–135) with:

```tsx
            <span className="relative flex shrink-0 items-center">
              <button
                type="button"
                disabled={!canEdit || row.sectionId === null}
                onClick={(e) => {
                  e.stopPropagation();
                  setPickingColor((v) => !v);
                }}
                className="h-2 w-2 rounded-full disabled:cursor-default"
                style={{ backgroundColor: row.sectionColor ?? DEFAULT_SECTION_COLOR }}
                aria-label="Set section color"
                title={canEdit ? "Set section color" : undefined}
              />
              {pickingColor && canEdit && row.sectionId !== null && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPickingColor(false);
                    }}
                    aria-label="Close color picker"
                  />
                  {/* Floating popover — shadow allowed per DESIGN.md exception */}
                  <div className="absolute left-0 top-4 z-50 flex gap-1 rounded border border-outline-variant bg-surface-container-lowest p-1.5 shadow-lg">
                    {SECTION_COLOR_PRESETS.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        className="h-4 w-4 rounded-full hover:ring-2 hover:ring-primary"
                        style={{ backgroundColor: hex }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSetSectionColor(row.sectionId!, hex);
                          setPickingColor(false);
                        }}
                        aria-label={`Section color ${hex}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </span>
```

- [ ] **Step 4: Type-check**

Run: `docker compose exec frontend npm run typecheck` → exit 0.

- [ ] **Step 5: Manual verify**

Click a section's dot → 8-swatch popover; pick emerald → dot, section band, and (in Color-by: Section mode) every bar in that section recolor after the query invalidation settles; reload persists (DB-backed); clicking elsewhere closes the popover; read-only users (`canEdit` false) get an inert dot; the "(No section)" pseudo-row has no picker.

- [ ] **Step 6: CHANGELOG + commit**

`CHANGELOG.md` → `### Added`:

```markdown
- Section color picker (8 preset swatches) on the Gantt section rows,
  feeding the existing sections PATCH `color` field —
  `frontend/src/components/gantt/GanttListRow.tsx`, `GanttListPane.tsx`,
  `GanttFrame.tsx`, `frontend/src/lib/queries.ts`.
```

```bash
git add frontend/src/components/gantt frontend/src/lib/queries.ts CHANGELOG.md
git commit -m "feat(gantt): section color swatch picker"
```

---

### Task 7: Clipboard fallback for insecure origins

`navigator.clipboard` is `undefined` on plain-HTTP LAN origins — Reports copy-packet and Admin ID-copy silently break in prod today.

**Files:**
- Create: `frontend/src/lib/clipboard.ts`
- Modify: `frontend/src/pages/Reports.tsx` (line 192), `frontend/src/pages/Admin.tsx` (line 927)

**Interfaces:**
- Consumes: nothing.
- Produces: `copyText(text: string): Promise<void>` — throws on total failure so existing catch/toast paths still fire.

- [ ] **Step 1: Create the helper**

`frontend/src/lib/clipboard.ts`:

```ts
/**
 * Copy text with a fallback for insecure origins. navigator.clipboard is
 * only defined in secure contexts (HTTPS / localhost); prod is served over
 * plain HTTP on the LAN, so fall back to the legacy textarea + execCommand
 * path there. Throws if both paths fail so callers can toast the error.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy to clipboard is not available in this browser.");
    }
  } finally {
    document.body.removeChild(ta);
  }
}
```

- [ ] **Step 2: Use it at both call sites**

`Reports.tsx:192`: replace `await navigator.clipboard.writeText(markdown);` with `await copyText(markdown);` and add `import { copyText } from "@/lib/clipboard";`.

`Admin.tsx:927`: replace `onClick={() => void navigator.clipboard.writeText(id)}` with `onClick={() => void copyText(id)}` and add the same import.

- [ ] **Step 3: Type-check**

Run: `docker compose exec frontend npm run typecheck` → exit 0.

- [ ] **Step 4: Manual verify**

Normal path: Reports → copy button → paste works. Fallback path: in DevTools console run
`Object.defineProperty(navigator, "clipboard", { value: undefined });`
then click copy again → paste still works (execCommand path).

- [ ] **Step 5: CHANGELOG + commit**

`CHANGELOG.md` → `### Fixed`:

```markdown
- Copy-to-clipboard (Reports export packet, Admin ID copy) failed on the
  plain-HTTP prod origin where `navigator.clipboard` is undefined; added
  `frontend/src/lib/clipboard.ts` fallback (textarea + execCommand).
```

```bash
git add frontend/src/lib/clipboard.ts frontend/src/pages/Reports.tsx frontend/src/pages/Admin.tsx CHANGELOG.md
git commit -m "fix(clipboard): execCommand fallback for insecure origins"
```

---

### Task 8: "View PDF" — open the Gantt PDF in a new tab

On the plain-HTTP prod origin, Chrome's download pipeline stalls on finalization (Appendix). Rendering the PDF in the browser's built-in viewer bypasses the download shelf entirely for viewing/printing. Partial mitigation by design: the viewer's own download button re-enters the download pipeline, and Excel has no in-browser viewer — the Appendix options remain the real fix for downloads.

**Files:**
- Modify: `frontend/src/lib/gantt/exportContext.tsx` (`GanttExportHandlers` interface)
- Modify: `frontend/src/lib/gantt/exportPdf.ts` (opts + output, line 370)
- Modify: `frontend/src/components/gantt/GanttFrame.tsx` (register block, line 482)
- Modify: `frontend/src/components/layout/RightSidebar.tsx` (lines 23–33 `runExport`, 160–184 buttons)

**Interfaces:**
- Consumes: Task 5's `ExportPdfOpts` shape (adds `colorBy`) — run this task after Task 5.
- Produces: `pdfTab: (win: Window | null) => Promise<void>` on `GanttExportHandlers`; `tabWindow?: Window | null` on `ExportPdfOpts`.

- [ ] **Step 1: Extend the handlers interface**

`frontend/src/lib/gantt/exportContext.tsx`:

```ts
export interface GanttExportHandlers {
  excel: () => Promise<void>;
  pdf: () => Promise<void>;
  /**
   * Render the PDF into an already-open window instead of downloading.
   * `win` MUST be opened synchronously inside the triggering click handler
   * (pop-up blockers reject windows opened after async work); pass null if
   * window.open was blocked and the handler will throw a friendly error.
   */
  pdfTab: (win: Window | null) => Promise<void>;
}
```

- [ ] **Step 2: Teach exportPdf a tab target**

`frontend/src/lib/gantt/exportPdf.ts` — add to `ExportPdfOpts`:

```ts
  /** When set, render into this window instead of triggering a download. */
  tabWindow?: Window | null;
```

destructure `tabWindow` alongside the other opts, and replace the final line (`pdf.save(...)`, line 370) with:

```ts
  if (tabWindow !== undefined) {
    // Browser-viewer path: bypasses the download pipeline, which hangs on
    // Safe Browsing finalization on the plain-HTTP prod origin (see
    // docs/plans/gantt-ux-and-export-fixes-plan.md appendix).
    const blobUrl = String(pdf.output("bloburl"));
    if (tabWindow) {
      tabWindow.location.href = blobUrl;
    } else {
      const w = window.open(blobUrl, "_blank");
      if (!w) {
        throw new Error(
          "Pop-up blocked — allow pop-ups for this site to view the PDF.",
        );
      }
    }
  } else {
    pdf.save(`${slugify(projectName)}_gantt_${fmtIsoDate(new Date())}.pdf`);
  }
```

- [ ] **Step 3: Register the handler in GanttFrame**

In the `register({ excel, pdf })` block (`GanttFrame.tsx:482`), add after `pdf:`:

```ts
      pdfTab: async (win) => {
        try {
          await exportGanttToPdf({
            projectName,
            rows,
            exportStart: excelStart,
            exportEnd: excelEnd,
            holidays: holidays ?? [],
            colorBy,
            tabWindow: win,
          });
        } catch (err) {
          setActionError(
            err instanceof Error ? err.message : "PDF view failed.",
          );
          throw err;
        }
      },
```

(Same opts as `pdf` plus `tabWindow`; no new dependency-array entries beyond Task 5's `colorBy`.)

- [ ] **Step 4: Third button + synchronous window.open in RightSidebar**

`frontend/src/components/layout/RightSidebar.tsx` — widen the state and wrapper (lines 23–33):

```ts
  const [exporting, setExporting] = useState<"excel" | "pdf" | "pdfTab" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  async function runExport(kind: "excel" | "pdf" | "pdfTab") {
    if (!exportHandlers || exporting) return;
    setExportError(null);
    setExporting(kind);
    // Open the tab synchronously inside the click's user activation —
    // opening after the async export work would be pop-up-blocked.
    const win = kind === "pdfTab" ? window.open("", "_blank") : null;
    try {
      if (kind === "pdfTab") await exportHandlers.pdfTab(win);
      else await exportHandlers[kind]();
    } catch (err) {
      win?.close();
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  }
```

Change the buttons grid from `grid grid-cols-2 gap-2` to `grid grid-cols-3 gap-2` and add a third button after the PDF one, matching its classes:

```tsx
              <button
                type="button"
                onClick={() => runExport("pdfTab")}
                disabled={exporting !== null}
                className="inline-flex items-center justify-center gap-1.5 rounded border border-outline-variant bg-surface-container-lowest px-2.5 py-2 font-display text-[12px] font-semibold text-on-surface transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[17px]">
                  open_in_new
                </span>
                {exporting === "pdfTab" ? "Opening…" : "View"}
              </button>
```

Update the caption line below the grid to:

```tsx
            <p className="mt-2 text-[11px] text-on-surface-variant">
              Excel: tasks + date grid · PDF: download · View: open the PDF in a
              tab (use when downloads hang).
            </p>
```

- [ ] **Step 5: Type-check**

Run: `docker compose exec frontend npm run typecheck` → exit 0.

- [ ] **Step 6: Manual verify**

Gantt → right sidebar → "View": a new tab opens immediately (blank), then swaps to the rendered PDF in Chrome's viewer; Excel and PDF buttons behave as before; with pop-ups blocked for the site, the error alert shows the pop-up message and the blank tab closes; printing from the viewer works.

- [ ] **Step 7: CHANGELOG + commit**

`CHANGELOG.md` → `### Added`:

```markdown
- "View" export action opening the Gantt PDF in a browser tab (bypasses the
  download pipeline that hangs on the HTTP-only prod origin) —
  `frontend/src/lib/gantt/exportContext.tsx`, `exportPdf.ts`,
  `GanttFrame.tsx`, `frontend/src/components/layout/RightSidebar.tsx`.
```

```bash
git add frontend/src/lib/gantt frontend/src/components/gantt/GanttFrame.tsx frontend/src/components/layout/RightSidebar.tsx CHANGELOG.md
git commit -m "feat(gantt): view PDF in browser tab as download-pipeline workaround"
```

---

## Appendix (no code): Production export-download hang

> **CORRECTED 2026-07-31 — this appendix's diagnosis is wrong.** The real cause
> is Chromium's insecure-download blocking, keyed on the origin scheme
> (`http://solvro.elitery.local`), not Safe Browsing and not VPN egress. The
> browser states it directly: "blocked this download because the site isn't
> using a secure connection and the file may have been tampered with" (observed
> in Dia, 2026-07-31). Two facts falsify the Safe Browsing theory:
> `kDownloadRequestTimeoutMs = 7000` caps the download-protection ping at 7 s
> and then allows the download, and `.pdf` is `SAMPLED_PING` (verdict unused)
> yet is blocked all the same. The fixes listed below —
> `SafeBrowsingAllowlistDomains`, split-tunnelling, the Firefox stopgap — do
> not address the actual cause. Current record and real fix directions:
> `docs/ISSUES.md` → "Gantt Excel/PDF export downloads blocked in production".
> Kept unedited below as the historical record of what was believed on
> 2026-07-20.

**Diagnosis:** Excel/PDF exports generate client-side and reach 100% in the download shelf ("10/10 KB", "43/43 KB") then never finalize — the signature of Chrome's Safe Browsing download check unable to reach Google from a full-tunnel VPN with no internet egress. Not fixable in Solvro code; the download pipeline runs after `pdf.save()` / the blob anchor click.

**Confirm first (5 minutes, over VPN):**
1. Open google.com → unreachable confirms full tunnel.
2. `chrome://downloads` during a stuck export → "Scanning…" state.
3. Same export in Firefox → completes instantly (Firefox deep-checks executables only).
4. Optional: Chrome Safe Browsing → "No protection", retry, flip back.

**Fixes, in order of preference:**
1. **Split-tunnel the VPN** (route only internal subnets) — permanent, fixes every user.
2. **Managed-Chrome policy** `SafeBrowsingAllowlistDomains` for the Solvro host.
3. **Stopgap:** use Firefox for exports.

**Do regardless:** serve prod over **HTTPS with an internal-CA cert** (edit `setup.sh` / prod nginx). Revives clipboard (Task 7 becomes belt-and-braces), enables the PWA service worker (currently never registers in prod), and future secure-context APIs. This is an infra change on the deploy host — coordinate separately from this plan's code tasks.

**Decided 2026-07-20:** the in-app "View PDF in tab" path ships as Task 8 — a *partial* mitigation (viewing/printing only; the viewer's download button re-enters the download pipeline, and Excel has no in-browser viewer). The browser-side options above remain the real fix; the per-machine `SafeBrowsingAllowlistDomains` policy is the leading candidate once the diagnostic confirms the cause. NetBird stays as-is — none of these options require changing zones, routes, or the http:// origin.

**Explicitly not doing:** disabling Safe Browsing permanently; server-side export generation.
