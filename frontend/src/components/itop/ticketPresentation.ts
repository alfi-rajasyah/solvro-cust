// Pure display helpers for the Customer Tickets tab (Task 1.8): status
// label/tone mapping, SLA/age copy, and the "Open in iTop" link builder.
// Kept dependency-free (no React, no query hooks) so TicketsTable.tsx and
// this module's own vitest unit test share one source of truth. See
// docs/archive/plans/itop-integration.md Task 1.8 and
// docs/archive/plans/itop-integration-spec.md's Tickets tab mockup for the
// exact copy this is reproducing ("TTR breached", "Paused", "TTR 3 h left",
// "2 d" / "5 h" / "40 min").
import type { ItopTicketRow } from "@/lib/queries";

// Matches StatusChip.tsx's private `Tone` union structurally (that type
// isn't exported) — every literal here is one `Chip` already accepts.
export type TicketTone = "emerald" | "amber" | "rose" | "violet" | "blue" | "gray";

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  assigned: "Assigned",
  pending: "Pending",
  escalated_tto: "Escalated TTO",
  escalated_ttr: "Escalated TTR",
  waiting_for_approval: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
  resolved: "Resolved",
  closed: "Closed",
};

/** Humanized status text. An unknown status (a value Solvro doesn't map yet,
 * or a future iTop lifecycle state) falls back to the raw string rather than
 * throwing — the tab should degrade gracefully, not blank out a row. */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

type ToneTicket = Pick<ItopTicketRow, "status" | "slaTtrPassed">;

/**
 * Tone for the status chip. A TTR breach or an `escalated_*` status both
 * read as "danger" (rose) regardless of which one triggered it — a
 * `pending` ticket that's also `slaTtrPassed` is still the most urgent row
 * on the page. Unknown statuses fall back to `gray`, matching
 * `statusLabel`'s pass-through behavior.
 */
export function statusTone(ticket: ToneTicket): TicketTone {
  if (ticket.slaTtrPassed || ticket.status === "escalated_tto" || ticket.status === "escalated_ttr") {
    return "rose";
  }
  if (ticket.status === "pending" || ticket.status === "waiting_for_approval") {
    return "amber";
  }
  if (ticket.status === "resolved" || ticket.status === "closed") {
    return "gray";
  }
  if (ticket.status === "new") return "blue";
  if (ticket.status === "assigned") return "violet";
  if (ticket.status === "approved") return "emerald";
  if (ticket.status === "rejected") return "rose";
  return "gray";
}

function unit(n: number, label: string): string {
  return `${n} ${label}`;
}

/** "2 d" / "5 h" / "40 min" — largest whole unit only, per the mockup's Age
 * column. Never negative: a `startDate` briefly in the future (e.g. clock
 * skew right after a sync) reads as "0 min" rather than a negative age.
 * Renders "—" for a missing or unparseable `startDate` (the field is
 * nullable — see `ItopTicketRow.startDate`) rather than "NaN d" or a
 * garbage `new Date(null)` epoch-1970 age. */
export function ageLabel(startDate: string | null, now: Date = new Date()): string {
  if (!startDate) return "—";
  const then = new Date(startDate).getTime();
  if (Number.isNaN(then)) return "—";
  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60_000));
  if (minutes < 60) return unit(minutes, "min");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, "h");
  const days = Math.floor(hours / 24);
  return unit(days, "d");
}

function durationLeft(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return unit(minutes, "min");
  if (minutes === 0) return unit(hours, "h");
  return `${hours} h ${minutes} min`;
}

type SlaTicket = Pick<ItopTicketRow, "status" | "slaTtoPassed" | "slaTtrPassed" | "ttr">;

/**
 * SLA column copy, in priority order: an already-breached TTR wins over a
 * breached TTO; `pending` pauses both clocks in iTop, so it reads as
 * "Paused" rather than a stale countdown; otherwise the time left until
 * `ttr` if it's still in the future; "—" once nothing is left to say (no
 * `ttr` snapshot, or `ttr` has already elapsed but the SLA-passed flags
 * haven't caught up with the next sync yet).
 */
export function slaLabel(ticket: SlaTicket, now: Date = new Date()): string {
  if (ticket.slaTtrPassed) return "TTR breached";
  if (ticket.slaTtoPassed) return "TTO breached";
  if (ticket.status === "pending") return "Paused";
  if (!ticket.ttr) return "—";
  const diffMs = new Date(ticket.ttr).getTime() - now.getTime();
  if (diffMs <= 0) return "—";
  return `TTR ${durationLeft(diffMs)} left`;
}

type UrlTicket = Pick<ItopTicketRow, "id" | "class">;

/** Builds the "Open in iTop ↗" deep link. Trailing slash(es) on `baseUrl`
 * are stripped so the URL never doubles up
 * (`https://itop.test//pages/...`). */
export function itopTicketUrl(baseUrl: string, ticket: UrlTicket): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/pages/UI.php?operation=details&class=${ticket.class}&id=${ticket.id}`;
}
