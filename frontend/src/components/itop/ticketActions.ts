// Pure display/logic helpers for the ticket panel and its action sheet
// (Task 5.4, docs/archive/plans/itop-integration.md). Kept dependency-free
// (no React, no query hooks) so TicketPanel.tsx / ActionSheet.tsx and this
// module's own vitest unit test share one source of truth, same convention
// as the sibling ticketPresentation.ts.
import { ApiError } from "@/lib/api";
import type { ItopTicketActionName, ItopTicketTeamOption } from "@/lib/queries";

// iTop's default resolution codes (docs/archive/plans/itop-integration-spec.md
// screen 5's "Resolution code" select) — an install with custom codes would
// need this list extended, but there's no API to read it from iTop itself
// (see docs/archive/plans/itop-integration.md's risk table on item 10).
export const RESOLUTION_CODES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "assistance", label: "Assistance" },
  { value: "bug fixed", label: "Bug fixed" },
  { value: "hardware repair", label: "Hardware repair" },
  { value: "software patch", label: "Software patch" },
  { value: "system update", label: "System update" },
  { value: "training", label: "Training" },
  { value: "other", label: "Other" },
];

const ACTION_LABEL: Record<ItopTicketActionName, string> = {
  assign_to_me: "Assign to me",
  pending: "Pending",
  resolve: "Resolve",
  close: "Close",
  reopen: "Reopen",
};

/** Human label for a lifecycle action button. */
export function actionLabel(action: ItopTicketActionName): string {
  return ACTION_LABEL[action];
}

// Buttons offered per current ticket status, per
// docs/archive/plans/itop-integration-spec.md screen 6's button row and the
// dispatch's acceptance table. `escalated_tto`/`escalated_ttr`
// (ticketPresentation.ts's own separate status labels/tones for SLA-breach
// display) are still assigned tickets underneath — iTop's escalation is a
// display flavor of `assigned`, not a distinct lifecycle state — so they
// carry the same action set as `assigned` (fix round, phase review).
//
// `pending` offers `assign_to_me` again (fix round, 2026-09-24, against a
// real iTop 3.2.2 install): the Phase 6 assumption that iTop's default
// lifecycle only wires `ev_assign` from `new` (2026-09-23) was wrong — a real
// install confirmed `ev_assign` is also valid from `pending`. The plan's
// deviation 11 is corrected accordingly; `dropMapper.ts`'s board-column
// graph restores the matching `pending -> assigned` transition.
const AVAILABLE_BY_STATUS: Record<string, ItopTicketActionName[]> = {
  new: ["assign_to_me"],
  assigned: ["pending", "resolve"],
  escalated_tto: ["pending", "resolve"],
  escalated_ttr: ["pending", "resolve"],
  pending: ["assign_to_me", "resolve"],
  resolved: ["close", "reopen"],
  closed: [],
};

/** Lifecycle action buttons available for a ticket's current status. */
export function availableActions(status: string): ItopTicketActionName[] {
  return AVAILABLE_BY_STATUS[status] ?? [];
}

/**
 * Extracts the team options from a 409 `itop_team_required` refusal — the
 * shape iTop's `assign_to_me` (`ev_assign`) refuses with when it needs both
 * a team AND an agent for that step but only got the agent. `null` for any
 * other error (a different 409, a different status code, or a non-ApiError
 * throw), so callers can treat "not a team-required refusal" and "team
 * options missing from an otherwise-matching refusal" the same way: fall
 * through to the plain error message.
 *
 * Extracted (fix round, phase review) from `TicketPanel.tsx`'s own inline
 * check so `TicketBoard.tsx` and `DailyItopStrip.tsx` — which also fire
 * `assign_to_me` and need to open the same team `ActionSheet` on this exact
 * refusal — share one source of truth instead of three copies of the same
 * `err.body` shape-check.
 */
export function teamsFromError(err: unknown): ItopTicketTeamOption[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as
    | { code?: string; details?: { teams?: ItopTicketTeamOption[] } }
    | null;
  if (body?.code === "itop_team_required" && body.details?.teams) {
    return body.details.teams;
  }
  return null;
}
