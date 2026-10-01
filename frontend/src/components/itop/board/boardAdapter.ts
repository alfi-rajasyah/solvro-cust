// Pure ticket->columns projection for the Tickets tab's Board view (Task
// 6.1, docs/archive/plans/itop-integration.md). Deliberately its own module,
// not a reuse of `kanban-v2/adapter.ts` — that file's `KANBAN_STATUSES`/
// `projectToColumns` are Task-shaped (TaskStatus, position/id ordering) and
// out of scope to touch or import from for tickets (see this task's dispatch
// note). Kept dependency-free (no React, no query hooks, no dnd-kit) so
// `TicketBoard.tsx` and this module's own vitest unit test share one source
// of truth — same convention as the sibling `ticketPresentation.ts`.
import type { ItopTicketRow } from "@/lib/queries";
import { statusLabel } from "../ticketPresentation";

// iTop's default UserRequest/Incident lifecycle folded into 5 board columns
// (docs/archive/plans/itop-integration.md decision 10 + this task's dispatch note).
// Always present, in this order, empty arrays allowed — the Kanban engine
// must never see a missing column key.
export type BoardColumn = "new" | "assigned" | "pending" | "resolved" | "closed";

export const BOARD_COLUMNS: readonly BoardColumn[] = [
  "new",
  "assigned",
  "pending",
  "resolved",
  "closed",
];

// Escalation is a display flavor of `assigned`, never its own column (per the
// dispatch note and `ticketActions.ts`'s own `AVAILABLE_BY_STATUS`, which
// gives escalated tickets the same action set as plain `assigned`).
const ESCALATED_STATUSES = new Set(["escalated_tto", "escalated_ttr"]);

// Every status not listed here (approval workflow states — waiting_for_
// approval/approved/rejected — or any future/unrecognized status) falls
// back to `assigned` via `columnForStatus`'s default below, and gets the
// muted "iTop: <status>" chip from `foldedStatusLabel`.
const STATUS_TO_COLUMN: Partial<Record<string, BoardColumn>> = {
  new: "new",
  assigned: "assigned",
  pending: "pending",
  resolved: "resolved",
  closed: "closed",
};

/** True for `escalated_tto`/`escalated_ttr` — shown as a red chip on the card, never a column. */
export function isEscalated(ticket: Pick<ItopTicketRow, "status">): boolean {
  return ESCALATED_STATUSES.has(ticket.status);
}

function columnForStatus(status: string): BoardColumn {
  if (ESCALATED_STATUSES.has(status)) return "assigned";
  return STATUS_TO_COLUMN[status] ?? "assigned";
}

/**
 * Muted "iTop: <status>" chip text for a ticket folded into `assigned`
 * without a dedicated column of its own — `waiting_for_approval`/`approved`/
 * `rejected`, or any future/unrecognized status. `null` for a genuine
 * `assigned` ticket (escalated or not), whose card already carries the
 * escalation chip or nothing extra.
 */
export function foldedStatusLabel(ticket: Pick<ItopTicketRow, "status">): string | null {
  if (columnForStatus(ticket.status) !== "assigned") return null;
  if (ticket.status === "assigned" || isEscalated(ticket)) return null;
  return `iTop: ${statusLabel(ticket.status).toLowerCase()}`;
}

/** True when a card should sort to the front of its column — an SLA breach
 * or an escalated status both read as "most urgent", same tone rule
 * `ticketPresentation.ts`'s `statusTone` already applies to these tickets. */
function isBreached(ticket: ItopTicketRow): boolean {
  return ticket.slaTtrPassed || ticket.slaTtoPassed || isEscalated(ticket);
}

function compareBoardTickets(a: ItopTicketRow, b: ItopTicketRow): number {
  const ab = isBreached(a) ? 0 : 1;
  const bb = isBreached(b) ? 0 : 1;
  if (ab !== bb) return ab - bb;
  return new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime();
}

/**
 * Tickets -> board columns. `tickets` is expected to be the union of the
 * "ongoing" and "resolved_week" scope fetches (`TicketBoard.tsx` makes both
 * calls) — a ticket appearing in both (shouldn't normally happen, since
 * "ongoing" excludes resolved/closed tickets, but the two scopes are
 * independent fetches with no shared cache-consistency guarantee) is
 * deduplicated by id, last occurrence wins.
 */
export function ticketsToColumns(tickets: ItopTicketRow[]): Record<BoardColumn, ItopTicketRow[]> {
  const byId = new Map<number, ItopTicketRow>();
  for (const ticket of tickets) byId.set(ticket.id, ticket);

  const columns: Record<BoardColumn, ItopTicketRow[]> = {
    new: [],
    assigned: [],
    pending: [],
    resolved: [],
    closed: [],
  };
  for (const ticket of byId.values()) {
    columns[columnForStatus(ticket.status)].push(ticket);
  }
  for (const column of BOARD_COLUMNS) {
    columns[column].sort(compareBoardTickets);
  }
  return columns;
}
