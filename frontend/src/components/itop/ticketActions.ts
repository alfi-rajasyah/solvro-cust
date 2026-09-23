// Pure display/logic helpers for the ticket panel and its action sheet
// (Task 5.4, docs/archive/plans/itop-integration.md). Kept dependency-free
// (no React, no query hooks) so TicketPanel.tsx / ActionSheet.tsx and this
// module's own vitest unit test share one source of truth, same convention
// as the sibling ticketPresentation.ts.
import type { ItopTicketActionName } from "@/lib/queries";

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
const AVAILABLE_BY_STATUS: Record<string, ItopTicketActionName[]> = {
  new: ["assign_to_me"],
  assigned: ["pending", "resolve"],
  escalated_tto: ["pending", "resolve"],
  escalated_ttr: ["pending", "resolve"],
  pending: ["resolve", "assign_to_me"],
  resolved: ["close", "reopen"],
  closed: [],
};

/** Lifecycle action buttons available for a ticket's current status. */
export function availableActions(status: string): ItopTicketActionName[] {
  return AVAILABLE_BY_STATUS[status] ?? [];
}
