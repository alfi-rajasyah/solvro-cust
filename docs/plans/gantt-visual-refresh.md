# Gantt visual refresh — phase plan

**Date:** 2026-08-03 · **Status:** implementation complete on `feat/gantt-visual-refresh` (T1–T6 + phase review closed; toolbar-sizing follow-up in flight), PR pending user approval · **Reference:** Height-style Gantt screenshot (chat, Image #4)

## Goal

Close the visual gap between the Solvro Gantt and the reference: toolbar navigation, richer tree columns, cleaner bar treatment, floating zoom, per-row menu. The timeline header (week band, day cells, weekend hatch, today pill) already matches — untouched.

## Non-goals (user-confirmed)

- No assignee column, no avatar stacks (solo-TAM tool).
- No reference palette (purple/teal) — chips keep `TaskStatusChip` tones; bars keep `lib/gantt/palette.ts`.
- No "+" add-column affordance.
- No new npm dependencies, no new design tokens.

## Tasks

### T1 — Toolbar navigation (S)
Mount prev/next arrows + visible period title. Source: the vendored, currently-unmounted `reui/gantt/gantt-nav.tsx`; restyle to DESIGN tokens (no shadows, primary focus ring).
- Files: `gantt-v2/SolvroGantt.tsx`, possibly `reui/gantt/gantt-nav.tsx` (`// SOLVRO PATCH` markers on any hand edit).
- Accept: prev/next step by the visible unit; title shows the visible period; Today still works; controls keyboard-focusable.

### T2 — Tree columns (M)
Status dot in the name cell; a `TaskStatusChip` column; a due-date column whose text goes `text-error` when the task is open and past due (calendar-day compare via `lib/dateField.ts` — never ISO instants).
- Files: `gantt-v2/SolvroGantt.tsx` (columns), `gantt-v2/TreeCells.tsx`, `gantt-v2/adapter.ts` if the column needs mapped data.
- Accept: columns render for tasks, stay blank on section rows; splitter min/default widths still fit; existing Dates inline editor and color picker unchanged.

### T3 — Bar treatment (M)
Remaining (incomplete) bar portion renders as a diagonal hatch of the bar color instead of the flat black 28% overlay. Section rollup pill becomes a thin summary bar with square end caps (reference style), keeping the section color.
- Files: `gantt-v2/SolvroBar.tsx`, `lib/gantt/palette.ts` (hatch alpha), `gantt-v2/adapter.ts` (rollup event) if needed.
- Accept: DONE bars solid; 0% bars fully hatched; milestone diamond and label-fit logic unchanged; PDF/Excel exports unchanged (exports draw their own shapes).

### T4 — Floating zoom (S, orchestrator-direct)
Enable the engine's zoom widget: drop `zoomControl={false}`, set `zoomRange`; verify pan/scroll and exports.
- Files: `gantt-v2/SolvroGantt.tsx`.
- Accept: +/− widget bottom-right; scale pills still work; export output identical.

### T5 — Per-row "…" menu (S)
Wire the engine's `renderResourceMenu`: Edit, Add subtask, Delete (Delete behind `ConfirmModal`, `canEdit`-gated).
- Files: `gantt-v2/SolvroGantt.tsx`.
- Accept: menu on task rows only; actions reuse existing modals/mutations; no menu for read-only users.

### T6 — Toolbar control restyle (S, added 2026-08-03 by user)
Unify the remaining toolbar controls with the Day/Week/Month/Quarter segmented pill group's visual style: grouped segmented containers instead of individually outlined buttons. Groups: [+ Task | + Section], [Today | ‹ | › | period title], [Baseline | Reset baseline], [Color by], [Export]. Text elements (counter, legend, title) stay text.
- Files: `gantt-v2/SolvroGantt.tsx` (toolbar region only).
- Accept: every control keeps its behavior, focus ring, and aria semantics; the export-menu e2e assertion (gantt-parity (h)) still passes; visual grouping mirrors the scale pill group's container/active treatment.
- Serialized after T5's fix round (same file region).

## Waves

- Wave 1: T1 ∥ T3 (disjoint files except trivial `SolvroGantt.tsx` prop lines).
- Wave 2: T2 ∥ T5 (both edit `SolvroGantt.tsx` — worktree isolation or serialize if conflicts bite).
- T4: orchestrator-direct, folded into a wave-2 gates run.

## Review & gates

Every task touches `gantt-v2/` (spine) → instant opus review per task, `gates.sh --performed-review=opus` at each wave integration. Vendored `reui/gantt/` edits need `// SOLVRO PATCH` markers. One phase review before the PR. CHANGELOG entries reported by implementors, appended serially at integration.
