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
 * Project-wide parent → children map, used by progressForTask to roll up
 * subtask completion onto a parent task's bar. Built once per buildEvents
 * call and threaded through explicitly (no module-level mutable cache —
 * buildEvents must stay safely re-entrant/concurrent-render-safe).
 */
function buildChildrenById(tasks: Task[]): Map<number, Task[]> {
  const childrenById = new Map<number, Task[]>();
  for (const t of tasks) {
    if (t.parentTaskId !== null) {
      const arr = childrenById.get(t.parentTaskId) ?? [];
      arr.push(t);
      childrenById.set(t.parentTaskId, arr);
    }
  }
  return childrenById;
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
  childrenById: Map<number, Task[]>,
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
    // A milestone is a point-in-time marker, not a duration bar — it has no
    // progress to show. Suppressing this at the source (rather than in
    // SolvroBar) kills ReUI's built-in progress-tint span at its own
    // `progress !== null` gate (gantt-bar.tsx:310-322), which otherwise
    // renders a translucent strip with no covering backdrop to hide it
    // behind (Plan B Task 4 review finding).
    progress: task.isMilestone ? undefined : progressForTask(task, childrenById),
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

export function buildEvents(
  tasks: Task[],
  sections: Section[],
  mode: ColorByMode,
  canEdit: boolean,
): GanttEvent<Task>[] {
  const colors = resolveSectionColors(sections);
  const childrenById = buildChildrenById(tasks);
  return tasks
    .map((t) => taskToEvent(t, mode, colors, canEdit, childrenById))
    .filter((e): e is GanttEvent<Task> => e !== null);
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
