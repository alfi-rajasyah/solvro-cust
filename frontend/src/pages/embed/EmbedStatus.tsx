import { useMemo } from "react";
import {
  EmbedExternalLink,
  EmbedFooter,
  EmbedHeader,
} from "@/components/embed/EmbedParts";
import { EmbedScreen } from "@/components/embed/EmbedScreen";
import { ProjectStatusChip } from "@/components/StatusChip";
import { dateToDay } from "@/lib/dateField";
import { embedOpenHref, embedScheduleLabel, nextMilestone } from "@/lib/embedViews";
import { fmtDay, fmtRange } from "@/lib/formatDate";
import { type ProjectDetail, useProjectTasks } from "@/lib/queries";

// /embed/projects/:id/status — where the project stands: progress, the health
// line (overdue · schedule · open risks) and the next milestone. Numbers come
// from the server's `health` block on GET /projects/:id, the same source as the
// project header facts.

export function EmbedStatus() {
  return <EmbedScreen>{(project) => <StatusView project={project} />}</EmbedScreen>;
}

function StatusView({ project }: { project: ProjectDetail }) {
  const health = project.health;
  const { data: tasks } = useProjectTasks(project.id);
  const todayDay = dateToDay(new Date());
  const milestone = useMemo(() => nextMilestone(tasks ?? [], todayDay), [tasks, todayDay]);

  const total = health?.progress.total ?? 0;
  const done = health?.progress.done ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const hasDates = !!health && (health.startDate !== null || health.endDate !== null);

  return (
    <>
      <EmbedHeader
        title={project.name}
        meta={total > 0 ? <span data-testid="embed-count">{`${done} of ${total} done`}</span> : null}
      />
      <div className="space-y-3 px-3 py-3" data-testid="embed-status">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ProjectStatusChip status={project.status} />
          {project.customer && (
            <span className="text-meta text-on-surface-variant">{project.customer.name}</span>
          )}
          {hasDates && (
            <span className="text-meta text-on-surface-variant">
              {fmtRange(health.startDate, health.endDate)}
            </span>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-meta">
            <span className="font-semibold text-on-surface">Progress</span>
            <span className="tabular-nums text-on-surface-variant">
              {total > 0 ? `${pct}%` : "No tasks yet"}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="Project progress"
            className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high"
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <p className="flex flex-wrap items-center gap-x-1.5 text-sm tabular-nums" data-testid="embed-health">
          {health ? (
            <>
              <span className={health.overdueCount > 0 ? "font-semibold text-error" : "text-on-surface"}>
                {health.overdueCount} overdue
              </span>
              <span aria-hidden="true" className="text-on-surface-variant">
                ·
              </span>
              <span className="text-on-surface">{embedScheduleLabel(health.slipDays)}</span>
              <span aria-hidden="true" className="text-on-surface-variant">
                ·
              </span>
              <span className="text-on-surface">
                {health.openRiskCount} open {health.openRiskCount === 1 ? "risk" : "risks"}
              </span>
            </>
          ) : (
            <span className="text-on-surface-variant">Health is not available.</span>
          )}
        </p>

        {milestone && (
          <p className="flex items-start gap-2 text-sm" data-testid="embed-milestone">
            <span
              className="material-symbols-outlined text-lg text-on-surface-variant"
              aria-hidden="true"
            >
              flag
            </span>
            <span className="min-w-0 wrap-break-word">
              <span className="text-meta text-on-surface-variant">Next milestone </span>
              <span className="font-medium text-on-surface">{milestone.title}</span>
              <span className="text-meta text-on-surface-variant">
                {" · "}
                {fmtDay(milestone.dueDate ?? milestone.startDate)}
              </span>
            </span>
          </p>
        )}
      </div>
      <EmbedFooter>
        <EmbedExternalLink
          href={embedOpenHref(project.id)}
          testId="embed-open"
          className="font-semibold text-primary hover:underline"
        >
          Open in Solvro to edit
        </EmbedExternalLink>
      </EmbedFooter>
    </>
  );
}
