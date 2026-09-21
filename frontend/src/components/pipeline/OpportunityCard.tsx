// Board card — PRD §2.3's "Card anatomy", restyled from Velora's card.tsx
// (../VeloraApp/components/kanban/card.tsx, read-only reference) onto
// Technical Precision tokens. Presentational only, same split as
// kanban-v2/cards.tsx's TaskCard: the parent (SolvroPipelineKanban.tsx)
// wraps this in the vendored engine's `<KanbanItem>`, this component owns
// only the card body + the `KanbanItemHandle` drag grip.
//
// No StageChip here by design (PRD §2.3: the column already says the
// stage) — `dispatch brief point 2` confirms this explicitly.
import { Link } from "react-router-dom";
import { AssigneeAvatar } from "@/components/AssigneeAvatar";
import { KanbanItemHandle } from "@/components/reui/kanban";
import { Chip } from "@/components/StatusChip";
import { formatIDRCompact, formatPipelineDate, formatWinProbability, STAGE_LABELS } from "@/lib/pipelineFormat";
import type { Opportunity } from "@/lib/queries";
import { isDealOverdue, probabilityTone } from "./kpi";

export interface OpportunityCardProps {
  deal: Opportunity;
  canDrag: boolean;
  // Ghost-in-KanbanOverlay treatment (M4 in kanban-v2's SolvroKanban.tsx) —
  // true only for the drag overlay's copy of this card, never a card sitting
  // in its normal column position.
  dragging?: boolean;
  // Card click -> `/pipeline/:id` (PRD §2.3, OpportunityDetail/M3.16).
  // Wired by each call site (SolvroPipelineKanban.tsx's board cards,
  // PipelineQuarter.tsx's cells — M3 integration); the KanbanOverlay ghost
  // copy in SolvroPipelineKanban.tsx deliberately omits it, same as
  // kanban-v2/SolvroKanban.tsx's overlay TaskCard never gets an onClick
  // either. Optional so this component still renders standalone.
  onClick?: () => void;
}

export function OpportunityCard({ deal, canDrag, dragging = false, onClick }: OpportunityCardProps) {
  const overdue = isDealOverdue(deal.deadline);

  // stopPropagation mirrors kanban-v2/cards.tsx's TaskCard.handleClick
  // exactly — click-vs-drag separation is actually handled upstream by the
  // vendored engine's pointer-movement activation constraint (reui/
  // kanban.tsx's `MOUSE_SENSOR_OPTIONS`, distance: 10), not by this
  // stopPropagation; this just keeps a card click from bubbling to any
  // ancestor click handler (the column, the board scroll container).
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    onClick?.();
  }

  return (
    <div
      onClick={handleClick}
      className={[
        "touch-manipulation rounded-sm border bg-surface-container-lowest p-3 transition-colors",
        onClick ? "cursor-pointer" : "",
        dragging
          ? "rotate-[-1.2deg] border-[1.5px] border-primary shadow-overlay ring-2 ring-primary"
          : "border-outline-variant hover:border-primary",
      ].join(" ")}
    >
      {/* Title + drag handle + win% */}
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          {canDrag && (
            <KanbanItemHandle
              aria-label="Drag to reorder"
              className="mt-0.5 inline-flex shrink-0 touch-none items-center text-on-surface-variant/60"
            >
              <span className="material-symbols-outlined text-[16px]">drag_indicator</span>
            </KanbanItemHandle>
          )}
          {/* Title as a real `<Link>` — keyboard/screen-reader route to the
              detail page (the card's own `onClick`, below, isn't reachable
              via Tab). `stopPropagation` keeps the click from also bubbling
              to the card's `handleClick` and double-navigating; the card
              click stays the mouse affordance. Unobtrusive styling — same
              ink color as before, `hover:text-primary` only as an extra
              affordance the card's own `hover:border-primary` doesn't
              provide for keyboard focus. */}
          <Link
            to={`/pipeline/${deal.id}`}
            onClick={(e) => e.stopPropagation()}
            className="line-clamp-2 min-w-0 rounded-sm text-sm font-semibold leading-tight text-on-surface hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {deal.title}
          </Link>
        </div>
        <div className="shrink-0">
          <Chip tone={probabilityTone(deal.winProbability)}>{formatWinProbability(deal.winProbability)}</Chip>
        </div>
      </div>

      {/* Customer + deal value */}
      <p className="mb-0.5 truncate text-xs text-on-surface-variant">{deal.customerName}</p>
      <p className="mb-2 text-data-mono text-primary">{formatIDRCompact(deal.dealValue)}</p>

      {/* PIC + deadline row */}
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-on-surface-variant">
        <span className="flex min-w-0 items-center gap-1.5">
          <AssigneeAvatar user={deal.pic} size="xs" />
          <span className="truncate">{deal.pic?.username ?? "Unassigned"}</span>
        </span>
        {deal.deadline && (
          <span
            className={[
              "flex shrink-0 items-center gap-1",
              overdue ? "font-semibold text-chip-rose-text" : "",
            ].join(" ")}
          >
            <span className="material-symbols-outlined text-[14px]">event</span>
            {formatPipelineDate(deal.deadline)}
          </span>
        )}
      </div>

      {/* Product/solution, truncated */}
      {deal.productSolution && (
        <p className="truncate text-[11px] text-on-surface-variant">{deal.productSolution}</p>
      )}

      {/* Held-from cue — PRD §2.3: "pause_circle + 'held from {pre_hold_stage label}'" */}
      {deal.stage === "HOLD" && deal.preHoldStage && (
        <div className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-chip-amber-text">
          <span className="material-symbols-outlined text-[13px]">pause_circle</span>
          Held from {STAGE_LABELS[deal.preHoldStage]}
        </div>
      )}
    </div>
  );
}
