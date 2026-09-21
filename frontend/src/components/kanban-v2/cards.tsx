// Copied from the legacy frontend/src/pages/views/ProjectKanban.tsx (TaskCard
// lines 874-1021, SubtaskRow lines 1057-1121, getDuration lines 1175-1182,
// pre-T11 cutover) per Architecture Decision 2 (docs/plans/kanban-reui-swap/
// plan.md): copy, don't extract. The legacy file is gone as of T11 cutover
// (git history preserves it) — this duplication is now permanent, not
// temporary.
//
// Stripped relative to the original: the old dnd-kit dragHandleProps/
// dragHandleRef plumbing (passed down from the container) is gone — T7 wires
// the grip as the real drag activator via the vendored engine's
// `KanbanItemHandle`, whose `listeners` come from React context set up by
// the enclosing `<KanbanItem>` in SolvroKanban.tsx, preserving the old
// board's handle-only activation (the card body itself has no pointer-down
// listener). SubtaskRow additionally drops its drag handle entirely —
// subtask dragging is retired from the board for good (modal path at
// TaskFormModal.tsx), not just deferred; T8 restores its DONE/not-DONE
// toggle (`onToggleSubtask`) and TaskCard's mobile-only "more_horiz" menu
// button (opens MobileMoveSheet, wired in SolvroKanban.tsx).
import { AssigneeAvatar } from "@/components/AssigneeAvatar";
import { CriticalPathMark } from "@/components/CriticalPathMark";
import { LabelChip } from "@/components/LabelChip";
import { PriorityBadge } from "@/components/PriorityBadge";
import { KanbanItemHandle } from "@/components/reui/kanban";
import { dayFromIso, dayToDate } from "@/lib/dateField";
import { type Task } from "@/lib/queries";

export function TaskCard({
  task,
  subtaskMap,
  canDrag,
  canToggleSubtasks = false,
  dragging = false,
  onClick,
  onMenuClick,
  onToggleSubtask,
}: {
  task: Task;
  subtaskMap: Map<number, Task[]>;
  canDrag: boolean;
  canToggleSubtasks?: boolean;
  // M4 (Phase 2 review): restores the drag-overlay treatment
  // (ProjectKanban.tsx:917) — true only for the ghost card rendered inside
  // KanbanOverlay (SolvroKanban.tsx), never for a card in its normal column
  // position.
  dragging?: boolean;
  onClick?: () => void;
  onMenuClick?: () => void;
  onToggleSubtask?: (s: Task) => void;
}) {
  const subtasks = subtaskMap.get(task.id) ?? [];
  const subtasksDone = subtasks.filter((s) => s.status === "DONE").length;
  const duration = getDuration(task.startDate, task.dueDate);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    onClick?.();
  }

  return (
    <div
      onClick={handleClick}
      className={[
        "touch-manipulation rounded-sm border bg-surface-container-lowest p-3 transition-colors",
        dragging
          ? "rotate-[-1.2deg] border-[1.5px] border-primary shadow-overlay ring-2 ring-primary"
          : "border-outline-variant hover:border-primary",
      ].join(" ")}
    >
      {/* Title + duration + drag handle */}
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          {/* Real drag activator (T7): KanbanItemHandle attaches dnd-kit's
              pointer listeners (from the enclosing KanbanItem's context) only
              to this handle, not the card body — handle-only activation,
              matching the old board. `cursor` (default true) handles the
              grab/grabbing cursor swap itself via isDragging context. */}
          {canDrag && (
            <KanbanItemHandle
              aria-label="Drag to reorder"
              className="mt-0.5 inline-flex shrink-0 touch-none items-center text-on-surface-variant/60"
            >
              <span className="material-symbols-outlined text-[16px]">drag_indicator</span>
            </KanbanItemHandle>
          )}
          <p className="min-w-0 text-[15px] font-bold leading-tight text-on-surface">
            {task.status === "DONE" && (
              <span className="material-symbols-outlined mr-1 align-text-bottom text-[14px] text-primary">
                check_circle
              </span>
            )}
            {task.title}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1 text-[13px] text-on-surface-variant">
            <span className="material-symbols-outlined text-[15px]">schedule</span>
            <span className="whitespace-nowrap">{duration}</span>
          </div>
          {onMenuClick && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMenuClick();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="material-symbols-outlined text-[17px] text-on-surface-variant hover:text-on-surface md:hidden"
              aria-label="Card options"
            >
              more_horiz
            </button>
          )}
        </div>
      </div>

      {/* Labels */}
      {task.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {task.labels.slice(0, 2).map((l) => (
            <LabelChip key={l.id} label={l} compact />
          ))}
          {task.labels.length > 2 && (
            <span className="text-[11px] text-on-surface-variant">+{task.labels.length - 2}</span>
          )}
        </div>
      )}

      {/* Description */}
      {task.description && (
        <p className="mb-2 line-clamp-2 text-[13px] leading-snug text-on-surface-variant">
          {task.description}
        </p>
      )}

      {/* Inline subtask checklist — no drag surfaces (retired from the board);
          toggle only, DONE<->TODO (ProjectKanban.tsx:451-454). */}
      {subtasks.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 flex items-center gap-1 font-display text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
            <span className="material-symbols-outlined text-[12px]">check_circle</span>
            Subtasks {subtasksDone}/{subtasks.length}
          </div>
          <ul className="space-y-0.5 border-l border-outline-variant/60 pl-2">
            {subtasks.map((s) => (
              <li key={s.id}>
                <SubtaskRow
                  task={s}
                  canToggle={canToggleSubtasks}
                  onToggle={() => onToggleSubtask?.(s)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bottom row: comments + priority + assignee */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-[13px] text-on-surface-variant">
          <span className="flex items-center gap-0.5">
            <span className="material-symbols-outlined text-[14px]">chat_bubble</span>
            {task._count.comments}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {task.isCriticalPath && (
            <CriticalPathMark variant="chip" className="shrink-0 whitespace-nowrap" />
          )}
          <PriorityBadge priority={task.priority} compact />
          {task.assignedTo && <AssigneeAvatar user={task.assignedTo} size="sm" />}
        </div>
      </div>
    </div>
  );
}

export function SubtaskRow({
  task,
  canToggle,
  onToggle,
}: {
  task: Task;
  canToggle: boolean;
  onToggle?: () => void;
}) {
  const done = task.status === "DONE";
  return (
    <div className="flex touch-manipulation items-center gap-1.5 rounded-sm px-0.5 py-0.5 text-[12px]">
      {/* Toggle only, DONE<->TODO, permission-gated the same way the old
          board gated it (`canMove` -> `task:write`, ProjectKanban.tsx:451-454,
          642-643). No drag surface — subtask dragging is retired. */}
      <button
        type="button"
        disabled={!canToggle}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        aria-label={done ? "Mark not done" : "Mark done"}
        className={[
          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors",
          done
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-outline-variant hover:border-primary",
          canToggle ? "cursor-pointer" : "cursor-default",
        ].join(" ")}
      >
        {done && <span className="material-symbols-outlined text-[11px] leading-none">check</span>}
      </button>
      <span
        onPointerDown={(e) => e.stopPropagation()}
        className={["flex-1 truncate", done ? "text-on-surface-variant line-through" : "text-on-surface"].join(" ")}
      >
        {task.title}
      </span>
      {task.assignedTo && (
        <span onPointerDown={(e) => e.stopPropagation()}>
          <AssigneeAvatar user={task.assignedTo} size="xs" />
        </span>
      )}
    </div>
  );
}

export function getDuration(start: string | null, end: string | null): string {
  if (!end) return "—";
  if (!start) {
    // Derive the day via the UTC
    // date-part, not a local-time parse of the ISO instant.
    const d = dayToDate(dayFromIso(end));
    return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
  }
  // Duration is an absolute-instant delta (both sides are full ISO
  // instants), not a local-time day read — TZ-independent as-is;
  // deliberately left on direct Date parses.
  const diff = Math.ceil(
    (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24),
  );
  return diff > 0 ? `${diff} Days` : "1 Day";
}
