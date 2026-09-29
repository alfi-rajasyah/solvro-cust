import type { Section, Task } from "@/lib/queries";
import { dateToDay } from "@/lib/dateField";
import { fmtDay, fmtRange } from "@/lib/formatDate";
import { DEFAULT_SECTION_COLOR, resolveSectionColors } from "@/lib/gantt/palette";

export type RowKind = "section" | "task" | "subtask";

export interface Row {
  id: string;
  kind: RowKind;
  depth: 0 | 1 | 2;
  name: string;
  start: Date | null;
  end: Date | null;
  parentRowId: string | null;
  taskId?: number;
  sectionId: number | null;
  /** Hex color for this row's section band / bar fill. Neutral default when unset. */
  sectionColor?: string;
  collapsed?: boolean;
  /** Task rows with subtask children get an expand/collapse chevron. */
  hasChildren?: boolean;
  task?: Task;
  status?: Task["status"];
  priority?: Task["priority"];
  /** Mirrors Task.isMilestone (explicit flag). */
  isMilestone?: boolean;
  /** Mirrors Task.isCriticalPath — the manual Critical Path mark (plan critical-path-mark.md §3). */
  isCriticalPath?: boolean;
  /** 0-100. DONE tasks are 100; parents with subtasks use done/total; else 0. */
  progressPct?: number;
}

const DAY_MS = 1000 * 60 * 60 * 24;

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("T")[0].split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function isoWeekNumber(d: Date): number {
  const target = startOfDay(d);
  target.setDate(target.getDate() + 4 - (target.getDay() || 7));
  const yearStart = new Date(target.getFullYear(), 0, 1);
  return Math.ceil(((target.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

/** Tree-pane day label (`21 Aug`) — delegates to the shared formatter. */
export function fmtDateDDMM(d: Date): string {
  return fmtDay(dateToDay(d));
}

/** Tree-pane range label (`22 – 28 Aug`, `21 Aug`, `From 21 Aug`, `No dates`). */
export function fmtDateRangeDDMM(start: Date | null, end: Date | null): string {
  return fmtRange(dateToDay(start), dateToDay(end));
}

interface BuildRowsOpts {
  tasks: Task[];
  sections: Section[];
  collapsed: Set<string>;
}

/**
 * Progress for a single task row: DONE tasks are always 100%. A task with
 * subtasks reports done/total across its direct children. A task with no
 * subtasks and not DONE reports 0%.
 */
export function progressForTask(task: Task, childrenById: Map<number, Task[]>): number {
  if (task.status === "DONE") return 100;
  const children = childrenById.get(task.id) ?? [];
  if (children.length === 0) return 0;
  const done = children.filter((c) => c.status === "DONE").length;
  return Math.round((done / children.length) * 100);
}

function isMilestoneTask(task: Task): boolean {
  // Explicit flag (Task.isMilestone) — the old same-day/due-only derivation
  // now lives only in the one-time DB backfill.
  return task.isMilestone;
}

export function buildRows({ tasks, sections, collapsed }: BuildRowsOpts): Row[] {
  if (tasks.length === 0 && sections.length === 0) return [];

  const rows: Row[] = [];
  const bySection = new Map<number | "none", Task[]>();
  for (const t of tasks) {
    const key = t.sectionId ?? "none";
    const arr = bySection.get(key) ?? [];
    arr.push(t);
    bySection.set(key, arr);
  }

  // Global (project-wide) parent -> children map, so subtask progress roll-up
  // is correct even if a parent and child end up in different section groups
  // (shouldn't normally happen, but stay defensive).
  const childrenById = new Map<number, Task[]>();
  for (const t of tasks) {
    if (t.parentTaskId !== null) {
      const arr = childrenById.get(t.parentTaskId) ?? [];
      arr.push(t);
      childrenById.set(t.parentTaskId, arr);
    }
  }

  const sortedSections = [...sections].sort(
    (a, b) => a.position - b.position || a.id - b.id,
  );
  // Section-color fallback resolution lives in palette.ts
  // (resolveSectionColors) — single source shared with the toolbar legend.
  const colorBySection = resolveSectionColors(sortedSections);

  function rangeFor(group: Task[]): { start: Date | null; end: Date | null } {
    const stamps = group
      .flatMap((t) => [t.startDate, t.dueDate])
      .filter((d): d is string => Boolean(d))
      .map((d) => parseISODate(d).getTime());
    if (stamps.length === 0) return { start: null, end: null };
    return {
      start: new Date(Math.min(...stamps)),
      end: new Date(Math.max(...stamps)),
    };
  }

  function pushGroup(rowId: string, sectionId: number | null, name: string, group: Task[]) {
    const { start, end } = rangeFor(group);
    const isCollapsed = collapsed.has(rowId);
    const sectionColor = sectionId !== null
      ? colorBySection.get(sectionId) ?? DEFAULT_SECTION_COLOR
      : DEFAULT_SECTION_COLOR;
    rows.push({
      id: rowId,
      kind: "section",
      depth: 0,
      name,
      start,
      end,
      parentRowId: null,
      sectionId,
      sectionColor,
      collapsed: isCollapsed,
    });
    if (isCollapsed || group.length === 0) return;

    // Non-milestone due-only tasks still need a drawable range — anchor a
    // 1-day bar on the due date. (GanttBar returns null for non-milestones
    // missing either endpoint.)
    function taskDates(t: Task): { start: Date | null; end: Date | null } {
      return {
        start: t.startDate
          ? parseISODate(t.startDate)
          : !isMilestoneTask(t) && t.dueDate
            ? parseISODate(t.dueDate)
            : null,
        end: t.dueDate ? parseISODate(t.dueDate) : null,
      };
    }

    // Subtasks render nested under their parent (never as flat section
    // members), grouped by the PARENT's section even when their own
    // sectionId diverged — the hierarchy wins over section membership.
    const parents = group.filter((t) => t.parentTaskId === null);
    for (const p of parents) {
      const parentRowIdStr = `task-${p.id}`;
      const children = childrenById.get(p.id) ?? [];
      const parentCollapsed = collapsed.has(parentRowIdStr);
      rows.push({
        id: parentRowIdStr,
        kind: "task",
        depth: 1,
        name: p.title,
        ...taskDates(p),
        parentRowId: rowId,
        taskId: p.id,
        sectionId,
        sectionColor,
        task: p,
        status: p.status,
        priority: p.priority,
        isMilestone: isMilestoneTask(p),
        isCriticalPath: p.isCriticalPath,
        progressPct: progressForTask(p, childrenById),
        hasChildren: children.length > 0,
        collapsed: parentCollapsed,
      });
      if (parentCollapsed) continue;
      // Only direct children render (depth caps at 2); deeper nesting rolls
      // up into each subtask's own progressPct.
      for (const c of children) {
        rows.push({
          id: `task-${c.id}`,
          kind: "subtask",
          depth: 2,
          name: c.title,
          ...taskDates(c),
          parentRowId: parentRowIdStr,
          taskId: c.id,
          sectionId,
          sectionColor,
          task: c,
          status: c.status,
          priority: c.priority,
          isMilestone: isMilestoneTask(c),
          isCriticalPath: c.isCriticalPath,
          progressPct: progressForTask(c, childrenById),
        });
      }
    }
  }

  for (const s of sortedSections) {
    pushGroup(`sec-${s.id}`, s.id, s.name, bySection.get(s.id) ?? []);
  }
  // Only emit "(No section)" when it holds top-level tasks. Subtasks with a
  // null sectionId render nested under their parent (hierarchy wins over
  // section membership), so a subtask-only bucket would produce an empty
  // stray section header.
  if ((bySection.get("none") ?? []).some((t) => t.parentTaskId === null)) {
    pushGroup("sec-none", null, "(No section)", bySection.get("none") ?? []);
  }
  return rows;
}

export function rowsDateRange(rows: Row[]): { min: Date; max: Date } | null {
  const stamps: number[] = [];
  for (const r of rows) {
    if (r.start) stamps.push(r.start.getTime());
    if (r.end) stamps.push(r.end.getTime());
  }
  if (stamps.length === 0) return null;
  return { min: new Date(Math.min(...stamps)), max: new Date(Math.max(...stamps)) };
}
