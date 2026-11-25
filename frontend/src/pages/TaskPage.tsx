import { useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorAlert } from "@/components/QueryErrorAlert";
import { PageLoading } from "@/components/skeletons";
import { StatusSelect } from "@/components/StatusSelect";
import { TaskDetail } from "@/components/TaskDetail";
import { TaskOptionsMenu } from "@/components/TaskOptionsMenu";
import { ApiError } from "@/lib/api";
import { useProjectTasks, useTask } from "@/lib/queries";
import { parseTaskId } from "@/lib/routeMeta";

const NOT_FOUND_LINK =
  "rounded-sm font-display text-sm font-semibold text-primary underline-offset-2 outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-primary [@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center";

/**
 * `/tasks/:taskId`: one task on its own page, the same body and the same save
 * rules as the side panel (`TaskDetail`), laid out in two columns from md.
 * The route knows only the task id, so `useTask` supplies the project; the
 * fields themselves render from the project's task list, like the panel.
 */
export function TaskPage() {
  const { taskId: rawId } = useParams();
  const taskId = parseTaskId(rawId);
  const navigate = useNavigate();
  const { data: row, isPending, isError, error, refetch } = useTask(taskId);
  // The project of the task shown last. A first load seeded from the cache whose
  // fetch then fails drops `row` (the placeholder goes with it); the project's
  // task list, already loaded, can still show the page.
  const knownProject = useRef<{ taskId: number; projectId: number } | null>(null);
  if (row && taskId !== null) knownProject.current = { taskId, projectId: row.projectId };
  const projectId = row?.projectId ?? (knownProject.current?.taskId === taskId ? knownProject.current.projectId : null);
  const tasksQuery = useProjectTasks(projectId);
  const task = (tasksQuery.data ?? []).find((t) => t.id === taskId) ?? null;

  const title = task?.title ?? row?.title ?? null;
  // A jump to another task (subtask row, parent link) keeps the keyboard in
  // the page: focus moves to the new task's heading. Not on the first load.
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const shownId = useRef<number | null>(null);
  const currentId = task?.id ?? null;
  useEffect(() => {
    if (currentId === null) return;
    if (shownId.current !== null && shownId.current !== currentId) {
      headingRef.current?.focus({ preventScroll: true });
    }
    shownId.current = currentId;
  }, [currentId]);
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · Solvro`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  // The server answers 404 for a task that does not exist and for one the
  // caller cannot see, so one state covers both (plan decision D6).
  const missing = (
    <>
      <h1 className="sr-only">Task not found</h1>
      <EmptyState
        icon="search_off"
        title="Task not found"
        message="It may have been deleted, or it belongs to a project that is not shared with you."
        action={
          <Link to="/tasks" className={NOT_FOUND_LINK}>
            Back to Tasks
          </Link>
        }
      />
    </>
  );

  if (taskId === null) return missing;
  if (isPending) return <PageLoading />;
  // A 404 or 403 is final even when an older copy of the row is cached. Any other
  // failure only replaces the page while there is no row to show: a background
  // refetch that fails must not unmount TaskDetail and lose a draft in it.
  if (isError && error instanceof ApiError && (error.status === 404 || error.status === 403)) return missing;
  if (!row && !task) {
    return (
      <QueryErrorAlert
        title="Could not load this task"
        error={error}
        onRetry={() => void refetch()}
      />
    );
  }
  if (tasksQuery.isError && !tasksQuery.data) {
    return (
      <QueryErrorAlert
        title="Could not load this task"
        error={tasksQuery.error}
        onRetry={() => void tasksQuery.refetch()}
      />
    );
  }
  if (!tasksQuery.data) return <PageLoading />;
  // Visible to the server but absent from the project's list: do not wait on it.
  if (!task) return missing;

  return (
    <div className="mx-auto w-full max-w-6xl border border-outline-variant bg-surface-container">
      <h1 ref={headingRef} tabIndex={-1} className="sr-only outline-hidden">
        {task.title}
      </h1>
      <TaskDetail
        key={task.id}
        projectId={task.projectId}
        taskId={task.id}
        layout="page"
        onOpenTask={(id) => navigate(`/tasks/${id}`)}
        renderHeader={({ task: t, canEdit, patch, reportError }) => (
          <div className="flex items-center gap-2 border-b border-outline-variant px-4 py-3 md:px-8">
            <StatusSelect
              variant="chip"
              value={t.statusId}
              fallback={t.statusDef}
              disabled={!canEdit}
              onChange={(def) => patch({ statusId: def.id })}
              className="px-2.5 py-1"
            />
            <span className="flex-1" />
            <CopyLinkButton
              label="Copy task link"
              getUrl={() => `${window.location.origin}/tasks/${t.id}`}
              className="rounded-sm p-1 hover:bg-surface-container-high"
            />
            <TaskOptionsMenu
              projectId={t.projectId}
              task={t}
              canEdit={canEdit}
              onDuplicated={(copyId) => navigate(`/tasks/${copyId}`)}
              onDeleted={(deleted) =>
                // A subtask goes back to its parent; a top-level task to its project's List.
                navigate(
                  deleted.parentTaskId !== null
                    ? `/tasks/${deleted.parentTaskId}`
                    : `/projects/${deleted.projectId}/list`,
                  { replace: true },
                )
              }
              onError={reportError}
            />
          </div>
        )}
      />
    </div>
  );
}
