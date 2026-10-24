// Copied from the legacy frontend/src/pages/views/ProjectKanban.tsx (TaskCard
// lines 874-1021, SubtaskRow lines 1057-1121, the old "N Days" duration,
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
import { CRITICAL_PATH_LABEL, CriticalPathMark } from "@/components/CriticalPathMark";
import { EpicChip } from "@/components/EpicChip";
import { LabelChip } from "@/components/LabelChip";
import { PriorityBadge } from "@/components/PriorityBadge";
import { KanbanItemHandle } from "@/components/reui/kanban";
import { dateToDay } from "@/lib/dateField";
import { fmtDay, fmtDue, isTaskOverdue } from "@/lib/formatDate";
import { type Epic, type Task } from "@/lib/queries";

function CardTitle({ task }: { task: Task }) {
  return (
    <>
      {task.status === "DONE" && (
        <>
          <span
            className="material-symbols-outlined mr-1 align-text-bottom text-[14px] text-primary"
            aria-hidden="true"
          >
            check_circle
          </span>
          <span className="sr-only">Done: </span>
        </>
      )}
      {task.title}
    </>
  );
}

export function TaskCard({
  task,
  subtaskMap,
  epicMap,
  canDrag,
  canToggleSubtasks = false,
  dragging = false,
  onClick,
  onMenuClick,
  onToggleSubtask,
}: {
  task: Task;
  subtaskMap: Map<number, Task[]>;
  // Epics (docs/archive/plans/epics-spec.md §6/§7 T5): keyed by Epic.id, built once
  // in SolvroKanban.tsx from useProjectEpics — no per-card hook calls.
  // Optional so the drag-overlay ghost (which only needs `canDrag`/`dragging`
  // today) doesn't have to thread it through if a future caller omits it.
  epicMap?: Map<number, Epic>;
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
  // Due date replaces the old "N Days" duration. Open tasks read relative
  // (`fmtDue`: Today / Tomorrow / "6d late"); done tasks read the plain day
  // and never late. Overdue is the same predicate the Gantt tree uses.
  const done = task.status === "DONE";
  const overdue = isTaskOverdue(task.status, task.dueDate, dateToDay(new Date()));
  const dueLabel = task.dueDate ? (done ? fmtDay(task.dueDate) : fmtDue(task.dueDate)) : "";
  const epic = task.epicId !== null ? epicMap?.get(task.epicId) : undefined;

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    onClick?.();
  }

  return (
    <div
      onClick={handleClick}
      className={[
        "group/card touch-manipulation rounded-sm border bg-surface-container-lowest p-3 transition-colors",
        dragging
          ? "rotate-[-1.2deg] border-[1.5px] border-primary shadow-overlay ring-2 ring-primary"
          : "border-outline-variant hover:border-primary",
      ].join(" ")}
    >
      {/* Title + drag handle. The grip appears on hover, or while focus is in
          the card, from `md:` up; below `md` it is always visible. */}
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          {/* Real drag activator (T7): KanbanItemHandle attaches dnd-kit's
              pointer listeners (from the enclosing KanbanItem's context) only
              to this handle, not the card body — handle-only activation,
              matching the old board. `cursor` (default true) handles the
              grab/grabbing cursor swap itself via isDragging context. */}
          {canDrag && (
            <KanbanItemHandle
              // Pointer and touch only (it cannot take focus), so it is hidden
              // from assistive tech; the label stays for tests and hover tooling.
              aria-hidden="true"
              aria-label="Drag to reorder"
              className="mt-0.5 inline-flex shrink-0 touch-none items-center text-on-surface-variant/60 transition-opacity md:pointer-fine:opacity-0 md:pointer-fine:group-focus-within/card:opacity-100 md:pointer-fine:group-hover/card:opacity-100"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">drag_indicator</span>
            </KanbanItemHandle>
          )}
          {/* The title is the card's keyboard entry point: a real button, so
              Tab reaches it and Enter/Space opens the task. It has no handler
              of its own — its click bubbles to the card's onClick above. The
              drag-overlay ghost (no onClick) keeps a plain paragraph. */}
          {onClick ? (
            <button
              type="button"
              className="min-w-0 rounded-sm text-left text-[15px] font-bold leading-tight text-on-surface outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <CardTitle task={task} />
            </button>
          ) : (
            <p className="min-w-0 text-[15px] font-bold leading-tight text-on-surface">
              <CardTitle task={task} />
            </p>
          )}
        </div>
        {/* Card options (opens MobileMoveSheet): touch-only, so it is always
            visible below `md` and absent from `md:` up, where the grip and the
            card click cover the same jobs. */}
        {onMenuClick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMenuClick();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="material-symbols-outlined shrink-0 text-[17px] text-on-surface-variant hover:text-on-surface md:hidden"
            aria-label="Card options"
          >
            more_horiz
          </button>
        )}
      </div>

      {/* Labels + epic chip (docs/archive/plans/epics-spec.md §6): same row, epic
          first — renders on its own even when the task has no labels. */}
      {(epic || task.labels.length > 0) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
          {epic && <EpicChip epic={epic} compact />}
          {task.labels.slice(0, 2).map((l) => (
            <LabelChip key={l.id} label={l} compact />
          ))}
          {task.labels.length > 2 && (
            <span className="text-meta text-on-surface-variant">+{task.labels.length - 2}</span>
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
          <div className="mb-1 flex items-center gap-1 font-display text-label-caps uppercase text-on-surface-variant">
            <span aria-hidden="true" className="material-symbols-outlined text-[12px]">check_circle</span>
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

      {/* Bottom row: due date + comments (only when > 0) on the left; critical
          path, priority (hidden when MEDIUM) and assignee on the right. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-meta text-on-surface-variant">
          {dueLabel && (
            <span
              className={[
                "whitespace-nowrap",
                overdue ? "font-semibold text-error" : "",
              ].join(" ")}
            >
              {dueLabel}
            </span>
          )}
          {task._count.comments > 0 && (
            <span className="flex items-center gap-0.5">
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">chat_bubble</span>
              {task._count.comments}
              <span className="sr-only">{task._count.comments === 1 ? "comment" : "comments"}</span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {task.isCriticalPath && (
            // Icon variant (its `title` is the tooltip). The sr-only text keeps
            // "Critical Path" findable inside the card; the icon is hidden from
            // assistive tech so the name is announced once.
            <>
              <span aria-hidden="true" className="inline-flex shrink-0">
                <CriticalPathMark variant="glyph" />
              </span>
              <span className="sr-only">{CRITICAL_PATH_LABEL}</span>
            </>
          )}
          {task.priority !== "MEDIUM" && <PriorityBadge priority={task.priority} compact />}
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
        {done && <span aria-hidden="true" className="material-symbols-outlined text-meta leading-none">check</span>}
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
