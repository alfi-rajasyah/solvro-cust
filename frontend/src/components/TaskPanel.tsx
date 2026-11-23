import { useEffect, useRef, useState } from "react";
import { usePanelFocus } from "@/hooks/usePanelFocus";
import { isDragActive } from "./Modal";
import { CopyLinkButton } from "./CopyLinkButton";
import { StatusSelect } from "./StatusSelect";
import { TaskDetail } from "./TaskDetail";
import { TaskOptionsMenu } from "./TaskOptionsMenu";
import { QueryErrorAlert } from "@/components/QueryErrorAlert";
import { useProjectTasks } from "@/lib/queries";

interface TaskPanelProps {
  projectId: number;
  taskId: number;
  /** Re-target the panel at another task — subtask rows and the parent breadcrumb. */
  onOpenTask: (id: number) => void;
  onClose: () => void;
}

/**
 * Right-anchored task detail panel, deep-linked via `?task=<id>`. Replaces
 * TaskFormModal's edit mode everywhere it's opened from a card/row click —
 * TaskFormModal itself is kept around for CREATE only.
 *
 * A subtask row opens the same panel targeted at the subtask (mirroring
 * ProjectList's SubtaskRow), which is what makes every subtask field editable
 * from here. The breadcrumb is the way back: ProjectDetail keys the panel on
 * the task id, so a re-target is a remount with no in-panel history.
 */
export function TaskPanel({ projectId, taskId, onOpenTask, onClose }: TaskPanelProps) {
  const { data: tasks, isError: tasksError, error: tasksLoadError, refetch: refetchTasks } = useProjectTasks(projectId);
  const task = (tasks ?? []).find((t) => t.id === taskId) ?? null;

  const panelRef = useRef<HTMLDivElement | null>(null);
  // Focus moves into the panel on open (and when the loading shell is
  // replaced by the loaded panel) and returns to the opener on close.
  usePanelFocus(panelRef, taskId, task ? "ready" : "loading");

  // Escape belongs to whatever modal is open on top of the panel: the body's
  // conflict dialog and iTop sheets, or the options menu's delete confirm.
  const [bodyOverlay, setBodyOverlay] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const modalOpen = bodyOverlay || deleteConfirmOpen;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !modalOpen && !isDragActive()) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, modalOpen]);

  if (!task) {
    // `tasks` undefined = still loading; once it has loaded, a missing task was
    // deleted (or is not visible to this user) — say so instead of spinning.
    const notFound = tasks !== undefined;
    // A failed fetch leaves `tasks` undefined: show the error with a retry
    // instead of an endless "Loading task…" (ISS-066).
    const loadFailed = tasks === undefined && tasksError;
    return (
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Task details"
        aria-busy={!notFound && !loadFailed}
        tabIndex={-1}
        className="fixed right-0 top-14 bottom-0 z-40 flex w-full flex-col border-l border-outline-variant bg-surface-container px-5 py-4 outline-hidden md:w-[380px]"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm text-on-surface-variant">
            {notFound ? "Task not found" : loadFailed ? "Task details" : "Loading task…"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="tap-target rounded-sm p-1 text-on-surface-variant hover:bg-surface-container-high"
            aria-label="Close"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
        {loadFailed && (
          <QueryErrorAlert
            title="Could not load this task"
            error={tasksLoadError}
            onRetry={() => refetchTasks()}
            className="mt-4"
          />
        )}
      </div>
    );
  }
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Task details"
      tabIndex={-1}
      className="fixed right-0 top-14 bottom-0 z-40 flex w-full flex-col border-l border-outline-variant bg-surface-container shadow-overlay outline-hidden md:w-[380px]"
    >
      <TaskDetail
        projectId={projectId}
        taskId={taskId}
        layout="panel"
        onOpenTask={onOpenTask}
        onOverlayChange={setBodyOverlay}
        renderHeader={({ task: t, canEdit: editable, patch, reportError }) => (
        <div className="flex items-center gap-2 border-b border-outline-variant px-4 py-3">
          <StatusSelect
            variant="chip"
            value={t.statusId}
            fallback={t.statusDef}
            disabled={!editable}
            onChange={(def) => patch({ statusId: def.id })}
            className="px-2.5 py-1"
          />
          <span className="flex-1" />
          <CopyLinkButton
            label="Copy task link"
            getUrl={() => `${window.location.origin}/projects/${projectId}?task=${taskId}`}
            className="rounded-sm p-1 hover:bg-surface-container-high"
          />
          <TaskOptionsMenu
            projectId={projectId}
            task={t}
            canEdit={editable}
            onDuplicated={onOpenTask}
            onDeleted={(deleted) => {
              // Deleting a subtask returns to its parent rather than closing outright —
              // the user reached this panel from the parent's subtask list.
              if (deleted.parentTaskId !== null) onOpenTask(deleted.parentTaskId);
              else onClose();
            }}
            onError={reportError}
            onConfirmOpenChange={setDeleteConfirmOpen}
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 [@media(pointer:coarse)]:grid [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:place-items-center [@media(pointer:coarse)]:p-0 text-on-surface-variant hover:bg-surface-container-high"
            aria-label="Close"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
        )}
      />
    </div>
  );
}
