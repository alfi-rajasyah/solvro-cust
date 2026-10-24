// Board card (Task 6.1, docs/archive/plans/itop-integration.md). Structural
// precedent is `kanban-v2/cards.tsx`'s `TaskCard`: a `KanbanItemHandle` is
// the only real drag activator (dnd-kit listeners reach it via the
// enclosing `<KanbanItem>`'s context) so the card body's own onClick can
// stay a plain "open the panel" gesture without fighting the drag sensor.
import type { MouseEvent } from "react";
import { Chip } from "@/components/StatusChip";
import { KanbanItemHandle } from "@/components/reui/kanban";
import type { ItopTicketRow } from "@/lib/queries";
import { foldedStatusLabel, isEscalated } from "./boardAdapter";
import { ageLabel, slaLabel } from "../ticketPresentation";

const CLASS_LABEL: Record<string, string> = {
  UserRequest: "User request",
  Incident: "Incident",
};

export function TicketCard({
  ticket,
  canDrag,
  dragging = false,
  onOpen,
  onAssignToMe,
  assigning = false,
}: {
  ticket: ItopTicketRow;
  canDrag: boolean;
  /** True only for the ghost rendered inside `KanbanOverlay` — never for a
   * card in its normal column position (same convention as
   * `kanban-v2/cards.tsx`'s `TaskCard`). */
  dragging?: boolean;
  onOpen: () => void;
  /** "Assign to me" quick button — the caller only passes this for cards in
   * the `new` column. */
  onAssignToMe?: () => void;
  assigning?: boolean;
}) {
  const folded = foldedStatusLabel(ticket);
  const escalated = isEscalated(ticket);

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    onOpen();
  }

  return (
    <div
      data-testid="itop-board-card"
      data-ref={ticket.ref}
      onClick={handleClick}
      className={[
        "cursor-pointer touch-manipulation rounded-sm border bg-surface-container-lowest p-3 transition-colors",
        dragging
          ? "rotate-[-1.2deg] border-[1.5px] border-primary shadow-overlay ring-2 ring-primary"
          : "border-outline-variant hover:border-primary",
      ].join(" ")}
    >
      <div className="mb-1 flex items-center gap-1.5">
        {canDrag && (
          <KanbanItemHandle
            // Pointer and touch only (it cannot take focus), so it is hidden from
            // assistive tech; the label stays for tests and hover tooling.
            aria-hidden="true"
            aria-label="Drag ticket"
            className="inline-flex shrink-0 touch-none items-center text-on-surface-variant/60"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">drag_indicator</span>
          </KanbanItemHandle>
        )}
        <span className="font-mono text-[12px] font-semibold text-on-surface">{ticket.ref}</span>
        <span className="flex-1" />
        {escalated && <Chip tone="rose">Escalated</Chip>}
        {folded && (
          <span className="whitespace-nowrap rounded-sm bg-surface-container-high px-1.5 py-0.5 text-meta font-semibold text-on-surface-variant">
            {folded}
          </span>
        )}
      </div>

      {/* The title is the card's keyboard entry point: a button with no
          handler of its own, so Enter/Space click it and the click bubbles to
          the card's onClick (same pattern as kanban-v2/cards.tsx). The
          drag-overlay ghost keeps a plain paragraph, so it adds no tab stop. */}
      {dragging ? (
        <p className="text-[13px] font-bold leading-snug text-on-surface">
          <span className="line-clamp-2">{ticket.title}</span>
        </p>
      ) : (
        <button
          type="button"
          className="block w-full rounded-sm text-left text-[13px] font-bold leading-snug text-on-surface outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <span className="line-clamp-2">{ticket.title}</span>
        </button>
      )}

      <div className="mt-1.5 flex items-center justify-between gap-2 text-meta text-on-surface-variant">
        <span className="truncate">
          {CLASS_LABEL[ticket.class] ?? ticket.class} · {ticket.agentName ?? "Unassigned"}
        </span>
        <span className="shrink-0 font-mono">
          {ageLabel(ticket.startDate)} · {slaLabel(ticket)}
        </span>
      </div>

      {onAssignToMe && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAssignToMe();
          }}
          disabled={assigning}
          className="mt-2 rounded-sm border border-outline-variant px-2 py-1 font-display text-xs font-semibold text-on-surface hover:border-primary hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          Assign to me
        </button>
      )}
    </div>
  );
}
