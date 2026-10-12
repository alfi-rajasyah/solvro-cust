import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { AssigneeAvatar } from "@/components/AssigneeAvatar";
import {
  EMBED_BUTTON_SECONDARY,
  EmbedExternalLink,
  EmbedFooter,
  EmbedHeader,
  EmbedMessage,
} from "@/components/embed/EmbedParts";
import { EmbedBodySkeleton, EmbedScreen } from "@/components/embed/EmbedScreen";
import { TaskStatusChip } from "@/components/StatusChip";
import { dateToDay } from "@/lib/dateField";
import {
  embedOpenHref,
  embedTaskCounts,
  embedTaskScope,
  parseEmbedEpicId,
  parseEmbedLimit,
  sortEmbedTasks,
} from "@/lib/embedViews";
import { fmtDay, fmtDue, isTaskOverdue } from "@/lib/formatDate";
import { type ProjectDetail, type Task, useProjectEpics, useProjectTasks } from "@/lib/queries";

// /embed/projects/:id/tasks[?epic=<id>][&limit=<n>] — the compact task table an
// Outline page shows: top N tasks (overdue first, then by due date), a
// "X of Y done" count and a live 30 s refresh. Read-only; rows and the footer
// open Solvro in a new tab.

export function EmbedTasks() {
  return <EmbedScreen>{(project) => <TasksView project={project} />}</EmbedScreen>;
}

function TasksView({ project }: { project: ProjectDetail }) {
  const [params] = useSearchParams();
  const limit = parseEmbedLimit(params.get("limit"));
  const epicId = parseEmbedEpicId(params.get("epic"));

  const { data: tasks, isLoading, isError, refetch } = useProjectTasks(project.id);
  const { data: epics } = useProjectEpics(epicId !== null ? project.id : null);

  const todayDay = dateToDay(new Date());
  const scoped = useMemo(() => embedTaskScope(tasks ?? [], epicId), [tasks, epicId]);
  const shown = useMemo(
    () => sortEmbedTasks(scoped, todayDay).slice(0, limit),
    [scoped, todayDay, limit],
  );
  const { done, total } = embedTaskCounts(scoped);

  const epicTitle = epicId === null ? null : (epics?.find((e) => e.id === epicId)?.title ?? `#${epicId}`);

  return (
    <>
      <EmbedHeader
        title={project.name}
        subtitle={epicTitle === null ? null : `Epic: ${epicTitle}`}
        meta={tasks ? <span data-testid="embed-count">{`${done} of ${total} done`}</span> : null}
      />
      {isLoading ? (
        <EmbedBodySkeleton />
      ) : isError ? (
        <EmbedMessage
          icon="error"
          title="Tasks could not be loaded"
          hint="Check your connection and try again."
          testId="embed-error"
          role="alert"
        >
          <button type="button" onClick={() => void refetch()} className={EMBED_BUTTON_SECONDARY}>
            Try again
          </button>
        </EmbedMessage>
      ) : shown.length === 0 ? (
        <EmbedMessage
          icon="checklist"
          title={epicId === null ? "No tasks yet" : "No tasks in this epic"}
          testId="embed-empty"
          role="status"
        />
      ) : (
        <table className="w-full table-fixed border-collapse text-left" data-testid="embed-tasks">
          <colgroup>
            <col />
            <col className="w-[7rem]" />
            <col className="w-9 sm:w-32" />
            <col className="w-[4.5rem] sm:w-24" />
          </colgroup>
          <thead>
            <tr className="border-b border-outline-variant text-label-caps uppercase text-on-surface-variant">
              <th scope="col" className="px-3 py-1.5 font-bold">
                Task
              </th>
              <th scope="col" className="px-2 py-1.5 font-bold">
                Status
              </th>
              <th scope="col" className="px-2 py-1.5 font-bold">
                <span className="sr-only sm:not-sr-only">Assignee</span>
              </th>
              <th scope="col" className="px-3 py-1.5 font-bold">
                Due
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((task) => (
              <TaskRow key={task.id} projectId={project.id} task={task} todayDay={todayDay} />
            ))}
          </tbody>
        </table>
      )}
      <EmbedFooter>
        <EmbedExternalLink
          href={embedOpenHref(project.id)}
          testId="embed-open"
          className="font-semibold text-primary hover:underline"
        >
          Open in Solvro to edit
        </EmbedExternalLink>
        {tasks && (
          <span data-testid="embed-showing">
            {" · "}showing {shown.length} of {total}
          </span>
        )}
      </EmbedFooter>
    </>
  );
}

function TaskRow({
  projectId,
  task,
  todayDay,
}: {
  projectId: number;
  task: Task;
  todayDay: string | null;
}) {
  const overdue = isTaskOverdue(task.status, task.dueDate, todayDay);
  const due = !task.dueDate ? "—" : task.status === "DONE" ? fmtDay(task.dueDate) : fmtDue(task.dueDate, todayDay);
  return (
    <tr
      data-testid="embed-task-row"
      className="relative border-b border-outline-variant/60 last:border-b-0 hover:bg-surface-container-low"
    >
      <td className="min-w-0 px-3 py-2 align-middle">
        {/* Stretched link: the whole row is the click target, one link for assistive tech. */}
        <EmbedExternalLink
          href={embedOpenHref(projectId, task.id)}
          className="line-clamp-2 wrap-break-word text-sm font-medium text-on-surface outline-hidden after:absolute after:inset-0 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {task.title}
        </EmbedExternalLink>
      </td>
      <td className="px-2 py-2 align-middle">
        <TaskStatusChip status={task.status} />
      </td>
      <td className="px-2 py-2 align-middle">
        <div className="flex items-center gap-1.5">
          <AssigneeAvatar user={task.assignedTo} size="xs" />
          <span className="hidden truncate text-meta text-on-surface-variant sm:inline">
            {task.assignedTo?.username ?? "Unassigned"}
          </span>
        </div>
      </td>
      <td
        data-overdue={overdue ? "true" : undefined}
        className={`px-3 py-2 align-middle text-meta ${overdue ? "font-semibold text-error" : "text-on-surface-variant"}`}
      >
        {due}
      </td>
    </tr>
  );
}
