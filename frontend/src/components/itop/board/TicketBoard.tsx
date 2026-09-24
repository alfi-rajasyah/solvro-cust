// Board view for the Tickets tab (Task 6.1, docs/archive/plans/
// itop-integration.md — mockup "5 · The Tickets tab gets a Board" in
// docs/archive/plans/itop-integration-spec.md). Renders the vendored ReUI
// Kanban engine (frontend/src/components/reui/kanban.tsx) the same way
// `kanban-v2/SolvroKanban.tsx` does — `Kanban`/`KanbanBoard`/`KanbanColumn`/
// `KanbanColumnContent`/`KanbanItem`/`KanbanOverlay`, a drag-ghost overlay,
// per-column counts — but NOT its optimistic value/onValueCommit wiring:
// this board uses the engine's `onMove` mode instead, which never applies a
// move to `value` itself (see `reui/kanban.tsx`'s `handleDragEnd`: with
// `onMove` set, an item drag calls `onMove(...)` and returns WITHOUT calling
// `setColumns`). That is exactly the "no optimistic move" contract this
// task requires: a card only ever moves once the mapped action's mutation
// succeeds and the query refetch re-renders the board with iTop's own
// answer; a rejected/forbidden/refused drop leaves the card exactly where
// dnd-kit's drag-overlay animation returns it, with nothing to roll back.
//
// `kanban-v2/adapter.ts` and `commitMapper.ts` are NOT reused here (dispatch
// note) — they're Task-shaped (TaskStatus, position/id ordering, an
// optimistic PATCH-position contract that doesn't apply to tickets at all).
// `./boardAdapter.ts` and `./dropMapper.ts` are this task's pure ticket
// equivalents.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/reui/alert";
import {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnContent,
  KanbanItem,
  KanbanOverlay,
  type KanbanMoveEvent,
} from "@/components/reui/kanban";
import { ApiError } from "@/lib/api";
import {
  useCustomerTickets,
  useItopStatus,
  useMyItopToken,
  useTicketActionFor,
  type ItopTicketActionName,
  type ItopTicketClass,
  type ItopTicketRow,
  type ItopTicketTeamOption,
} from "@/lib/queries";
import { ActionSheet, type ActionSheetMode } from "../ActionSheet";
import { teamsFromError } from "../ticketActions";
import { BOARD_COLUMNS, ticketsToColumns, type BoardColumn } from "./boardAdapter";
import { allowedTargets, mapDropToAction } from "./dropMapper";
import { TicketCard } from "./TicketCard";

const COLUMN_LABELS: Record<BoardColumn, string> = {
  new: "New",
  assigned: "Assigned",
  pending: "Pending",
  resolved: "Resolved",
  closed: "Closed",
};

interface BoardActionSheetState {
  mode: ActionSheetMode;
  ticket: ItopTicketRow;
  action: ItopTicketActionName;
  teams?: ItopTicketTeamOption[];
}

export function TicketBoard({
  customerId,
  cls,
  onOpenTicket,
}: {
  customerId: number;
  cls?: ItopTicketClass;
  /** Opens the ticket panel (`?ticket=<id>`, CustomerDetail.tsx) — same callback shape as TicketsTable's `onOpen`. */
  onOpenTicket: (id: number) => void;
}) {
  const status = useItopStatus();
  const myToken = useMyItopToken();
  const actionsEnabled = status.data?.actionsEnabled ?? false;
  const tokenSet = myToken.data?.set ?? false;
  const canAct = actionsEnabled && tokenSet;

  // Two requests total, not one per column (dispatch budget): "ongoing"
  // covers New/Assigned/Pending (plus escalated/approval-flavored variants,
  // which boardAdapter folds into Assigned); "resolved_week" is the only way
  // to populate Resolved/Closed, since "ongoing" excludes them.
  const ongoing = useCustomerTickets(customerId, { scope: "ongoing", cls, poll: true });
  const resolvedWeek = useCustomerTickets(customerId, { scope: "resolved_week", cls, poll: true });

  const tickets = useMemo(
    () => [...(ongoing.data?.tickets ?? []), ...(resolvedWeek.data?.tickets ?? [])],
    [ongoing.data, resolvedWeek.data],
  );
  const columns = useMemo(() => ticketsToColumns(tickets), [tickets]);

  const [dragFromColumn, setDragFromColumn] = useState<BoardColumn | null>(null);
  const [actionSheet, setActionSheet] = useState<BoardActionSheetState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Transient "iTop's lifecycle does not allow X -> Y" notice for a
  // forbidden drop (item 9, fix round) — cleared after ~4s or on the next
  // drag start, whichever comes first.
  const [forbiddenNotice, setForbiddenNotice] = useState<string | null>(null);
  const forbiddenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (forbiddenTimerRef.current) clearTimeout(forbiddenTimerRef.current);
    };
  }, []);

  const boardAction = useTicketActionFor(customerId);

  const getItemValue = useCallback((t: ItopTicketRow): string => String(t.id), []);

  function findColumnOf(ticketId: string): BoardColumn | null {
    return BOARD_COLUMNS.find((c) => columns[c].some((t) => String(t.id) === ticketId)) ?? null;
  }

  function showForbiddenNotice(fromColumn: BoardColumn, toColumn: BoardColumn) {
    if (forbiddenTimerRef.current) clearTimeout(forbiddenTimerRef.current);
    setForbiddenNotice(
      `iTop's lifecycle does not allow ${COLUMN_LABELS[fromColumn]} → ${COLUMN_LABELS[toColumn]}`,
    );
    forbiddenTimerRef.current = setTimeout(() => setForbiddenNotice(null), 4000);
  }

  function runAction(
    ticket: ItopTicketRow,
    action: ItopTicketActionName,
    fields?: Record<string, string | number>,
  ) {
    setActionError(null);
    boardAction.mutate(
      { ticketId: ticket.id, action, fields },
      {
        onSuccess: () => setActionSheet(null),
        onError: (err) => {
          // `assign_to_me` can come back 409 `itop_team_required` when iTop
          // needs a team alongside the agent — open the same team
          // `ActionSheet` the panel uses instead of surfacing a dead-end
          // error (item 2, fix round).
          const teams = teamsFromError(err);
          if (teams) {
            setActionSheet({ mode: "team", ticket, action, teams });
            return;
          }
          setActionError(err instanceof ApiError ? err.message : "Action failed.");
        },
      },
    );
  }

  // `onMove` (not `onValueChange`/`onValueCommit`) — see the file header for
  // why: the engine never applies this move to `columns` on its own, so a
  // forbidden or later-refused step needs no rollback, only "do nothing".
  function handleMove(event: KanbanMoveEvent) {
    const fromColumn = event.activeContainer as BoardColumn;
    const toColumn = event.overContainer as BoardColumn;
    const ticket = columns[fromColumn]?.[event.activeIndex];
    if (!ticket) return;

    const mapping = mapDropToAction(fromColumn, toColumn);
    if (!mapping) {
      // A same-column drop-in-place is a no-op, not a forbidden step — only
      // a genuine cross-column rejection gets the transient notice.
      if (fromColumn !== toColumn) showForbiddenNotice(fromColumn, toColumn);
      return;
    }

    if (mapping.needsSheet) {
      setActionSheet({ mode: mapping.needsSheet, ticket, action: mapping.action });
      return;
    }
    runAction(ticket, mapping.action);
  }

  if (ongoing.isLoading || resolvedWeek.isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-5">
        {BOARD_COLUMNS.map((c) => (
          <div
            key={c}
            className="h-48 animate-pulse rounded-sm border border-outline-variant bg-surface-container-low"
          />
        ))}
      </div>
    );
  }

  if (ongoing.isError || resolvedWeek.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load the board.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div>
      {!actionsEnabled && (
        <p className="mb-2 text-[11px] text-on-surface-variant">
          Actions from Solvro are off (Admin › iTop) — cards can&apos;t be moved here.
        </p>
      )}
      {actionsEnabled && !tokenSet && (
        <p className="mb-2 text-[11px] text-on-surface-variant">
          Add your personal iTop token in{" "}
          <Link to="/settings" className="font-semibold underline">
            Settings
          </Link>{" "}
          to move cards here.
        </p>
      )}

      {actionSheet === null && actionError && (
        <Alert variant="destructive" className="mb-3" data-testid="itop-board-error">
          <AlertDescription>iTop refused: {actionError}</AlertDescription>
        </Alert>
      )}

      {forbiddenNotice && (
        <Alert className="mb-3" data-testid="itop-board-forbidden">
          <AlertDescription>{forbiddenNotice}</AlertDescription>
        </Alert>
      )}

      <Kanban
        value={columns}
        // Required by the engine's prop shape but unreachable here: nothing
        // below renders a `KanbanColumnHandle`, so dnd-kit never attaches a
        // pointer-down listener to a column drag source — a column-reorder
        // gesture can't be initiated at all — and with `onMove` set, an item
        // drag never reaches `setColumns` either (see the file header).
        onValueChange={() => {}}
        onMove={handleMove}
        getItemValue={getItemValue}
        onDragStart={(event) => {
          setDragFromColumn(findColumnOf(String(event.active.id)));
          if (forbiddenTimerRef.current) clearTimeout(forbiddenTimerRef.current);
          setForbiddenNotice(null);
        }}
        onDragEnd={() => setDragFromColumn(null)}
        onDragCancel={() => setDragFromColumn(null)}
      >
        {/* Own layout div, `KanbanBoard` reduced to `className="contents"`
            (fix round, phase review blocker 1) — mirrors
            `kanban-v2/SolvroKanban.tsx`'s own fix for the exact same bug:
            `KanbanBoard`'s vendor default className (`grid auto-rows-fr
            gap-4 sm:grid-cols-3`, `reui/kanban.tsx`) merges with whatever
            className is passed rather than being replaced, so a plain `grid
            gap-3 md:grid-cols-5` here left `auto-rows-fr` and `sm:grid-
            cols-3` alive underneath: below 640px, `auto-rows-fr` collapsed
            every column into equal-height rows whose actual content
            overflowed and bled into the next column; at 640-767px the
            vendor's own `sm:grid-cols-3` briefly won a 3-column wrap before
            `md:grid-cols-5` (768px) took over. `KanbanBoard`'s own box is
            removed from the layout (`display: contents`), so its children
            (the column `<KanbanColumn>`s) become direct grid items of THIS
            div instead — `auto-rows-fr`/`sm:grid-cols-3` remain in the
            merged class string but are inert once their owning box no
            longer participates in layout. */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <KanbanBoard className="contents">
            {BOARD_COLUMNS.map((column) => {
              const columnTickets = columns[column];
              // No per-column "reject this drop" affordance exists on the
              // vendored engine (`KanbanColumn`'s own `disabled` prop only
              // gates that COLUMN's ability to be dragged for reordering, not
              // whether items can be dropped into it) — dimming forbidden
              // targets is therefore purely a visual cue; the actual
              // rejection happens in `handleMove` above via `mapDropToAction`
              // returning `null`.
              const isForbiddenTarget =
                dragFromColumn !== null &&
                dragFromColumn !== column &&
                !allowedTargets(dragFromColumn).includes(column);

              return (
                <KanbanColumn
                  key={column}
                  value={column}
                  className={[
                    "flex flex-col gap-2.5 rounded-xl bg-surface-container p-2 transition-opacity",
                    isForbiddenTarget ? "opacity-40" : "",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2 px-1 pb-1">
                    <h3 className="text-sm font-bold text-on-surface">{COLUMN_LABELS[column]}</h3>
                    <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[11px] font-medium text-on-surface-variant">
                      {columnTickets.length}
                    </span>
                  </div>

                  <KanbanColumnContent value={column} className="flex flex-col gap-2.5">
                    {columnTickets.map((ticket) => (
                      <KanbanItem key={ticket.id} value={getItemValue(ticket)} disabled={!canAct}>
                        <TicketCard
                          ticket={ticket}
                          canDrag={canAct}
                          onOpen={() => onOpenTicket(ticket.id)}
                          onAssignToMe={
                            canAct && column === "new"
                              ? () => runAction(ticket, "assign_to_me")
                              : undefined
                          }
                          assigning={boardAction.isPending}
                        />
                      </KanbanItem>
                    ))}

                    {columnTickets.length === 0 && (
                      <div className="rounded-lg border border-dashed border-outline-variant px-3 py-6 text-center text-[11px] text-on-surface-variant">
                        No tickets
                      </div>
                    )}
                  </KanbanColumnContent>
                </KanbanColumn>
              );
            })}
          </KanbanBoard>
        </div>

        <KanbanOverlay>
          {({ value }) => {
            const found = BOARD_COLUMNS.flatMap((c) => columns[c]).find(
              (t) => String(t.id) === String(value),
            );
            if (!found) return null;
            return (
              <KanbanItem value={getItemValue(found)}>
                <TicketCard ticket={found} canDrag dragging onOpen={() => {}} />
              </KanbanItem>
            );
          }}
        </KanbanOverlay>
      </Kanban>

      {actionSheet && (
        <ActionSheet
          open
          onClose={() => {
            setActionSheet(null);
            setActionError(null);
          }}
          mode={actionSheet.mode}
          ticketRef={actionSheet.ticket.ref}
          ticketTitle={actionSheet.ticket.title}
          personName={myToken.data?.personName ?? null}
          teams={actionSheet.teams}
          busy={boardAction.isPending}
          error={actionError}
          onConfirm={(fields) => runAction(actionSheet.ticket, actionSheet.action, fields)}
        />
      )}
    </div>
  );
}
