import { Chip } from "@/components/StatusChip";
import { fmtDayFull, fmtRange } from "@/lib/formatDate";
import { PHASE_STATUS_LABEL } from "@/lib/labels";
import type { PublicPhaseStatus } from "@/lib/queries";
import {
  PHASE_STATUS_TONE,
  phaseStatusOf,
  type TimelineLayout,
} from "@/lib/shareLinks";

// Compact read-only phase bars, shared by the signed-in timeline embed and the
// guest embed (`/share/:token?embed=1`). Phases come from the caller; `layout`
// is `timelineLayout(phases, today)`.

const BAR_CLASS = {
  done: "bg-primary",
  in_progress: "bg-primary/45 ring-1 ring-inset ring-primary",
  not_started: "bg-surface-container-highest ring-1 ring-inset ring-outline-variant",
} as const;

export interface PhaseBarItem {
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: PublicPhaseStatus;
}

export function PhaseBarList({
  phases,
  layout,
  testId,
  itemTestId,
}: {
  phases: readonly PhaseBarItem[];
  layout: TimelineLayout;
  testId: string;
  itemTestId: string;
}) {
  return (
    <div data-testid={testId}>
      {layout.range && (
        <div className="hidden justify-between border-b border-outline-variant px-3 py-1.5 text-meta text-on-surface-variant sm:flex">
          <span>{fmtDayFull(layout.range.start)}</span>
          <span>{fmtDayFull(layout.range.end)}</span>
        </div>
      )}
      <ol className="divide-y divide-outline-variant/60">
        {phases.map((phase, i) => {
          const status = phaseStatusOf(phase.status);
          const bar = layout.bars[i];
          return (
            <li
              key={i}
              data-testid={itemTestId}
              className="flex flex-col gap-1.5 px-3 py-2 sm:grid sm:grid-cols-[12rem_1fr] sm:items-center sm:gap-3"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="wrap-break-word font-display text-sm font-semibold text-on-surface">
                    {phase.name}
                  </p>
                  <Chip tone={PHASE_STATUS_TONE[status]}>{PHASE_STATUS_LABEL[status]}</Chip>
                </div>
                <p className="text-meta text-on-surface-variant">
                  {fmtRange(phase.startDate, phase.endDate)}
                </p>
              </div>
              <div aria-hidden="true" className="relative h-4 rounded-xs bg-surface-container-low">
                {layout.today !== null && (
                  <span
                    className="absolute inset-y-0 w-px bg-on-surface-variant/50"
                    style={{ left: `${layout.today}%` }}
                  />
                )}
                {bar && (
                  <span
                    className={`absolute inset-y-0.5 rounded-xs ${BAR_CLASS[status]}`}
                    style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
