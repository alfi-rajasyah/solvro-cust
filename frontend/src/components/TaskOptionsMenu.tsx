import { useEffect, useState } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { ApiError } from "@/lib/api";
import { useDeleteTask, useDuplicateTask, useProjectTasks, type Task } from "@/lib/queries";

interface TaskOptionsMenuProps {
  projectId: number;
  task: Task;
  canEdit: boolean;
  /** A copy was made; the shell decides where to take the user (the copy's id). */
  onDuplicated: (copyId: number) => void;
  /** The task is gone; the shell decides where to go next. */
  onDeleted: (task: Task) => void;
  /** Failure text for the shell's error slot; null clears it before an action starts. */
  onError: (message: string | null) => void;
  /** True while the delete confirm is open, so the shell can keep Escape from closing under it. */
  onConfirmOpenChange?: (open: boolean) => void;
}

/**
 * The "Task options" menu of a task's header: Duplicate task and Delete task
 * (with its confirm). Shared by the side panel and the task page so the two
 * cannot offer different actions.
 */
export function TaskOptionsMenu({
  projectId,
  task,
  canEdit,
  onDuplicated,
  onDeleted,
  onError,
  onConfirmOpenChange,
}: TaskOptionsMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const duplicateTask = useDuplicateTask(projectId);
  const deleteTask = useDeleteTask(projectId);
  const { data: tasks } = useProjectTasks(projectId);
  const subtaskCount = (tasks ?? []).filter((t) => t.parentTaskId === task.id).length;

  // A re-target shows another task: close the menu rather than carry it over.
  useEffect(() => {
    setMenuOpen(false);
  }, [task.id]);

  useEffect(() => {
    onConfirmOpenChange?.(confirmDelete);
    return () => onConfirmOpenChange?.(false);
  }, [confirmDelete, onConfirmOpenChange]);

  async function handleDuplicate() {
    onError(null);
    try {
      const copy = await duplicateTask.mutateAsync(task.id);
      onDuplicated(copy.id);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not duplicate the task.");
    }
  }

  async function handleDelete() {
    onError(null);
    try {
      await deleteTask.mutateAsync(task.id);
      setConfirmDelete(false);
      onDeleted(task);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Delete failed.");
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="material-symbols-outlined rounded-sm p-1 [@media(pointer:coarse)]:grid [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:place-items-center [@media(pointer:coarse)]:p-0 text-base text-on-surface-variant hover:bg-surface-container-high"
          aria-label="Task options"
        >
          more_horiz
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 z-20 mt-1 w-40 rounded-sm border border-outline-variant bg-surface-container-lowest py-1 shadow-overlay">
              <button
                type="button"
                disabled={!canEdit || duplicateTask.isPending}
                onClick={() => {
                  setMenuOpen(false);
                  void handleDuplicate();
                }}
                className="[@media(pointer:coarse)]:min-h-11 flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-on-surface hover:bg-surface-container-high disabled:cursor-default disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden="true">
                  content_copy
                </span>
                Duplicate task
              </button>
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
                className="[@media(pointer:coarse)]:min-h-11 flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-error hover:bg-error-container disabled:cursor-default disabled:opacity-50"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-sm">delete</span>
                Delete task
              </button>
            </div>
          </>
        )}
      </div>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete task"
        body={
          <>
            Delete task &quot;{task.title}&quot;? This cannot be undone.
            {subtaskCount > 0 && (
              <>
                <br />
                <br />
                This task has {subtaskCount} subtask(s) which will also be deleted.
              </>
            )}
          </>
        }
        confirmLabel="Delete"
        confirmTone="danger"
        busy={deleteTask.isPending}
      />
    </>
  );
}
