import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ProjectStatusChip } from "@/components/StatusChip";
import { fmtRange } from "@/lib/formatDate";
import type { ProjectDetail } from "@/lib/queries";

// Facts row under the project header: who, when, how far along, how healthy.
// Numbers come from `project.health` (GET /projects/:id, backend
// lib/projectHealth.ts); `health` is optional on the type, so every fact
// degrades to a dash instead of throwing on an older shape.

// `className` carries the per-breakpoint visibility: below md only Status,
// Customer and Progress show (the top bar already carries the name).
function Fact({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={["min-w-0", className].filter(Boolean).join(" ")}>
      <dt className="font-display text-label-caps uppercase text-on-surface-variant">
        {label}
      </dt>
      <dd className="mt-1 min-w-0 text-xs font-medium text-on-surface">{children}</dd>
    </div>
  );
}

// Same wording as the Daily Review schedule chip (daily-review/ProjectCard.tsx).
function slipLabel(slipDays: number | null | undefined): string {
  if (slipDays === null || slipDays === undefined) return "No baseline";
  if (slipDays > 0) return `${slipDays}d behind`;
  if (slipDays < 0) return `${-slipDays}d ahead`;
  return "On schedule";
}

export function ProjectHeaderFacts({ project }: { project: ProjectDetail }) {
  const health = project.health;
  const total = health?.progress.total ?? 0;
  const done = health?.progress.done ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const hasDates = !!health && (health.startDate !== null || health.endDate !== null);

  return (
    <div role="group" aria-label="Project facts" className="min-w-0 flex-1">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:flex md:flex-wrap md:gap-x-8">
        {/* Phone only: the top bar hides its status chip below md. */}
        <Fact label="Status" className="md:hidden">
          <ProjectStatusChip status={project.status} />
        </Fact>

        <Fact label="Customer" className="md:max-w-64 md:shrink-0">
          {project.customer ? (
            <Link
              to={`/customers/${project.customer.id}`}
              className="block truncate text-primary hover:underline"
            >
              {project.customer.name}
            </Link>
          ) : (
            <span className="text-on-surface-variant">No customer</span>
          )}
        </Fact>

        <Fact label="Dates" className="hidden md:block md:shrink-0">
          {hasDates ? (
            fmtRange(health.startDate, health.endDate)
          ) : (
            <span className="text-on-surface-variant">No dates yet</span>
          )}
        </Fact>

        <Fact label="TAM" className="hidden md:block md:shrink-0">
          <span className="block truncate">{project.tam.username}</span>
        </Fact>

        <Fact label="Progress" className="col-span-2 md:col-span-1 md:shrink-0">
          {health && total > 0 ? (
            <div className="flex items-center gap-2">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label="Project progress"
                className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-container-high"
              >
                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
              <span className="whitespace-nowrap tabular-nums">
                {pct}% · {done} of {total}
              </span>
            </div>
          ) : (
            <span className="text-on-surface-variant">No tasks yet</span>
          )}
        </Fact>

        <Fact label="Health" className="hidden md:block">
          {health ? (
            <span className="flex flex-wrap items-center gap-x-1.5 whitespace-nowrap tabular-nums">
              <span className={health.overdueCount > 0 ? "text-error" : undefined}>
                {health.overdueCount} overdue
              </span>
              <span aria-hidden="true" className="text-on-surface-variant">
                ·
              </span>
              <span>
                {slipLabel(health.slipDays)}
              </span>
              <span aria-hidden="true" className="text-on-surface-variant">
                ·
              </span>
              <span>
                {health.openRiskCount} open {health.openRiskCount === 1 ? "risk" : "risks"}
              </span>
            </span>
          ) : (
            <span className="text-on-surface-variant">—</span>
          )}
        </Fact>
      </dl>
    </div>
  );
}
