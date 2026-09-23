// Pure drag-drop -> iTop lifecycle action mapper for the Board view (Task
// 6.1, docs/archive/plans/itop-integration.md). Dependency-free (no React,
// no dnd-kit, no query hooks) so `TicketBoard.tsx` and this module's own
// vitest unit test share one source of truth — same convention as
// `boardAdapter.ts` and `ticketPresentation.ts`.
//
// The transition graph below is iTop's DEFAULT UserRequest/Incident
// lifecycle (docs/archive/plans/itop-integration.md §1 decision 10), expressed as
// board-column-to-column moves rather than iTop's own state names — a drag
// is a UI gesture between two board columns, and `boardAdapter.ts` already
// folds several iTop statuses (escalated_*, waiting_for_approval, approved,
// rejected) into `assigned`, so the column graph is the right level to
// define "which moves are allowed" at.
import type { BoardColumn } from "./boardAdapter";
import type { ItopTicketActionName } from "@/lib/queries";

export interface DropMapping {
  action: ItopTicketActionName;
  /** "resolve" when iTop demands mandatory fields (resolution code +
   * solution) before this step can go through — the caller must open the
   * shared `ActionSheet` instead of firing the action directly. */
  needsSheet: "resolve" | null;
}

// Keyed "from>to" — every entry is one iTop stimulus a drag can trigger.
// Anything not listed here (including any same-column "move") is forbidden.
//
// `pending>assigned` is deliberately ABSENT (Phase 6 fix round, 2026-09-23):
// iTop's default lifecycle only wires `ev_assign` (assign_to_me) from `new`,
// never from `pending` — the user's own decision (docs/archive/plans/
// itop-integration.md §1 item 10) is "iTop defaults", and the fake iTop the
// test suite runs against only accepts `ev_assign` from `new`. A `pending`
// ticket can only move on by `resolve`. `ticketActions.ts`'s
// `AVAILABLE_BY_STATUS.pending` drops `assign_to_me` for the same reason.
const TRANSITIONS: Partial<Record<string, DropMapping>> = {
  "new>assigned": { action: "assign_to_me", needsSheet: null },
  "assigned>pending": { action: "pending", needsSheet: null },
  "assigned>resolved": { action: "resolve", needsSheet: "resolve" },
  "pending>resolved": { action: "resolve", needsSheet: "resolve" },
  "resolved>closed": { action: "close", needsSheet: null },
  "resolved>assigned": { action: "reopen", needsSheet: null },
};

function key(from: BoardColumn, to: BoardColumn): string {
  return `${from}>${to}`;
}

/** The iTop action (and whether it needs the mandatory-fields sheet) a drag
 * from `fromColumn` to `toColumn` should fire, or `null` when iTop's
 * lifecycle forbids that step — the caller must reject the drop. */
export function mapDropToAction(fromColumn: BoardColumn, toColumn: BoardColumn): DropMapping | null {
  if (fromColumn === toColumn) return null;
  return TRANSITIONS[key(fromColumn, toColumn)] ?? null;
}

/** Every column a card in `fromColumn` may legally be dropped into — used to
 * dim forbidden columns while a drag from `fromColumn` is in progress. */
export function allowedTargets(fromColumn: BoardColumn): BoardColumn[] {
  const prefix = `${fromColumn}>`;
  const targets: BoardColumn[] = [];
  for (const k of Object.keys(TRANSITIONS)) {
    if (k.startsWith(prefix)) targets.push(k.slice(prefix.length) as BoardColumn);
  }
  return targets;
}
