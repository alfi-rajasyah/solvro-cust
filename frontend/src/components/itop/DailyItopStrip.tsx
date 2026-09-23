// Daily Review's iTop strip (Task 2.2, docs/archive/plans/itop-integration.md
// — "Daily Review shows the operations picture" in
// docs/archive/plans/itop-integration-spec.md §2): one line of counts + up to 3 recent tickets,
// rendered by OperationsCard at the top of the customer's operations card
// (under its header, above the week notes) — tickets belong to the
// customer, not to a project, so the strip sits in the operations context
// rather than on any ProjectCard. Only rendered by the caller when the
// customer actually has a slice in GET /itop/daily (mapped to an iTop org
// and visible to the caller); this component itself assumes `itop` is
// present.
//
// Task 6.3 (docs/archive/plans/itop-integration.md): rows gain "Assign to
// me"/"Resolve" quick actions, reusing Phase 5's `useTicketAction` mutation
// and `ActionSheet` — each row is its own component instance keyed by
// `ticket.id` (the parent's `.map` below), so calling
// `useTicketAction(ticket.id, customerId)` directly in the row is exactly
// the same shape TicketPanel.tsx already uses (one fixed ticket per
// component instance), unlike the Board (Task 6.1), where a single instance
// must act on whichever card a drag targets.
//
// Fix round (phase review): buttons are derived from `ticketActions.ts`'s
// own `availableActions(status)` rather than a hand-rolled status set, so
// this strip automatically tracks any future change to which actions a
// status offers (e.g. `pending` losing `assign_to_me`) without a second
// edit here. `assign_to_me` can also come back 409 `itop_team_required`
// (iTop needs a team alongside the agent) — `teamsFromError` opens the same
// team `ActionSheet` the panel and the board use, rather than a dead-end
// error.
import { useState } from "react";
import { Chip } from "@/components/StatusChip";
import { ApiError } from "@/lib/api";
import type { DailyItopCustomer, ItopTicketActionName, ItopTicketRow, ItopTicketTeamOption } from "@/lib/queries";
import { useItopStatus, useMyItopToken, useTicketAction } from "@/lib/queries";
import { ActionSheet, type ActionSheetMode } from "./ActionSheet";
import { newTodayChip, resolvedTodayChip, slaBreachedChip } from "./dailyStripPresentation";
import { availableActions, teamsFromError } from "./ticketActions";
import { itopTicketUrl, statusLabel, statusTone } from "./ticketPresentation";

interface StripActionSheetState {
  mode: ActionSheetMode;
  action: ItopTicketActionName;
  teams?: ItopTicketTeamOption[];
}

export interface DailyItopStripProps {
  itop: DailyItopCustomer;
  /**
   * Appends "<ref> <title>" to the operations note being drafted for today —
   * see WeekNotesEditor's `pendingInsert`. Writes nothing to iTop. Omitted
   * (undefined) when the viewed week doesn't contain today (OperationsCard
   * has no persistent today row to append into then) — the strip renders
   * read-only in that case: no "Add to note" buttons, just a muted hint.
   */
  onAddToNote?: (text: string) => void;
}

function syncedAtLabel(syncedAt: string | null): string | null {
  if (!syncedAt) return null;
  const d = new Date(syncedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function DailyItopStrip({ itop, onAddToNote }: DailyItopStripProps) {
  const { data: status } = useItopStatus();
  const { data: myToken } = useMyItopToken();
  const baseUrl = status?.baseUrl ?? null;
  const canAct = (status?.actionsEnabled ?? false) && (myToken?.set ?? false);

  const newChip = newTodayChip(itop.counts.newToday);
  const resolvedChip = resolvedTodayChip(itop.counts.resolvedToday);
  const slaChip = slaBreachedChip(itop.counts.slaBreached);
  const synced = syncedAtLabel(itop.syncedAt);

  return (
    <article
      data-testid="itop-daily-strip"
      className="rounded-sm border border-outline-variant bg-surface-container-lowest px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="rounded-sm bg-surface-container-high px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
          iTop today
        </span>
        <Chip tone={newChip.tone}>{newChip.label}</Chip>
        <Chip tone={resolvedChip.tone}>{resolvedChip.label}</Chip>
        <Chip tone={slaChip.tone}>{slaChip.label}</Chip>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-on-surface-variant">
          {itop.counts.ongoing} ongoing{synced ? ` · synced ${synced}` : ""}
        </span>
      </div>

      {!onAddToNote && (
        <p className="mt-1.5 text-[11px] italic text-on-surface-variant">
          Switch to this week to add to a note.
        </p>
      )}

      {itop.recent.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-t border-outline-variant pt-2">
          {itop.recent.map((ticket) => (
            <DailyItopStripRow
              key={ticket.id}
              ticket={ticket}
              customerId={itop.customerId}
              baseUrl={baseUrl}
              canAct={canAct}
              personName={myToken?.personName ?? null}
              onAddToNote={onAddToNote}
            />
          ))}
        </ul>
      )}
    </article>
  );
}

function DailyItopStripRow({
  ticket,
  customerId,
  baseUrl,
  canAct,
  personName,
  onAddToNote,
}: {
  ticket: ItopTicketRow;
  customerId: number;
  baseUrl: string | null;
  /** `actionsEnabled && token.set` — gates whether the quick-action buttons render at all. */
  canAct: boolean;
  personName: string | null;
  onAddToNote?: (text: string) => void;
}) {
  const url = baseUrl ? itopTicketUrl(baseUrl, ticket) : null;
  const actionMutation = useTicketAction(ticket.id, customerId);
  const [actionSheet, setActionSheet] = useState<StripActionSheetState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const actions = availableActions(ticket.status);
  const canAssign = canAct && actions.includes("assign_to_me");
  const canResolve = canAct && actions.includes("resolve");

  function runAction(action: ItopTicketActionName, fields?: Record<string, string | number>) {
    setActionError(null);
    actionMutation.mutate(
      { action, fields },
      {
        onSuccess: () => setActionSheet(null),
        onError: (err) => {
          const teams = teamsFromError(err);
          if (teams) {
            setActionSheet({ mode: "team", action, teams });
            return;
          }
          setActionError(err instanceof ApiError ? err.message : "Action failed.");
        },
      },
    );
  }

  return (
    <li
      data-testid="itop-daily-strip-row"
      data-ref={ticket.ref}
      className="flex flex-wrap items-center gap-x-2 gap-y-1"
    >
      {/* Ref + title are one link (or one plain span with no baseUrl) —
          never two adjacent anchors to the same href. */}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate text-[12px] text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          title={ticket.title}
        >
          <span className="font-mono font-semibold">{ticket.ref}</span> {ticket.title}
        </a>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[12px] text-on-surface" title={ticket.title}>
          <span className="font-mono font-semibold">{ticket.ref}</span> {ticket.title}
        </span>
      )}
      <Chip tone={statusTone(ticket)}>{statusLabel(ticket.status)}</Chip>
      {canAssign && (
        <button
          type="button"
          onClick={() => runAction("assign_to_me")}
          disabled={actionMutation.isPending}
          className="shrink-0 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          Assign to me
        </button>
      )}
      {canResolve && (
        <button
          type="button"
          onClick={() => setActionSheet({ mode: "resolve", action: "resolve" })}
          disabled={actionMutation.isPending}
          className="shrink-0 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          Resolve
        </button>
      )}
      {onAddToNote && (
        <button
          type="button"
          onClick={() => onAddToNote(`${ticket.ref} ${ticket.title}`)}
          aria-label={`Add ${ticket.ref} to note`}
          className="shrink-0 text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          Add to note
        </button>
      )}

      {actionSheet && (
        <ActionSheet
          open
          onClose={() => {
            setActionSheet(null);
            setActionError(null);
          }}
          mode={actionSheet.mode}
          ticketRef={ticket.ref}
          ticketTitle={ticket.title}
          personName={personName}
          teams={actionSheet.teams}
          busy={actionMutation.isPending}
          error={actionError}
          onConfirm={(fields) => runAction(actionSheet.action, fields)}
        />
      )}
    </li>
  );
}
