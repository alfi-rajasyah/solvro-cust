import { useMemo } from "react";
import {
  EMBED_BUTTON_SECONDARY,
  EmbedFooter,
  EmbedFrame,
  EmbedHeader,
  EmbedMessage,
} from "@/components/embed/EmbedParts";
import { EmbedBodySkeleton } from "@/components/embed/EmbedScreen";
import { PhaseBarList } from "@/components/embed/PhaseBarList";
import { Chip } from "@/components/StatusChip";
import { dateToDay } from "@/lib/dateField";
import { fmtAgo, fmtDay } from "@/lib/formatDate";
import { MILESTONE_UPCOMING_LABEL, TASK_STATUS_LABEL } from "@/lib/labels";
import type { PublicShare } from "@/lib/queries";
import { guestErrorCopy, timelineLayout } from "@/lib/shareLinks";

// /share/:token?embed=1 — the guest timeline without page chrome: a compact
// title line, the phase bars and milestones, one footer line. It renders the
// public payload exactly as the full guest page does (nothing added), makes no
// request with a session, and never navigates: an expired, revoked or unknown
// link shows a compact card in place.

export function GuestEmbed({
  data,
  isLoading,
  error,
  onRetry,
}: {
  data: PublicShare | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <EmbedFrame>
      {isLoading ? (
        <EmbedBodySkeleton />
      ) : data ? (
        <GuestEmbedContent data={data} />
      ) : (
        <GuestEmbedError error={error} onRetry={onRetry} />
      )}
    </EmbedFrame>
  );
}

function GuestEmbedError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { icon, title, hint, final } = guestErrorCopy(error);
  return (
    <EmbedMessage icon={icon} title={title} hint={hint} testId="guest-unavailable" role="alert">
      {!final && (
        <button type="button" onClick={onRetry} className={EMBED_BUTTON_SECONDARY}>
          Try again
        </button>
      )}
    </EmbedMessage>
  );
}

function GuestEmbedContent({ data }: { data: PublicShare }) {
  const { project, phases, milestones } = data;
  const layout = useMemo(() => timelineLayout(phases, dateToDay(new Date())), [phases]);

  return (
    <>
      <EmbedHeader title={project.name} subtitle={project.customerName} live={false} />
      <div data-testid="guest-embed">
        {phases.length === 0 ? (
          <p className="px-3 py-4 text-sm text-on-surface-variant">No phases have been planned yet.</p>
        ) : (
          <PhaseBarList phases={phases} layout={layout} testId="guest-phases" itemTestId="guest-phase" />
        )}
        {milestones.length > 0 && (
          <ul
            className="divide-y divide-outline-variant/60 border-t border-outline-variant"
            data-testid="guest-milestones"
          >
            {milestones.map((m, i) => (
              <li key={i} data-testid="guest-milestone" className="flex items-center gap-2.5 px-3 py-2">
                <span
                  className={`material-symbols-outlined text-lg ${m.done ? "text-primary" : "text-on-surface-variant"}`}
                  aria-hidden="true"
                >
                  {m.done ? "check_circle" : "flag"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="wrap-break-word text-sm font-medium text-on-surface">{m.title}</p>
                  <p className="text-meta text-on-surface-variant">{m.date ? fmtDay(m.date) : "No date"}</p>
                </div>
                <Chip tone={m.done ? "emerald" : "gray"}>
                  {m.done ? TASK_STATUS_LABEL.DONE : MILESTONE_UPCOMING_LABEL}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </div>
      <EmbedFooter>Updated {fmtAgo(data.generatedAt)} · Shared read-only from Solvro</EmbedFooter>
    </>
  );
}
