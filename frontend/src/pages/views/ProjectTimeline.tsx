import { useMemo, useState } from "react";
import { useProjectContext } from "../ProjectDetail";
import { AssigneeAvatar } from "@/components/AssigneeAvatar";
import { CriticalPathMark } from "@/components/CriticalPathMark";
import { EmptyState } from "@/components/EmptyState";
import { LabelChip } from "@/components/LabelChip";
import { PriorityBadge } from "@/components/PriorityBadge";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Timeline, TimelineIndicator, TimelineItem, TimelineSeparator } from "@/components/reui/timeline";
import { StatusSelect } from "@/components/StatusSelect";
import { TaskStatusChip } from "@/components/StatusChip";
import { TaskFormModal } from "@/components/TaskFormModal";
import { hasPermission, useAuth } from "@/lib/auth";
import { dateToDay, dayFromIso } from "@/lib/dateField";
import { fmtRange } from "@/lib/formatDate";
import {
  type Priority,
  type Task,
  type TaskStatus,
  useProjectEpics,
  useProjectTasks,
  useUpdateTask,
} from "@/lib/queries";
import { buildFilterContext, clearPatch, countActiveFilters, scopeFilters, taskVisible } from "@/lib/taskFilters";
import { TaskFilterPopover } from "@/components/TaskFilterPopover";
import { useTaskFilters } from "@/hooks/useTaskFilters";
import { TOOLBAR_BOX } from "@/lib/utils";

const PRIORITY_ORDER: Record<Priority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

// SOLVRO PATCH: status -> TimelineIndicator color, transplanted verbatim from the
// hand-rolled dot markers this file used to render (DONE emerald, IN_PROGRESS
// primary, TODO neutral). Border stays the surface-container-lowest "cutout"
// ring on every status, matching the previous dot's border.
// SOLVRO PATCH (fix round): DONE now points at the chip-emerald semantic
// token (index.css's `@theme inline` bridge) instead of the raw Tailwind
// palette color it carried over from the old hand-rolled dot — this makes
// the DONE indicator theme-aware (mint in dark, green in light) like the
// rest of the chip family, rather than a fixed palette shade.
const STATUS_INDICATOR_CLASS: Record<TaskStatus, string> = {
  DONE: "border-surface-container-lowest bg-chip-emerald-text",
  IN_PROGRESS: "border-surface-container-lowest bg-primary",
  TODO: "border-surface-container-lowest bg-surface-container-highest",
};

export function ProjectTimeline() {
  const { project } = useProjectContext();
  const { user } = useAuth();
  const { data: tasks, isLoading, isError, error } = useProjectTasks(project.id);
  const { data: epics } = useProjectEpics(project.id);
  const updateTask = useUpdateTask(project.id);
  // The epic filter lives in the URL (hooks/useTaskFilters.ts) and is shared
  // with List, Kanban and Gantt; the Timeline applies only its epic part.
  const { filters: urlFilters, setFilters } = useTaskFilters();
  const filters = useMemo(() => scopeFilters(urlFilters, "epic"), [urlFilters]);
  const filterCount = countActiveFilters(filters);
  const [editTask, setEditTask] = useState<Task | null>(null);

  const canEdit = hasPermission(user, "task:write");

  // Hoisted once per render of the list rather than once per TimelineItem —
  // the day string is identical for every item in a single render pass.
  const todayDay = dateToDay(startOfToday());

  const ordered = useMemo(() => {
    if (!tasks) return [];
    const ctx = buildFilterContext(tasks);
    const topLevel = tasks.filter((t) => t.parentTaskId === null && taskVisible(t, filters, ctx));
    return [...topLevel].sort((a, b) => {
      const aStart = a.startDate ? new Date(a.startDate).getTime() : Number.POSITIVE_INFINITY;
      const bStart = b.startDate ? new Date(b.startDate).getTime() : Number.POSITIVE_INFINITY;
      if (aStart !== bStart) return aStart - bStart;
      const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      const ap = PRIORITY_ORDER[a.priority];
      const bp = PRIORITY_ORDER[b.priority];
      if (ap !== bp) return ap - bp;
      return a.id - b.id;
    });
  }, [tasks, filters]);

  const subtasksOf = useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const t of tasks ?? []) {
      if (t.parentTaskId !== null) {
        const arr = map.get(t.parentTaskId) ?? [];
        arr.push(t);
        map.set(t.parentTaskId, arr);
      }
    }
    return map;
  }, [tasks]);

  if (isLoading) {
    return (
      <div className="h-64 animate-pulse rounded-sm border border-outline-variant bg-surface-container-low" />
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load tasks: {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  if (ordered.length === 0 && filterCount === 0) {
    return <EmptyState icon="checklist" message="No tasks yet. Add tasks from the Kanban board." />;
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-end">
        <TaskFilterPopover
          filters={filters}
          onChange={setFilters}
          onClear={() => setFilters(clearPatch("epic"))}
          activeCount={filterCount}
          epics={epics ?? []}
          triggerClassName={(active) =>
            [
              `${TOOLBAR_BOX} tap-target border font-semibold transition-colors`,
              active
                ? "border-primary bg-primary/10 text-primary-tint-text"
                : "border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container",
            ].join(" ")
          }
        />
      </div>
      {ordered.length === 0 && (
        <p className="py-6 text-center text-sm text-on-surface-variant">No tasks match the current filters.</p>
      )}
      <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
        {/* SOLVRO PATCH: `value={-1}` neutralizes ReUI Timeline's step/active-state
            concept. This view has no "current step" — every TaskTimelineItem's
            `step` is a 0-based index (>= 0), so `step <= activeStep` never holds
            and no item ever receives the vendored component's `data-completed`
            active styling (which would otherwise ring one indicator in primary
            and tint the separator before it). */}
        {/* SOLVRO PATCH (fix round): `role="list"`/`role="listitem"` restore the
            list semantics the old `<ol>`/`<li>` gave screen readers — the
            vendored primitives render plain `<div>`s. */}
        <Timeline value={-1} role="list">
          {ordered.map((task, index) => (
            <TaskTimelineItem
              key={task.id}
              step={index}
              task={task}
              subtasks={subtasksOf.get(task.id) ?? []}
              canEdit={canEdit}
              todayDay={todayDay}
              onChangeStatus={(statusId) => updateTask.mutate({ id: task.id, patch: { statusId } })}
              onEdit={() => setEditTask(task)}
            />
          ))}
        </Timeline>
      </div>

      {editTask && (
        <TaskFormModal
          mode="edit"
          open={editTask !== null}
          onClose={() => setEditTask(null)}
          projectId={project.id}
          task={editTask}
        />
      )}
    </>
  );
}

function TaskTimelineItem({
  step,
  task,
  subtasks,
  canEdit,
  todayDay,
  onChangeStatus,
  onEdit,
}: {
  step: number;
  task: Task;
  subtasks: Task[];
  canEdit: boolean;
  todayDay: string | null;
  onChangeStatus: (statusId: number) => void;
  onEdit: () => void;
}) {
  // Compare calendar days, not instants —
  // lexicographic "yyyy-MM-dd" comparison is calendar-correct (dateField.ts).
  // `todayDay` is hoisted by the caller (once per render, not once per item).
  const overdue = task.dueDate && task.status !== "DONE" && dayFromIso(task.dueDate)! < todayDay!;

  return (
    <TimelineItem
      step={step}
      role="listitem"
      // SOLVRO PATCH (fix round): tighten the vendored default's inter-item
      // gap (`not-last:pb-6`, 24px) back to the old hand-rolled `mb-4` (16px).
      // Must repeat the exact same variant prefix as the base class or
      // tailwind-merge won't recognize the conflict and both survive.
      className="group-data-[orientation=vertical]/timeline:not-last:pb-4"
    >
      {/* SOLVRO PATCH: neutral spine color (matches the previous hand-rolled
          `border-outline-variant` line) instead of the vendored default's
          primary-tinted separator — status color lives on the indicator only. */}
      <TimelineSeparator className="bg-outline-variant" />
      <TimelineIndicator className={STATUS_INDICATOR_CLASS[task.status]} />
      <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4 transition-colors hover:border-primary/40">
        <div className="mb-1 flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusChip status={task.status} def={task.statusDef} />
            <PriorityBadge priority={task.priority} compact />
            {task.isCriticalPath && <CriticalPathMark variant="chip" />}
            {task.labels.slice(0, 4).map((l) => (
              <LabelChip key={l.id} label={l} compact />
            ))}
          </div>
          <span
            className={`text-meta ${overdue ? "font-bold text-error" : "text-on-surface-variant"}`}
          >
            {fmtRange(task.startDate, task.dueDate)}
            {overdue && " · OVERDUE"}
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={onEdit}
            className="[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 block text-left text-sm font-medium text-on-surface hover:text-primary"
          >
            {task.title}
          </button>
          <AssigneeAvatar user={task.assignedTo} size="xs" />
        </div>
        {task.description && (
          // Prose-overflow sweep (GH #57 convention, docs/archive/ISSUES-2026-11-18-phase-log.md deferred
          // finding): this cell had neither wrap-hardening nor a clamp — a
          // long unbroken description could stretch the timeline card.
          // `whitespace-pre-wrap` preserves operator-entered line breaks;
          // `wrap-break-word` is Tailwind v4's renamed `break-words` (see
          // TaskPanel.tsx's identical comment-body treatment).
          <p className="mt-1 whitespace-pre-wrap wrap-break-word text-meta text-on-surface-variant">
            {task.description}
          </p>
        )}
        {subtasks.length > 0 && (
          <ul className="mt-2 space-y-0.5 border-l border-outline-variant pl-3">
            {subtasks.map((s) => (
              <li
                key={s.id}
                className={`text-meta ${s.status === "DONE" ? "text-on-surface-variant line-through" : "text-on-surface"}`}
              >
                {s.status === "DONE" ? "✓" : "·"} {s.title}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="mt-3 flex items-center gap-1">
            <StatusSelect
              value={task.statusId}
              fallback={task.statusDef}
              onChange={(def) => onChangeStatus(def.id)}
              ariaLabel={`Change status of ${task.title}`}
            />
          </div>
        )}
      </div>
    </TimelineItem>
  );
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
