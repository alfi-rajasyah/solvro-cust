import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorAlert } from "@/components/QueryErrorAlert";
import { PageLoading } from "@/components/skeletons";
import { StatusSelect } from "@/components/StatusSelect";
import { TaskDetail } from "@/components/TaskDetail";
import { TaskOptionsMenu } from "@/components/TaskOptionsMenu";
import { ApiError } from "@/lib/api";
import { useProjectTasks, useTask } from "@/lib/queries";

const NOT_FOUND_LINK =
  "font-display text-sm font-semibold text-primary underline-offset-2 hover:underline [@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center";

function parseTaskId(raw: string | undefined): number | null {
  const n = Number(raw);
  return raw !== undefined && /^\d+$/.test(raw) && Number.isSafeInteger(n) && n > 0 && n <= 2147483647
    ? n
    : null;
}

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
  const projectId = row?.projectId ?? null;
  const tasksQuery = useProjectTasks(projectId);
  const task = (tasksQuery.data ?? []).find((t) => t.id === taskId) ?? null;

  const title = task?.title ?? row?.title ?? null;
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
  );

  if (taskId === null) return missing;
  if (isPending) return <PageLoading />;
  if (isError || !row) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return missing;
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
      <h1 className="sr-only">{task.title}</h1>
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
