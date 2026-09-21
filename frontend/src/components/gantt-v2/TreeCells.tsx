import { useState } from "react";
import { InlineDateRangeEditor } from "@/components/InlineDateRangeEditor";
import { TaskStatusChip } from "@/components/StatusChip";
import { dayFromIso, dayToDate } from "@/lib/dateField";
import { fmtDateRangeDDMM } from "@/lib/gantt/geometry";
import { SECTION_COLOR_PRESETS } from "@/lib/gantt/palette";
import type { Task, TaskStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";

// Ported mounting for the tree-pane inline editors that used to live in the
// old engine's GanttListRow.tsx (~:258 dates popover, ~:164-193 section color
// popover). The editor bodies themselves are reused as-is — InlineDateRangeEditor
// is already a standalone shared component (frontend/src/components/), so it's
// imported directly rather than copied; only the section color-picker popover
// (previously inline JSX in GanttListRow) is reproduced here, verbatim in
// structure/classNames, as its own small component so it can mount via a
// ReUI GanttColumn render prop instead of a bespoke list row.

// A task date's calendar day is the UTC
// date-part of its stored ISO instant (see `@/lib/dateField`'s module doc).
// `dayFromIso` derives that day via the UTC slice; `dayToDate` hands back the
// LOCAL-midnight Date `fmtDateRangeDDMM` expects — never a raw local-time
// `new Date(iso)` parse of the ISO instant.
const isoToDate = (iso: string | null): Date | null => dayToDate(dayFromIso(iso));

interface TaskDatesCellProps {
  task: Task;
  canEdit: boolean;
  onSave: (taskId: number, startISO: string | null, dueISO: string | null) => void;
  todayDay: string | null;
}

/**
 * Tree-pane "Dates" column cell for task rows: the editable start–due range.
 * Also carries the overdue treatment (red + `font-semibold` + an `sr-only`
 * "(overdue)" cue — never color alone, per the a11y precedent in
 * `pages/views/ProjectTimeline.tsx`): a briefly-shipped separate "Due"
 * column was removed 2026-08-03 as redundant with this range. `todayDay`
 * is hoisted by the caller (once per render, not per row).
 */
export function TaskDatesCell({ task, canEdit, onSave, todayDay }: TaskDatesCellProps) {
  const [editing, setEditing] = useState(false);
  const overdue = isTaskOverdue(task.status, task.dueDate, todayDay);
  return (
    <div className="relative flex w-full min-w-0 items-center justify-end">
      <button
        type="button"
        disabled={!canEdit}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className={cn(
          "w-full truncate text-right font-mono text-[11px]",
          overdue ? "font-semibold text-error" : "text-on-surface-variant",
          // Overdue red must survive hover — hover:text-primary would flip
          // the signal to green exactly while the TAM points at it.
          canEdit ? (overdue ? "hover:text-error/80" : "hover:text-primary") : "cursor-default",
        )}
        title={canEdit ? "Click to edit dates" : undefined}
      >
        {fmtDateRangeDDMM(isoToDate(task.startDate), isoToDate(task.dueDate))}
        {overdue && <span className="sr-only"> (overdue)</span>}
      </button>
      {editing && canEdit && (
        <InlineDateRangeEditor
          className="absolute right-0 top-full z-50 mt-1"
          startISO={task.startDate}
          endISO={task.dueDate}
          onSave={(s, e) => {
            onSave(task.id, s, e);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

interface SectionColorCellProps {
  sectionId: number;
  color: string;
  canEdit: boolean;
  onPick: (sectionId: number, color: string) => void;
}

/** Tree-pane color-swatch column cell for section group rows (GanttListRow.tsx:151-194 parity). */
export function SectionColorCell({ sectionId, color, canEdit, onPick }: SectionColorCellProps) {
  const [picking, setPicking] = useState(false);
  return (
    <span className="relative flex shrink-0 items-center">
      <button
        type="button"
        disabled={!canEdit}
        onClick={(e) => {
          e.stopPropagation();
          setPicking((v) => !v);
        }}
        className="h-2 w-2 rounded-full disabled:cursor-default"
        style={{ backgroundColor: color }}
        aria-label="Set section color"
        title={canEdit ? "Set section color" : undefined}
      />
      {picking && canEdit && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={(e) => {
              e.stopPropagation();
              setPicking(false);
            }}
            aria-label="Close color picker"
          />
          {/* Floating popover — sanctioned overlay shadow-sm token (DESIGN.md exception) */}
          <div className="absolute left-0 top-4 z-50 flex gap-1 rounded-sm border border-outline-variant bg-surface-container-lowest p-1.5 shadow-overlay">
            {SECTION_COLOR_PRESETS.map((hex) => (
              <button
                key={hex}
                type="button"
                className="h-4 w-4 rounded-full hover:ring-2 hover:ring-primary"
                style={{ backgroundColor: hex }}
                onClick={(e) => {
                  e.stopPropagation();
                  onPick(sectionId, hex);
                  setPicking(false);
                }}
                aria-label={`Section color ${hex}`}
              />
            ))}
          </div>
        </>
      )}
    </span>
  );
}

// Height-style tree columns — status dot + Status chip cells (a separate
// Due-date cell shipped briefly and was removed 2026-08-03; the Dates cell
// above carries the overdue treatment). Same taskById-lookup pattern:
// the resource node itself carries no status/dueDate (adapter.ts's
// buildResources is deliberately domain-agnostic — see adapter.ts's
// GanttResource usage), so every cell here receives the full looked-up
// `Task`, not the bare resource.

// Matches the existing status-indicator dot precedent verbatim —
// ProjectTimeline.tsx's `STATUS_INDICATOR_CLASS` (its Timeline tab's node
// dots), which itself is doc-commented there as "theme-aware (mint in dark,
// green in light) like the rest of the chip family" for DONE. Reusing the
// same fill tokens keeps every TaskStatus dot in the app visually
// consistent: TODO a neutral surface tone (not text-on-surface-variant —
// that reads as active/muted text, not an "idle" indicator), IN_PROGRESS
// Elitery-green "blue" (per docs/DESIGN.md: green-tinted, not literal
// blue — same primary token TaskStatusChip's "blue" tone renders), DONE
// emerald.
const STATUS_DOT_TONE_CLASS: Record<TaskStatus, string> = {
  TODO: "bg-surface-container-highest",
  IN_PROGRESS: "bg-primary",
  DONE: "bg-chip-emerald-text",
};

/** Small colored status dot rendered before a task's name (SolvroGantt.tsx's
 * `renderResourceLabel`). Task rows (incl. subtasks) only — the caller skips
 * this for section/pseudo-group rows. */
export function TaskStatusDot({ status }: { status: TaskStatus }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "me-1.5 inline-block size-2 shrink-0 rounded-full",
        STATUS_DOT_TONE_CLASS[status],
      )}
    />
  );
}

/** Tree-pane "Status" column cell for task rows — reuses the bespoke
 * `TaskStatusChip` verbatim (CLAUDE.md guardrail: never rebuild it). The
 * column itself renders at a FIXED width (gantt-view.tsx's tree-column-cell
 * wrapper is `shrink-0` — a narrower pane makes the row scroll horizontally,
 * it never shrinks the column), so this wrapper isn't about the pane
 * narrowing: `whitespace-nowrap` + `overflow-hidden` is defense against the
 * chip's own label text (e.g. a future longer locale string) exceeding the
 * column's fixed width — it clips to one line cleanly instead of wrapping
 * the row taller. */
export function TaskStatusCell({ task }: { task: Task }) {
  return (
    <div className="min-w-0 overflow-hidden whitespace-nowrap">
      <TaskStatusChip status={task.status} />
    </div>
  );
}

/**
 * Pure predicate backing the Dates column's `text-error` treatment —
 * exported so it's independently unit-testable (this repo's frontend test
 * convention is pure-function `.test.ts` files over pure logic, not
 * component-render tests — see `lib/gantt/palette.test.ts`,
 * `kanban-v2/adapter.test.ts` — so the predicate is split out from the JSX
 * cell below rather than tested through rendering).
 *
 * `status !== "DONE"` (open task) AND `dueDay` is strictly before
 * `todayDay`, compared as calendar days (never an ISO-instant compare —
 * frontend/CLAUDE.md's date contract) via `dayFromIso` — same pattern as
 * the established precedent in `pages/views/ProjectTimeline.tsx`'s
 * `TaskTimelineItem` (`task.status !== "DONE" && dayFromIso(task.dueDate)! <
 * todayDay!`). Plain string comparison is correct for `"yyyy-MM-dd"` —
 * lexicographic order matches calendar order (same rule `lib/dateField.ts`'s
 * `normalizePair` relies on).
 */
export function isTaskOverdue(
  status: TaskStatus,
  dueDateIso: string | null,
  todayDay: string | null,
): boolean {
  const dueDay = dayFromIso(dueDateIso);
  return status !== "DONE" && dueDay !== null && todayDay !== null && dueDay < todayDay;
}
