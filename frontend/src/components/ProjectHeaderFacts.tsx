import type { ReactNode } from "react";
import { Link } from "react-router";
import { PrimaryChip } from "@/components/customer/PrimaryChip";
import { ProjectStatusChip } from "@/components/StatusChip";
import { dateToDay } from "@/lib/dateField";
import { fmtRange } from "@/lib/formatDate";
import type { ProjectDetail } from "@/lib/queries";
import { cn } from "@/lib/utils";

// Facts row under the project header: who, when, how far along, then only
// what needs action. From md up it is one line about 32px tall; below md it
// keeps Status, Customer and Progress in a two-column grid. Numbers come from
// `project.health` (GET /projects/:id, backend lib/projectHealth.ts); `health`
// is optional on the type, so every fact degrades to a dash instead of
// throwing on an older shape.

// The label is screen-reader text only: sighted users read the bare value
// ("Acme", "3 Mar to 9 Jun"), assistive tech hears what it is. `className`
// carries the per-breakpoint visibility; `divided` draws the hairline that
// separates facts on the one-line layout.
function Fact({
  label,
  className,
  divided = true,
  children,
}: {
  label: string;
  className?: string;
  divided?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "min-w-0 md:flex md:h-8 md:items-center",
        divided && "md:border-l md:border-outline-variant md:pl-4",
        className,
      )}
    >
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0 text-xs font-medium text-on-surface">{children}</dd>
    </div>
  );
}

// "Past end date" is derived from data the page already holds: the latest task
// due day is behind the caller's local day and the project is still live.
function isPastEnd(project: ProjectDetail): boolean {
  const end = project.health?.endDate ?? null;
  if (end === null) return false;
  if (project.status === "COMPLETED" || project.status === "CANCELLED") return false;
  const today = dateToDay(new Date());
  return today !== null && end < today;
}

export function ProjectHeaderFacts({ project }: { project: ProjectDetail }) {
  const health = project.health;
  const total = health?.progress.total ?? 0;
  const done = health?.progress.done ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const hasDates = !!health && (health.startDate !== null || health.endDate !== null);

  const overdue = health?.overdueCount ?? 0;
  const risks = health?.openRiskCount ?? 0;
  const slip = health?.slipDays ?? 0;
  const pastEnd = isPastEnd(project);
  const hasProblems = pastEnd || overdue > 0 || risks > 0 || slip > 0;

  return (
    <div role="group" aria-label="Project facts" className="min-w-0 flex-1">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:flex md:flex-wrap md:items-center md:gap-x-4 md:gap-y-0">
        {/* Phone only: the top bar hides its status chip below md. */}
        <Fact label="Status" className="md:hidden">
          <ProjectStatusChip status={project.status} />
        </Fact>

        <Fact
          label={project.customers.length > 1 ? "Customers" : "Customer"}
          className="md:max-w-96 md:shrink-0"
          divided={false}
        >
          {project.customers.length > 0 ? (
            <ul className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              {project.customers.map((c) => (
                <li key={c.id} className="flex min-w-0 items-center gap-1.5">
                  <Link
                    to={`/customers/${c.id}`}
                    className="[@media(pointer:coarse)]:min-h-11 block truncate text-primary hover:underline"
                  >
                    {c.name}
                  </Link>
                  {c.isPrimary && project.customers.length > 1 && <PrimaryChip />}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-on-surface-variant">No customer</span>
          )}
        </Fact>

        <Fact label="Dates" className="hidden md:flex md:shrink-0">
          {hasDates ? (
            <span className="whitespace-nowrap tabular-nums">
              {fmtRange(health.startDate, health.endDate)}
            </span>
          ) : (
            <span className="text-on-surface-variant">No dates yet</span>
          )}
        </Fact>

        <Fact label="TAM" className="hidden md:flex md:shrink-0">
          <span className="block truncate whitespace-nowrap">
            <span aria-hidden="true" className="font-normal text-on-surface-variant">
              TAM
            </span> {project.tam.username}
          </span>
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

        {/* Problems only: nothing renders when there is nothing to act on. */}
        {hasProblems && (
          <Fact label="Health" className="hidden md:flex">
            <span className="flex items-center gap-x-4 whitespace-nowrap tabular-nums">
              {pastEnd && <span className="text-error">Past end date</span>}
              {overdue > 0 && <span className="text-error">{overdue} overdue</span>}
              {risks > 0 && (
                <span>
                  {risks} open {risks === 1 ? "risk" : "risks"}
                </span>
              )}
              {slip > 0 && <span>{slip}d behind baseline</span>}
            </span>
          </Fact>
        )}
      </dl>
    </div>
  );
}
