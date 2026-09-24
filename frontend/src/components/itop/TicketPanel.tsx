// Right-anchored ticket detail panel, deep-linked via `?ticket=<id>` on the
// customer page's Tickets tab (Task 5.4, docs/archive/plans/
// itop-integration.md). Structural precedent is TaskPanel.tsx's own
// right-anchored, edge-to-edge-on-phone `<aside>` shell (same
// `fixed right-0 top-14 bottom-0` positioning, `shadow-overlay` per
// docs/DESIGN.md's elevation whitelist for that panel type).
//
// No optimistic writes: `useTicketAction`/`useAddTicketLog` (lib/queries.ts)
// have no `onMutate` — the facts grid and log only ever reflect what the
// backend's `core/get` echo says iTop actually did. A 409 `itop_team_required`
// on `assign_to_me` opens the team ActionSheet instead of surfacing as a
// plain error; any other failure shows iTop's message inline and leaves the
// ticket untouched.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Chip } from "@/components/StatusChip";
import { ApiError } from "@/lib/api";
import {
  useItopStatus,
  useItopTicket,
  useMyItopToken,
  useAddTicketLog,
  useTicketAction,
  type ItopTicketActionName,
  type ItopTicketTeamOption,
} from "@/lib/queries";
import { ActionSheet, type ActionSheetMode } from "./ActionSheet";
import { TicketLog } from "./TicketLog";
import { TicketTimer } from "./TicketTimer";
import { actionLabel, availableActions, teamsFromError } from "./ticketActions";
import {
  ageLabel,
  itopTicketUrl,
  priorityLabel,
  slaLabel,
  statusLabel,
  statusTone,
} from "./ticketPresentation";

const CLASS_LABEL: Record<string, string> = {
  UserRequest: "User request",
  Incident: "Incident",
};

interface ActionSheetState {
  mode: ActionSheetMode;
  action: ItopTicketActionName;
  teams?: ItopTicketTeamOption[];
}

export function TicketPanel({
  customerId,
  ticketId,
  onClose,
}: {
  customerId: number;
  ticketId: number;
  onClose: () => void;
}) {
  const { data: ticket, isLoading, isError } = useItopTicket(ticketId);
  const { data: status } = useItopStatus();
  const { data: myToken } = useMyItopToken();
  const actionMutation = useTicketAction(ticketId, customerId);
  const logMutation = useAddTicketLog(ticketId, customerId);

  const [actionSheet, setActionSheet] = useState<ActionSheetState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  // Set when a write's response comes back `staleAfterWrite: true` — iTop
  // accepted the write but the follow-up read failed, so the row queries.ts
  // just invalidated (rather than cached) is not reflected here yet.
  const [staleNotice, setStaleNotice] = useState<string | null>(null);

  useEffect(() => {
    setActionSheet(null);
    setActionError(null);
    setLogError(null);
    setStaleNotice(null);
  }, [ticketId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const actionsEnabled = status?.actionsEnabled ?? false;
  const tokenSet = myToken?.set ?? false;
  const canAct = actionsEnabled && tokenSet;

  function runAction(action: ItopTicketActionName, fields?: Record<string, string | number>) {
    setActionError(null);
    setStaleNotice(null);
    actionMutation.mutate(
      { action, fields },
      {
        onSuccess: (fresh) => {
          setActionSheet(null);
          if (fresh.staleAfterWrite) {
            setStaleNotice(
              "Applied in iTop. The list refreshes on the next sync — use Refresh to see it now.",
            );
          }
        },
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

  function handleAction(action: ItopTicketActionName) {
    if (action === "resolve") {
      setActionSheet({ mode: "resolve", action: "resolve" });
      return;
    }
    // Pending needs a reason on a real iTop install (ground truth confirmed
    // 2026-09-24: `POST /itop/tickets/:id/actions` 400s without
    // `fields.pending_reason`) — same "open the sheet instead of firing
    // directly" pattern as Resolve.
    if (action === "pending") {
      setActionSheet({ mode: "pending", action: "pending" });
      return;
    }
    runAction(action);
  }

  function handleAddLog(visibility: "public" | "private", text: string) {
    setLogError(null);
    setStaleNotice(null);
    logMutation.mutate(
      { visibility, text },
      {
        onSuccess: (fresh) => {
          if (fresh.staleAfterWrite) {
            setStaleNotice(
              "Applied in iTop. The list refreshes on the next sync — use Refresh to see it now.",
            );
          }
        },
        onError: (err) => {
          setLogError(err instanceof ApiError ? err.message : "Could not add the log entry.");
        },
      },
    );
  }

  const url = ticket && status?.baseUrl ? itopTicketUrl(status.baseUrl, ticket) : null;

  return (
    <>
      <aside
        role="dialog"
        aria-label="Ticket details"
        className="fixed right-0 top-14 bottom-0 z-40 flex w-full flex-col border-l border-outline-variant bg-surface-container shadow-overlay md:w-[420px]"
      >
        <div className="flex items-center gap-2 border-b border-outline-variant px-4 py-3">
          {ticket && (
            <>
              <span className="font-mono text-[13px] text-on-surface">{ticket.ref}</span>
              <span className="text-[12px] text-on-surface-variant">
                {CLASS_LABEL[ticket.class] ?? ticket.class}
              </span>
              <Chip tone={statusTone(ticket)}>{statusLabel(ticket.status)}</Chip>
            </>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-on-surface-variant hover:bg-surface-container-high"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isLoading && (
            <div className="h-24 animate-pulse rounded-sm bg-surface-container-low" />
          )}

          {isError && (
            <Alert variant="destructive">
              <AlertDescription>Could not load this ticket.</AlertDescription>
            </Alert>
          )}

          {ticket && (
            <>
              <h2 className="text-lg font-bold text-on-surface">{ticket.title}</h2>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {canAct &&
                  availableActions(ticket.status).map((action) => (
                    <button
                      key={action}
                      type="button"
                      disabled={actionMutation.isPending}
                      onClick={() => handleAction(action)}
                      className="rounded-sm border border-outline-variant px-3 py-1 font-display text-[12px] font-bold uppercase tracking-wider text-on-surface hover:border-primary hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    >
                      {actionLabel(action)}
                    </button>
                  ))}
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-display text-[12px] font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    Open in iTop ↗
                  </a>
                )}
              </div>

              {canAct && (
                <p className="mt-1.5 text-[11px] text-on-surface-variant">
                  Writes go to iTop as {myToken?.personName ?? "you"}
                </p>
              )}
              {!actionsEnabled && (
                <p className="mt-1.5 text-[11px] text-on-surface-variant">
                  Actions from Solvro are off (Admin › iTop).
                </p>
              )}
              {actionsEnabled && !tokenSet && (
                <Alert className="mt-2">
                  <AlertDescription>
                    Add your personal iTop token in{" "}
                    <Link to="/settings" className="font-semibold underline">
                      Settings
                    </Link>{" "}
                    to act from here.
                  </AlertDescription>
                </Alert>
              )}

              {actionError && (
                <Alert variant="destructive" className="mt-2">
                  <AlertDescription>{actionError}</AlertDescription>
                </Alert>
              )}

              {staleNotice && (
                <Alert className="mt-2">
                  <AlertDescription>{staleNotice}</AlertDescription>
                </Alert>
              )}

              <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                <Fact label="Caller" value={ticket.callerName ?? "—"} />
                <Fact label="Service" value={ticket.serviceName ?? "—"} />
                <Fact label="Team" value={ticket.teamName ?? "—"} />
                <Fact label="Agent" value={ticket.agentName ?? "Unassigned"} />
                <Fact label="Priority" value={ticket.priority ? priorityLabel(ticket.priority) : "—"} />
                <Fact label="TTO/TTR" value={slaLabel(ticket)} />
                <Fact
                  label="Started"
                  value={ticket.startDate ? `${ageLabel(ticket.startDate)} ago` : "—"}
                />
                <Fact label="Last update" value={`${ageLabel(ticket.lastUpdate)} ago`} />
              </div>

              <div className="mt-5 border-t border-outline-variant pt-4">
                <TicketLog
                  publicLog={ticket.publicLog}
                  privateLog={ticket.privateLog}
                  canAct={canAct}
                  onAdd={handleAddLog}
                  adding={logMutation.isPending}
                  error={logError}
                />
              </div>

              <div className="mt-5 border-t border-outline-variant pt-4">
                <TicketTimer
                  ticket={{ id: ticket.id, customerId, ref: ticket.ref }}
                  myMinutesThisWeek={ticket.myMinutesThisWeek}
                  canAct={canAct}
                />
              </div>
            </>
          )}
        </div>
      </aside>

      {actionSheet && (
        <ActionSheet
          open
          onClose={() => setActionSheet(null)}
          mode={actionSheet.mode}
          ticketRef={ticket?.ref ?? ""}
          ticketTitle={ticket?.title ?? ""}
          personName={myToken?.personName ?? null}
          teams={actionSheet.teams}
          busy={actionMutation.isPending}
          error={actionError}
          onConfirm={(fields) => runAction(actionSheet.action, fields)}
        />
      )}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="self-center font-display text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      <span className="text-on-surface">{value}</span>
    </>
  );
}
