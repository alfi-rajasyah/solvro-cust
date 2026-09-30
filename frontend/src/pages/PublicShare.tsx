import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";
import { Chip, ProjectStatusChip } from "@/components/StatusChip";
import { ApiError } from "@/lib/api";
import { dateToDay } from "@/lib/dateField";
import { fmtAgo, fmtDay, fmtDayFull, fmtRange } from "@/lib/formatDate";
import { MILESTONE_UPCOMING_LABEL, PHASE_STATUS_LABEL, TASK_STATUS_LABEL } from "@/lib/labels";
import { type PublicShare as PublicShareData, usePublicShare } from "@/lib/queries";
import {
  PHASE_STATUS_TONE,
  phaseStatusOf,
  timelineLayout,
} from "@/lib/shareLinks";

// The guest view of a project (docs/archive/plans/collaboration-and-sharing.md,
// L4): read-only, no sign-in, no app shell. It renders the whole public payload
// and nothing else. It never redirects — signed in or out it is the same page,
// and the request is sent without the Authorization header.

const BAR_CLASS = {
  done: "bg-primary",
  in_progress: "bg-primary/45 ring-1 ring-inset ring-primary",
  not_started: "bg-surface-container-highest ring-1 ring-inset ring-outline-variant",
} as const;

/**
 * Keeps crawlers out, stops the token URL leaking through a Referer header and
 * gives the tab a useful title while the page is open.
 */
function useGuestDocument(title: string | null) {
  useEffect(() => {
    const metas = [
      ["robots", "noindex"],
      ["referrer", "no-referrer"],
    ].map(([name, content]) => {
      const meta = document.createElement("meta");
      meta.name = name;
      meta.content = content;
      document.head.appendChild(meta);
      return meta;
    });
    return () => {
      metas.forEach((m) => m.remove());
    };
  }, []);

  useEffect(() => {
    const previous = document.title;
    if (title) document.title = `${title} · Solvro`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

export function PublicShare() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, error, refetch } = usePublicShare(token);
  useGuestDocument(data?.project.name ?? null);

  return (
    <div className="min-h-screen bg-background text-on-surface">
      <header className="border-b border-outline-variant bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-7 w-7" />
            <span className="font-display text-sm font-semibold text-on-surface">Solvro</span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-meta text-on-surface-variant">
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              visibility
            </span>
            Read-only view
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        {isLoading ? (
          <GuestSkeleton />
        ) : data ? (
          <GuestContent data={data} />
        ) : (
          <GuestError error={error} onRetry={() => void refetch()} />
        )}
      </main>
    </div>
  );
}

function GuestSkeleton() {
  return (
    <div role="status" aria-busy="true" data-testid="guest-loading" className="space-y-6">
      <span className="sr-only">Loading project</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-8 w-2/3 animate-pulse rounded-sm bg-surface-container" />
        <div className="h-4 w-1/3 animate-pulse rounded-sm bg-surface-container" />
      </div>
      <div
        aria-hidden="true"
        className="space-y-3 rounded-sm border border-outline-variant bg-surface-container-lowest p-4"
      >
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-sm bg-surface-container-low" />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="space-y-3 rounded-sm border border-outline-variant bg-surface-container-lowest p-4"
      >
        {[0, 1].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded-sm bg-surface-container-low" />
        ))}
      </div>
    </div>
  );
}

function GuestError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const status = error instanceof ApiError ? error.status : null;
  const rateLimited = status === 429;
  const unavailable = status === 404;
  const icon = rateLimited ? "hourglass_top" : unavailable ? "link_off" : "error";
  const title = rateLimited
    ? "Too many requests — try again in a minute"
    : unavailable
      ? "This link has expired or is no longer available"
      : "Something went wrong";
  const hint = rateLimited
    ? "You have opened this page too many times in a short while."
    : unavailable
      ? "Ask the person who shared it with you for a new link."
      : "The project could not be loaded. Check your connection and try again.";
  return (
    <div
      role="alert"
      data-testid="guest-unavailable"
      className="mx-auto mt-10 flex max-w-md flex-col items-center gap-2 rounded-sm border border-dashed border-outline-variant px-6 py-12 text-center"
    >
      <span className="material-symbols-outlined text-3xl text-on-surface-variant" aria-hidden="true">
        {icon}
      </span>
      <h1 className="font-display text-h2 text-on-surface">{title}</h1>
      <p className="text-sm text-on-surface-variant">{hint}</p>
      {!unavailable && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface outline-hidden hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          Try again
        </button>
      )}
    </div>
  );
}

function GuestContent({ data }: { data: PublicShareData }) {
  const { project, phases, milestones } = data;
  const layout = useMemo(
    () => timelineLayout(phases, dateToDay(new Date())),
    [phases],
  );

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-display text-h1 text-on-surface" data-testid="guest-project-name">
            {project.name}
          </h1>
          <ProjectStatusChip status={project.status} />
        </div>
        {project.customerName && (
          <p className="text-body-sm text-on-surface-variant" data-testid="guest-customer">
            {project.customerName}
          </p>
        )}
      </div>

      <section aria-labelledby="guest-phases-heading" className="space-y-3">
        <h2 id="guest-phases-heading" className="text-label-caps uppercase text-on-surface-variant">
          Phases
        </h2>
        {phases.length === 0 ? (
          <p className="rounded-sm border border-dashed border-outline-variant px-4 py-6 text-sm text-on-surface-variant">
            No phases have been planned yet.
          </p>
        ) : (
          <div className="rounded-sm border border-outline-variant bg-surface-container-lowest">
            {layout.range && (
              <div className="hidden border-b border-outline-variant md:grid md:grid-cols-[14rem_1fr] md:gap-4 md:px-4 md:py-2">
                <span />
                <div className="flex justify-between text-meta text-on-surface-variant">
                  <span>{fmtDayFull(layout.range.start)}</span>
                  <span>{fmtDayFull(layout.range.end)}</span>
                </div>
              </div>
            )}
            <ol className="divide-y divide-outline-variant/60" data-testid="guest-phases">
              {phases.map((phase, i) => {
                const status = phaseStatusOf(phase.status);
                const bar = layout.bars[i];
                return (
                  <li
                    key={i}
                    data-testid="guest-phase"
                    className="flex flex-col gap-2 px-4 py-3 md:grid md:grid-cols-[14rem_1fr] md:items-center md:gap-4"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="font-display text-sm font-semibold text-on-surface">
                          {phase.name}
                        </p>
                        <Chip tone={PHASE_STATUS_TONE[status]}>{PHASE_STATUS_LABEL[status]}</Chip>
                      </div>
                      <p className="text-meta text-on-surface-variant">
                        {fmtRange(phase.startDate, phase.endDate)}
                      </p>
                    </div>
                    <div
                      aria-hidden="true"
                      className="relative hidden h-5 rounded-xs bg-surface-container-low md:block"
                    >
                      {layout.today !== null && (
                        <span
                          className="absolute inset-y-0 w-px bg-on-surface-variant/50"
                          style={{ left: `${layout.today}%` }}
                        />
                      )}
                      {bar && (
                        <span
                          className={`absolute inset-y-1 rounded-xs ${BAR_CLASS[status]}`}
                          style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </section>

      <section aria-labelledby="guest-milestones-heading" className="space-y-3">
        <h2
          id="guest-milestones-heading"
          className="text-label-caps uppercase text-on-surface-variant"
        >
          Milestones
        </h2>
        {milestones.length === 0 ? (
          <p className="rounded-sm border border-dashed border-outline-variant px-4 py-6 text-sm text-on-surface-variant">
            No milestones yet.
          </p>
        ) : (
          <ul
            className="divide-y divide-outline-variant/60 rounded-sm border border-outline-variant bg-surface-container-lowest"
            data-testid="guest-milestones"
          >
            {milestones.map((m, i) => (
              <li
                key={i}
                data-testid="guest-milestone"
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <span
                  className={`material-symbols-outlined text-lg ${m.done ? "text-primary" : "text-on-surface-variant"}`}
                  aria-hidden="true"
                >
                  {m.done ? "check_circle" : "flag"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-on-surface">{m.title}</p>
                  <p className="text-meta text-on-surface-variant">
                    {m.date ? fmtDay(m.date) : "No date"}
                  </p>
                </div>
                <Chip tone={m.done ? "emerald" : "gray"}>
                  {m.done ? TASK_STATUS_LABEL.DONE : MILESTONE_UPCOMING_LABEL}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="border-t border-outline-variant pt-4 text-meta text-on-surface-variant">
        Updated {fmtAgo(data.generatedAt)} · Shared read-only from Solvro
      </p>
    </div>
  );
}
