import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AssigneeAvatar } from "@/components/AssigneeAvatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { describeActivity } from "@/lib/activityText";
import { fmtAgo, fmtDateTime } from "@/lib/formatDate";
import { ACTIVITY_MAX_PAGES, type ActivityEvent, useProjectActivity, useProjectMembers } from "@/lib/queries";

const ALL_PEOPLE = "all";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

/**
 * "Recent activity" on the project Overview (docs/archive/plans/collaboration-and-sharing.md,
 * C5a): one plain sentence per event, newest first, filterable by person and
 * paged with "Load more". `taskIds` are the tasks that still exist; only those
 * get a link, so a deleted task never points at a dead panel.
 */
export function ProjectActivity({
  projectId,
  tam,
  taskIds,
}: {
  projectId: number;
  tam: { id: number; username: string };
  taskIds: ReadonlySet<number>;
}) {
  const [person, setPerson] = useState<string>(ALL_PEOPLE);
  const actorId = person === ALL_PEOPLE ? null : Number(person);
  const { data: members } = useProjectMembers(projectId);
  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage, refetch } =
    useProjectActivity(projectId, { actorId });

  const options = useMemo(
    () => [
      { value: ALL_PEOPLE, label: "Everyone" },
      { value: String(tam.id), label: tam.username },
      ...(members ?? []).map((m) => ({ value: String(m.userId), label: m.username })),
    ],
    [tam.id, tam.username, members],
  );

  const events = useMemo(() => data?.pages.flatMap((p) => p.events) ?? [], [data]);

  return (
    <section
      aria-labelledby="project-activity-heading"
      className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4"
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="project-activity-heading" className="text-label-caps uppercase text-on-surface-variant">
          Recent activity
        </h3>
        <Select
          items={options}
          value={person}
          onValueChange={(v) => setPerson(typeof v === "string" ? v : ALL_PEOPLE)}
        >
          <SelectTrigger
            size="sm"
            className={`w-auto min-w-36 ${FOCUS_RING}`}
            aria-label="Filter activity by person"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {isLoading ? (
        <div className="space-y-2">
          <span className="sr-only">Loading activity</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} aria-hidden="true" className="h-8 animate-pulse rounded-sm bg-surface-container-low" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center gap-3 rounded-sm border border-dashed border-outline-variant px-3 py-4 text-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            error
          </span>
          <span>Could not load activity.</span>
          <button
            type="button"
            onClick={() => void refetch()}
            className={`rounded-sm font-semibold text-primary hover:underline ${FOCUS_RING}`}
          >
            Try again
          </button>
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-sm border border-dashed border-outline-variant px-3 py-8 text-center">
          <span className="material-symbols-outlined text-2xl text-on-surface-variant" aria-hidden="true">
            history
          </span>
          <p className="font-display text-sm font-semibold text-on-surface">No activity yet</p>
          <p className="text-xs text-on-surface-variant">
            {actorId === null
              ? "Changes to tasks, risks, notes and members show up here."
              : "This person has not changed anything in this project yet."}
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-outline-variant">
            {events.map((event) => (
              <ActivityRow key={event.id} event={event} taskIds={taskIds} />
            ))}
          </ul>
          {!hasNextPage && data && data.pages.length >= ACTIVITY_MAX_PAGES && (
            <p className="mt-3 text-center text-meta text-on-surface-variant">
              Showing the latest {events.length} events.
            </p>
          )}
          {hasNextPage && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                className={`inline-flex items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-on-surface hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
              >
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ActivityRow({
  event,
  taskIds,
}: {
  event: ActivityEvent;
  taskIds: ReadonlySet<number>;
}) {
  const sentence = describeActivity(event);
  const linkTaskId = sentence.taskId !== null && taskIds.has(sentence.taskId) ? sentence.taskId : null;

  // The first emphasised name is the task the event is about.
  const firstEntity = sentence.parts.findIndex((p) => p.kind === "entity");

  return (
    <li className="flex items-start gap-2.5 py-2" data-testid="activity-event">
      <span className="mt-0.5 shrink-0">
        {event.actor ? (
          <AssigneeAvatar user={event.actor} />
        ) : (
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant"
            title="Unknown user"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              person
            </span>
          </span>
        )}
      </span>
      <p className="min-w-0 flex-1 wrap-break-word text-sm text-on-surface">
        {sentence.parts.map((part, i) => {
          if (part.kind === "actor") {
            return (
              <span key={i} className="font-semibold">
                {part.text}
              </span>
            );
          }
          if (part.kind === "entity") {
            return linkTaskId !== null && i === firstEntity ? (
              <Link
                key={i}
                to={`?task=${linkTaskId}`}
                className={`rounded-sm font-semibold text-primary hover:underline ${FOCUS_RING}`}
              >
                {part.text}
              </Link>
            ) : (
              <span key={i} className="font-semibold">
                {part.text}
              </span>
            );
          }
          return <span key={i}>{part.text}</span>;
        })}
      </p>
      <time
        dateTime={event.createdAt}
        title={fmtDateTime(event.createdAt)}
        className="mt-0.5 shrink-0 whitespace-nowrap text-meta text-on-surface-variant"
      >
        {fmtAgo(event.createdAt)}
      </time>
    </li>
  );
}
