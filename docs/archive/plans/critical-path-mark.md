# Critical Path mark — phase plan

**Date:** 2026-09-02 · **Status:** built, reviewed, gates 17/17 (4 runs) — committed `6790fbf`, PR #161 merged into `develop` 2026-09-02 (CI green); 2 open user decisions (dark-theme ring color; app-wide icon-size cascade) recorded in `docs/ISSUES.md` · **Branch:** `feat/critical-path-mark`, cut from `origin/develop` at `de75e2c`.
**Phase = branch = one PR into `develop`.** Tasks = commits. No commit or PR without explicit user approval.
**Visual:** artifact "Critical Path Mark" (before / after per surface) — the mockups there are the visual contract for T2 and T3.

## 1. Decision

A task carries a manual **Critical Path** mark. The TAM sets it. Nothing computes it.

- Meaning: "if this task slips, the project end date slips." It is not priority. `URGENT` says "do it now"; a `MEDIUM` task can still be on the critical path. Both fields stay.
- Not the computed critical path. `CLAUDE.md`'s standing decision ("Critical-path highlighting: deferred") covers the computed kind (Kahn sort + longest path over `TaskDependency`, deleted with the Network Diagram — `CHANGELOG.md:3634`). That stays deferred. A later "Suggest from dependencies" action can fill this flag; the flag stays the source of truth.
- User decisions, 2026-09-02: label **"Critical Path"** (exact casing, every surface); the mark **shows in the customer-facing exports** (PDF + Excel).

## 2. Goals / Non-goals

Goals
- One boolean on `Task`, editable wherever a task's other flags are edited (task panel, task form, Gantt row menu).
- One marking, the same on every surface: Gantt bar + tree, Kanban card, Timeline card, List row, task panel, task form, PDF, Excel.
- The marking survives every Gantt Color-by mode (status / section / priority) — it is a ring and a glyph, never a fill.

Non-goals (this phase)
- No "Critical Path only" filter. The Gantt and Kanban have no filter UI today; the global `/tasks` page has one (`reui/filters`) but is hidden from the sidebar. Follow-up if asked.
- No inheritance or rollup: a parent is not marked because a child is; a section rollup bar never shows the ring.
- No computation from dependencies, no connector tint, no new tokens, no new npm packages, no CSS in `index.css`.

## 3. The mark — single spec

| Piece | Value | Source |
|---|---|---|
| Field | `Task.isCriticalPath` → column `is_critical_path`, `Boolean @default(false)`, next to `isMilestone` | `backend/prisma/schema.prisma:284` |
| Name rationale | Mirrors the label; cannot be misread as "priority critical". (Supersedes the `isCritical` name floated in chat.) | — |
| Color | `chip-violet` pair — ring / stroke / glyph = `chip-violet-text` (`#ddd6fe` dark, `#6d28d9` light); chip = `bg-chip-violet-bg text-chip-violet-text` | `docs/DESIGN.md` §1 chip pairs; `index.css:59-60` |
| Why violet | Priority already spends gray / amber / rose; status spends gray / green / emerald; labels are user colors. Violet is the one chip hue with no task-surface meaning (`index.css:153`). A red ring beside a rose `URGENT` chip would read as the same thing. |
| Glyph | Material Symbol `conversion_path` (nodes on a path). If the ligature does not render at the app's pinned axes, use `route`. | `docs/DESIGN.md` §5 icons rule |
| Chip text | `Critical Path` | user decision |
| Helper text | `Slip here moves the end date.` (panel `title`, form caption) | — |
| DOM contract | `data-critical-path` on the Gantt bar wrapper (`[data-task-id]` span, task bars and milestones); chip text "Critical Path" on cards; panel toggle `aria-label="Critical Path: Yes"` / `"Critical Path: No"` | e2e selectors, T4 |

Per surface:

| Surface | File | Mark |
|---|---|---|
| Gantt task bar | `gantt-v2/SolvroBar.tsx:366-395` | A new overlay span after the fill spans, inside the backdrop: `pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-inset ring-chip-violet-text`. Placed after the fill so it paints above hatch and progress. Selection keeps its `outline` (the file's own comment reserves `ring` for exactly this). |
| Gantt milestone | `gantt-v2/SolvroBar.tsx:287-310` | The diamond span gets `outline outline-2 outline-offset-1 outline-chip-violet-text` (outline rotates with the `rotate-45` box, so it reads as a diamond ring). The wrapper's selection outline is untouched. |
| Gantt tree name cell | `gantt-v2/SolvroGantt.tsx:1442` | Glyph after `TaskStatusDot`, `text-chip-violet-text text-[14px]`, `title="Critical Path"`. |
| Gantt row menu | `gantt-v2/SolvroGantt.tsx:1506-1523` | New `ContextMenuItem` between Edit and Add subtask: "Mark as Critical Path" / "Remove from Critical Path" → `useUpdateTask` patch `{ isCriticalPath }`. `canEdit` only (the menu already is). |
| Gantt Color-by key | `gantt-v2/SolvroGantt.tsx:1255` | One static last row in the key: a ring swatch (empty box with the violet ring) + "Critical Path". Shown in every mode. |
| Kanban card | `kanban-v2/cards.tsx:165` | Chip before `PriorityBadge` in the bottom-right group: glyph + "Critical Path", compact padding. |
| Timeline card | `pages/views/ProjectTimeline.tsx:172` | Chip after `PriorityBadge` in the header row. |
| List row | `pages/views/ProjectList.tsx:778-820` | Glyph (the component's 14px) beside the 15px priority flag icon on task rows; after the title on subtask rows (`SubtaskRow` has no flag). `title="Critical Path"`. |
| Task panel | `components/TaskPanel.tsx:484-502` | New label/row pair after "Type": label `Critical Path`; button with the same classes as the Type button; icon `conversion_path` (`text-chip-violet-text` when on, `check_box_outline_blank` `text-on-surface-variant` when off); text "Yes" / "No"; `title` = helper text; `aria-label` per the DOM contract; `patch({ isCriticalPath: !task.isCriticalPath })`. |
| Task form | `components/TaskFormModal.tsx:305` | New `FieldRow icon="conversion_path" label="Critical Path"` after Status: `ui/checkbox.tsx` + caption "Slip here moves the end date." State seeds from `editingTask.isCriticalPath`; sent on create and edit. |
| PDF | `lib/gantt/exportPdf.ts:735-737, 677-690, 844-852` | After the fill: `pdf.setDrawColor(0x6d,0x28,0xd9); pdf.setLineWidth(0.75)` and stroke the same rounded rect (diamond: stroke the diamond). Table gains a "Critical Path" column ("Yes" or "") **only when at least one exported task row is marked** (`rows.some(r => r.isCriticalPath)`); otherwise the table is byte-identical to today. Light-theme violet — the PDF is a print surface. |
| Excel | `lib/gantt/exportExcel.ts:63-70, 257-280` | Tasks sheet: column `{ header: "Critical Path", key: "criticalPath", width: 14 }` after Priority, value "Yes" or "" — **same gate: only when at least one exported task row is marked**. Gantt sheet: painted bar cells get `top` + `bottom` borders `{ style: "medium", color: 6D28D9 }` (per task, so nothing shows when nothing is marked). |
| Empty-project rule | both exports | A project with no marked task exports exactly as before: no column, no stroke, no border. User decision 2026-09-02. |
| Export rows | `lib/gantt/geometry.ts:24-25` | `Row.isCriticalPath?: boolean`, mirrored from the task at both `isMilestone` sites (`:196`, `:218`). |

The mark component — `frontend/src/components/CriticalPathMark.tsx`:

```
<CriticalPathMark variant="chip" />   // Chip tone="violet": glyph + "Critical Path"
<CriticalPathMark variant="glyph" />  // glyph only, title="Critical Path"
```

Built on the generic `Chip` from `StatusChip.tsx` (tone `violet`). No new tokens, no new CSS. `StatusChip` / `PriorityBadge` / `LabelChip` are untouched (user gate, 2026-08-01).

## 4. API contract

| Route | Change |
|---|---|
| `POST /projects/:id/tasks` (`routes/projects.ts:88-106, 410-428`) | `isCriticalPath: z.boolean().optional()`; create writes `isCriticalPath: body.isCriticalPath ?? false`. |
| `PATCH /tasks/:id` (`routes/tasks.ts:20-44, 196-205`) | `isCriticalPath: z.boolean().optional()`; `if (body.isCriticalPath !== undefined) data.isCriticalPath = body.isCriticalPath;`. No refine — any task may carry the mark, milestones and subtasks included. |
| Every task read | The field rides along on the Prisma row; no `select` lists to extend (verify: `grep -n 'isMilestone: true' backend/src` — only the PATCH `current` select at `tasks.ts:158`, which does not need it). |
| Permission | `task:write`, same as every other task patch. Visibility unchanged. |

Frontend types (`lib/queries.ts`): `Task.isCriticalPath: boolean` (`:135`), `UpdateTaskInput.isCriticalPath?: boolean` (`:837`), `CreateTaskInput.isCriticalPath?: boolean` (`:1019`). `useUpdateTask`'s optimistic patch spreads the input for a single-field patch (the panel toggle, the row menu), so the ring flips before the round trip with no hook change. A patch that also changes `status`, `parentTaskId` or `sectionId` takes the reorder branch (`queries.ts:894-912`) and shows the flag after the refetch — the same as title or priority today.

## 5. Tasks

### T1 — Backend field (S) — spine: `schema.prisma` + migration, `routes/tasks.ts`, `routes/projects.ts`
- `schema.prisma`: `isCriticalPath Boolean @default(false) @map("is_critical_path")` under `isMilestone`, with a two-line comment (manual flag; computed path stays deferred).
- Migration: `docker compose exec -it backend npx prisma migrate dev --name task_is_critical_path` (backend/CLAUDE.md trap: `-it`, or the `migrate diff --script` fallback).
- Routes per §4.
- `backend/test/taskCriticalPath.test.ts` (pattern: `test/projectDelete.test.ts`): create defaults to `false`; create with `true`; PATCH `true` → `false` → `true`; a milestone accepts the mark; a subtask accepts the mark; `"yes"` → 400; the field appears in `GET /projects/:id/tasks`.
- Test DB: `solvro_t1_test`.
- Accept: backend `tsc --noEmit` clean; the new test file green; existing `taskOrdering.test.ts` and `tasksOverdue.test.ts` green.

### T2 — Types, mark component, non-Gantt surfaces (M) — spine: `lib/queries.ts`
- `queries.ts` types per §4. `CriticalPathMark.tsx` per §3. TaskPanel, TaskFormModal, Kanban card, Timeline card, List row per §3 table.
- `kanban-v2/adapter.test.ts` / `commitMapper.test.ts` fixtures gain the field only if the `Task` type makes them fail typecheck (they build `Task` literals).
- Accept: frontend `typecheck` clean; `adapter.test.ts`, `commitMapper.test.ts` green; the panel toggle round-trips against the T1 backend; chip text is exactly "Critical Path"; `PriorityBadge`/`StatusChip`/`LabelChip` untouched.

### T3 — Gantt + exports (M) — spine: `gantt-v2/`, exports
- SolvroBar (bar + milestone), SolvroGantt (name cell, row menu, key), `geometry.ts`, `exportPdf.ts`, `exportExcel.ts` per §3 table.
- `exportPdf.test.ts`: two cases — (a) with one marked task, the table has the "Critical Path" column, the marked row carries "Yes", an unmarked row carries ""; (b) with no marked task, the table has no "Critical Path" column (header list unchanged).
- No edits inside `reui/gantt/`. If one becomes unavoidable, mark it `// SOLVRO PATCH` and say so in the report.
- Accept: frontend `typecheck` clean; `exportPdf.test.ts`, `palette.test.ts` green; ring visible in all three Color-by modes in both themes; `[data-critical-path]` present on marked bars and milestones, absent on rollups.

### T4 — E2E (S)
- `e2e/fixtures/seed.ts:162`: `CreateTaskInput.isCriticalPath?: boolean`.
- `e2e/tests/critical-path.spec.ts` (pattern: `gantt-parity.spec.ts` — own tasks via API, dates via `isoDateOffset`): (1) a task created with `isCriticalPath: true` renders a bar with `[data-critical-path]`; a sibling without the flag renders none. (2) Open the task panel, click the `Critical Path: Yes` toggle → the bar loses `[data-critical-path]`; click `Critical Path: No` → it returns. (3) Kanban: the marked task's card shows the text "Critical Path"; the unmarked card does not.
- Desktop project only for (1) and (2) (the Gantt is desktop-only); (3) runs on both.
- Accept: the spec is green on the integrated branch; `gantt-parity.spec.ts` and `kanban-dnd.spec.ts` still green.

## 6. Waves

| Wave | Tasks | Notes |
|---|---|---|
| 1 | T1 ∥ T2 | No file overlap. T2 types the field before T1's API returns it — the field is `boolean`, default `false`, so a stale backend only renders "No". |
| 2 | T3 ∥ T4 | T3 reads T2's types. T4 is written against the §3 DOM contract and runs at integration. |

Gates: one full `gates.sh` run at each wave integration and at phase close (orchestrator-owned, serial). Instant opus reviews: T1, T2, T3 (spine). T4 waits for the phase review. One phase review on the combined diff.

## 7. CHANGELOG entry (draft, `[Unreleased]`, `### Added — 2026-09-XX — Critical Path mark on tasks`)

> **`backend/prisma/schema.prisma`**, migration `task_is_critical_path` — `Task.isCriticalPath` (`is_critical_path`, boolean, default false): a manual flag set by the TAM meaning "if this task slips, the project end date slips". Independent of priority; not computed from dependencies (the computed critical path stays deferred). **`backend/src/routes/projects.ts`**, **`backend/src/routes/tasks.ts`** — the create and update schemas accept `isCriticalPath`; `task:write` as for every task field. **`frontend/src/components/CriticalPathMark.tsx`** — one component, chip and glyph forms: the `chip-violet` pair with the `conversion_path` glyph and the text "Critical Path". Shown on the Kanban card, the Timeline card, the List row, and the Gantt tree; the Gantt bar carries a 2px violet inset ring (milestone: a violet diamond outline) that survives every Color-by mode; the Color-by key names it. Edited from the task panel ("Critical Path" row, Yes/No), the task form (checkbox), and the Gantt row menu ("Mark as Critical Path"). **`frontend/src/lib/gantt/exportPdf.ts`**, **`exportExcel.ts`** — the mark reaches the customer-facing exports: a violet stroke on the PDF bar and a "Critical Path" column in both the PDF table and the Excel Tasks sheet; the Excel Gantt sheet frames marked bars top and bottom. A project with no marked task exports exactly as before — the column appears only when at least one exported task carries the mark. **`backend/test/taskCriticalPath.test.ts`**, **`e2e/tests/critical-path.spec.ts`**. Why: TAMs know which tasks gate the end date without modelling every dependency; a one-click mark matches the data they enter.

## 8. Docs-keeper triggers (fire at phase close)

- `CLAUDE.md` Guardrails names `frontend/src/lib/export/` — that directory does not exist; the exports live in `frontend/src/lib/gantt/exportPdf.ts` / `exportExcel.ts`. Docs-keeper proposes the path fix (Guardrails are user-owned).
- `CLAUDE.md` standing decision "Critical-path highlighting: deferred" — docs-keeper proposes: "Computed critical path (from dependencies): deferred. The manual Critical Path mark shipped 2026-09." User applies.
- `docs/ISSUES.md:223` — the deferred entry gains the same clarification.
- `docs/DESIGN.md` §1 chip note — violet now carries a second meaning (Alert "info" + Critical Path). One line; no token change.
- When the phase ships: this file moves to `docs/archive/plans/`.

## 9. Open items

None blocking. Defaults taken: field name `isCriticalPath`; violet tone; `conversion_path` glyph (fallback `route`); no filter this phase.
