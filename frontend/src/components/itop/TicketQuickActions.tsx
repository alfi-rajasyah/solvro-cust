// "Assign to me", the ticket's next lifecycle actions and (in the task panel)
// the ticket timer, shown under a task's pinned iTop ref
// (docs/archive/plans/subtask-itop-tickets.md Tasks 6-7). Everything is reused
// from the ticket panel: the same `availableActions` rules and labels, the
// same `POST /itop/tickets/:id/actions` (personal token, never the app token),
// the same `ActionSheet` for Resolve / Pending / team-required, and the same
// `TicketTimer` (logging through `POST /itop/tickets/:id/time`). No new write
// path. Renders nothing unless the viewer can write, iTop actions are on, and
// they have a personal token — the create-gate reason line already explains
// the missing pieces for creation.
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import {
  useItopTicket,
  useMyItopToken,
  useItopStatus,
  useTicketActionFor,
  type ItopTicketActionName,
  type ItopTicketRow,
  type ItopTicketTeamOption,
} from "@/lib/queries";
import { ActionSheet, type ActionSheetMode } from "./ActionSheet";
import { TicketTimer } from "./TicketTimer";
import { actionLabel, availableActions, teamsFromError } from "./ticketActions";

const ACTION_BUTTON_CLASS =
  "rounded-sm border border-outline-variant px-3 py-1.5 md:py-0.5 font-display text-xs font-semibold text-on-surface hover:border-primary hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30";

interface SheetState {
  mode: ActionSheetMode;
  action: ItopTicketActionName;
  teams?: ItopTicketTeamOption[];
}

export function TicketQuickActions({
  ticket,
  canEdit,
  showTimer = false,
  onSheetOpenChange,
}: {
  /** The pinned ticket as the snapshot resolved it. */
  ticket: ItopTicketRow;
  canEdit: boolean;
  /** The task panel shows the timer; the modal does not. */
  showTimer?: boolean;
  /** Lets the host leave Escape to the open ActionSheet instead of closing itself. */
  onSheetOpenChange?: (open: boolean) => void;
}) {
  const { data: status } = useItopStatus();
  const { data: myToken } = useMyItopToken();
  // The ticket's own customer (not the project's) scopes refresh and the timer.
  const customerId = ticket.customerId;
  const canAct = canEdit && customerId !== null && (status?.actionsEnabled ?? false) && (myToken?.set ?? false);

  const actionMutation = useTicketActionFor(customerId ?? 0);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);

  const reportOpen = useRef(onSheetOpenChange);
  reportOpen.current = onSheetOpenChange;
  const sheetOpen = sheet !== null;
  useEffect(() => {
    reportOpen.current?.(sheetOpen);
    return () => reportOpen.current?.(false);
  }, [sheetOpen]);

  // Reset when the field is re-pointed at another ticket.
  useEffect(() => {
    setSheet(null);
    setError(null);
    setStaleNotice(null);
  }, [ticket.id]);

  // The week figure comes from the detail read (the by-ref row has no minutes).
  const detail = useItopTicket(canAct && showTimer ? ticket.id : null);

  if (!canAct) return null;

  function run(action: ItopTicketActionName, fields?: Record<string, string | number>) {
    setError(null);
    setStaleNotice(null);
    actionMutation.mutate(
      { ticketId: ticket.id, action, fields },
      {
        onSuccess: (fresh) => {
          setSheet(null);
          if (fresh.staleAfterWrite) setStaleNotice("Applied in iTop. The status refreshes on the next sync.");
        },
        onError: (err) => {
          const teams = teamsFromError(err);
          if (teams) {
            setSheet({ mode: "team", action, teams });
            return;
          }
          setError(err instanceof ApiError ? err.message : "Action failed.");
        },
      },
    );
  }

  function handle(action: ItopTicketActionName) {
    if (action === "resolve") setSheet({ mode: "resolve", action });
    else if (action === "pending") setSheet({ mode: "pending", action });
    else run(action);
  }

  const actions = availableActions(ticket.status);

  return (
    <div className="mt-1.5 space-y-1.5">
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              disabled={actionMutation.isPending}
              onClick={() => handle(action)}
              className={ACTION_BUTTON_CLASS}
            >
              {actionLabel(action)}
            </button>
          ))}
        </div>
      )}
      {error && !sheet && (
        <p role="alert" className="text-meta text-error">
          {error}
        </p>
      )}
      {staleNotice && <p className="text-meta text-on-surface-variant">{staleNotice}</p>}
      {showTimer && customerId !== null && (
        <TicketTimer
          ticket={{ id: ticket.id, customerId, ref: ticket.ref }}
          myMinutesThisWeek={detail.data?.myMinutesThisWeek}
          canAct
        />
      )}
      {sheet && (
        <ActionSheet
          open
          onClose={() => setSheet(null)}
          mode={sheet.mode}
          ticketRef={ticket.ref}
          ticketTitle={ticket.title}
          personName={myToken?.personName ?? null}
          teams={sheet.teams}
          busy={actionMutation.isPending}
          error={error}
          onConfirm={(fields) => run(sheet.action, fields)}
        />
      )}
    </div>
  );
}
