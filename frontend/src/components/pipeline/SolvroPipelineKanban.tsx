// SolvroPipelineKanban — the Pipeline board container, composed the same
// way frontend/src/components/kanban-v2/SolvroKanban.tsx composes the
// vendored ReUI Kanban engine (frontend/src/components/reui/kanban.tsx)
// over its adapter.ts projection: a live local projection is authoritative
// during a drag (query-derived updates frozen), and onValueCommit routes
// through commitMapper.ts into the optimistic useMoveOpportunity write path.
// Scoped to the Pipeline module's 9 PipelineStage columns instead of the
// task board's 3 TaskStatus columns — see pipeline/adapter.ts's header for
// the field-by-field mapping between the two.
//
// Layout deviates from kanban-v2's dual "3-col grid on desktop / swipeable
// single-column pager on mobile" in one deliberate way: kanban-v2's mobile
// pager exists to solve "3 columns fit a desktop grid but not a phone
// viewport" — a problem Pipeline's 9 columns never has at ANY viewport
// width, desktop included (the PRD's own §2.3 mockup literally labels the
// board row "horizontal scroll"). So this container uses ONE responsive
// horizontal-scroll row at every breakpoint (columns narrow to ~85vw below
// `sm:`) instead of porting the IntersectionObserver/chevron/dot pager,
// which would solve a layout problem this board doesn't have. See this
// task's report for the full rationale.
//
// M3 integration (view switcher + KPI hoist): `PipelineKpiBar` no longer
// mounts here — Pipeline.tsx now renders ONE instance above whichever view
// is active (PRD §2.4: "shared toolbar and KPI bar stay mounted across
// views"). The funnel strip's per-stage scroll-to-column only makes sense
// against this board's columns, so this component exposes `scrollToStage`
// via `forwardRef`/`useImperativeHandle` for Pipeline.tsx to call; the ref
// is naturally `null` whenever a different view is mounted, which is what
// makes that scroll a no-op outside the Kanban view (see the handle's doc
// comment below). `onCreateOpportunity` wires the empty-state "+
// Opportunity" CTA (PRD §2.11) to the same OpportunityFormModal instance
// Pipeline.tsx's header CTA opens. Card clicks now navigate to
// `/pipeline/:id` (OpportunityDetail, M3.16) — the click-vs-drag guard is
// OpportunityCard's own `stopPropagation` wrapper, mirroring
// kanban-v2/cards.tsx's `TaskCard.handleClick` precedent exactly; the
// vendored engine's own 10px pointer-movement `activationConstraint`
// (reui/kanban.tsx's `MOUSE_SENSOR_OPTIONS`) is what keeps a real drag from
// ever registering as a click in the first place.
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmModal } from "@/components/ConfirmModal";
import { HandoffProjectModal } from "@/components/DealCard";
import { Alert, AlertAction, AlertDescription } from "@/components/reui/alert";
import {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnContent,
  KanbanItem,
  KanbanOverlay,
  type KanbanCommitMeta,
} from "@/components/reui/kanban";
import { hasPermission, useAuth } from "@/lib/auth";
import { formatIDRCompact, STAGE_LABELS, type PipelineStage } from "@/lib/pipelineFormat";
import { useMoveOpportunity, useOpportunities, type Opportunity } from "@/lib/queries";
import { PIPELINE_STAGES, projectToColumns } from "./adapter";
import { canDragDeal, needsTerminalConfirm } from "./boardLogic";
import { mapCommitToMove, type OpportunityMovePayload } from "./commitMapper";
import { OpportunityCard } from "./OpportunityCard";

type Columns = Record<PipelineStage, Opportunity[]>;

interface PendingMove {
  payload: OpportunityMovePayload;
  deal: Opportunity;
}

/**
 * Imperative handle exposed to Pipeline.tsx's hoisted KPI funnel strip
 * (M3 integration). Deliberately minimal — one method, the one thing a
 * parent that doesn't own this board's DOM needs to trigger.
 */
export interface SolvroPipelineKanbanHandle {
  scrollToStage: (stage: PipelineStage) => void;
}

export interface SolvroPipelineKanbanProps {
  /**
   * Wired by Pipeline.tsx (M3 integration) so the board's empty state (PRD
   * §2.11: "board with zero deals → centered empty state with '+
   * Opportunity' CTA") opens the same OpportunityFormModal instance as the
   * page header's own CTA. `undefined` when the caller has no
   * pipeline:create permission — EmptyBoardState then renders no button at
   * all, the same optional-prop-omits-affordance convention
   * OpportunityCard's `onClick` already uses.
   */
  onCreateOpportunity?: () => void;
}

export const SolvroPipelineKanban = forwardRef<SolvroPipelineKanbanHandle, SolvroPipelineKanbanProps>(
  function SolvroPipelineKanban({ onCreateOpportunity }, ref) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { data: deals, isLoading, isError, error } = useOpportunities();
    const moveOpportunity = useMoveOpportunity();

    // Drag-live local projection (Architecture Decision 5, kanban-v2): `null`
    // when not dragging (columns derive from query data), during a live drag
    // this holds the vendor's own live-preview arrangement.
    const [liveColumns, setLiveColumns] = useState<Columns | null>(null);
    // Ref, not state, so the write is synchronous within the same call stack
    // — see kanban-v2/SolvroKanban.tsx's handleValueChange doc for the
    // "permanent freeze" bug this guards against.
    const isDraggingRef = useRef(false);

    const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
    // Local to the confirm flow (finding N6) — NOT `moveOpportunity.isPending`,
    // which reflects ANY in-flight move (including a concurrent optimistic
    // drag on a different card), not specifically this confirm dialog's own
    // pending `mutateAsync` call.
    const [isConfirming, setIsConfirming] = useState(false);

    // Post-won handoff offer (PRD §2.10, M5.24) — mirrors
    // OpportunityDetail.tsx's own `justWonOffer`/`handoffOpen` pair, scoped
    // per-deal here since the board can win any card, not just "the" one.
    // `justWonDeal` drives the transient inline Alert; `handoffDeal` drives
    // the modal — kept separate so dismissing the banner (clearing
    // `justWonDeal`) never closes an already-open modal, and so opening the
    // modal clears the banner (see the Alert's own action button below).
    const [justWonDeal, setJustWonDeal] = useState<Opportunity | null>(null);
    const [handoffDeal, setHandoffDeal] = useState<Opportunity | null>(null);

    const columnRefs = useRef<Partial<Record<PipelineStage, HTMLDivElement | null>>>({});

    // No `as Columns` cast (finding S3): `projectToColumns` is generic over
    // `T extends PipelineBoardDeal` now, so calling it with `Opportunity[]`
    // already infers `Record<PipelineStage, Opportunity[]>`.
    const derivedColumns = useMemo(() => projectToColumns(deals ?? []), [deals]);
    const columns = liveColumns ?? derivedColumns;

    const getItemValue = useCallback((deal: Opportunity): string => deal.id, []);

    function handleValueChange(next: Record<string, Opportunity[]>) {
      if (!isDraggingRef.current) return;
      setLiveColumns(next as Columns);
    }

    function handleDragStart() {
      isDraggingRef.current = true;
      setLiveColumns(derivedColumns);
    }

    function handleDragEnd() {
      isDraggingRef.current = false;
      setLiveColumns(null);
    }

    function handleDragCancel() {
      isDraggingRef.current = false;
      setLiveColumns(null);
    }

    // Commit -> mapper -> either the optimistic write path, or (WON/DROP entry
    // only) a confirm gate first. `null` from the mapper (no-op guards:
    // drop-in-place, cancelled drag, unchanged arrangement) means no request
    // at all.
    function handleValueCommit(committedValue: Record<string, Opportunity[]>, meta: KanbanCommitMeta<Opportunity>) {
      const payload = mapCommitToMove(committedValue, meta);
      if (!payload) return;

      // Hoisted above the terminal-confirm check (finding N7): the deal
      // itself — specifically its OWN pre-drag `stage` field, read straight
      // off the query-cache-sourced object the vendor engine repositions but
      // never mutates — is the authoritative source for "what stage is this
      // move coming FROM", not `meta.activeContainer`. Fail-closed: if the
      // moved deal can't be found at its committed position, bail without
      // firing any request rather than guessing.
      const deal = committedValue[payload.stage]?.[meta.overIndex];
      if (!deal) return;

      if (needsTerminalConfirm(payload.stage, deal.stage)) {
        // Deliberately NOT calling moveOpportunity.mutate() here — the
        // optimistic onMutate write must not fire until the user confirms.
        // handleDragEnd (above) has already nulled liveColumns by the time
        // this runs (the vendor engine calls onDragEnd before onValueCommit —
        // see reui/kanban.tsx's handleDragEnd), so without intervention
        // `columns` would already be back to `derivedColumns` — the pre-drag,
        // query-derived arrangement — and the card would visually snap back
        // to its origin column for the duration the confirm dialog is open.
        // Freezing the just-committed arrangement back into `liveColumns`
        // here (finding S2) keeps the card resting where it was dropped
        // instead, closer to what actually happens once the user confirms.
        // Safe from `handleValueChange` clobbering this write afterward: it
        // early-returns once `isDraggingRef.current` is false (set by
        // `handleDragEnd`, which fires before this commit handler runs).
        // Cleared back to `null` in `handleConfirmMove`'s `finally` and the
        // modal's cancel path below, so both confirming (the list gets
        // invalidated/rolled back either way) and cancelling (nothing was
        // ever written) fall back to the query-derived arrangement rather
        // than staying frozen on this snapshot.
        setLiveColumns(committedValue as Columns);
        setPendingMove({ payload, deal });
        return;
      }

      moveOpportunity.mutate({ id: payload.opportunityId, stage: payload.stage, stageOrder: payload.stageOrder });
    }

    // Mirrors TaskPanel.tsx's handleDelete/ConfirmModal pattern: async
    // onConfirm awaits mutateAsync, stays "busy" until it settles, and closes
    // the modal either way — a failed move surfaces via the isError Alert
    // below (useMoveOpportunity's own onError already rolled the optimistic
    // cache write back), not a second error slot on the modal itself. `busy`
    // is this function's own `isConfirming` state (finding N6), not
    // `moveOpportunity.isPending` — the mutation is shared with the
    // non-confirm optimistic drag path, so its pending flag isn't specific to
    // this dialog's own in-flight request.
    async function handleConfirmMove() {
      if (!pendingMove) return;
      const { payload } = pendingMove;
      setIsConfirming(true);
      try {
        const updated = await moveOpportunity.mutateAsync({
          id: payload.opportunityId,
          stage: payload.stage,
          stageOrder: payload.stageOrder,
        });
        // Same gate as OpportunityDetail.tsx's stage-menu equivalent:
        // project:write AND deal-edit rights (`canDragDeal` — the same
        // check the backend's POST /:id/handoff makes via
        // assertCanWriteOpportunity(user, "edit", deal), so a project:write
        // holder who isn't this deal's PIC and lacks pipeline:edit_all
        // would 403 on submit) — plus no pre-existing link (a WON deal
        // can't re-enter WON, but stays defensive rather than assumed).
        if (
          payload.stage === "WON" &&
          !updated.projectId &&
          hasPermission(user, "project:write") &&
          canDragDeal(user, updated)
        ) {
          setJustWonDeal(updated);
        }
      } catch {
        // Surfaced via the isError Alert below; nothing else to do here.
      } finally {
        // Clears both the pending-confirm state and the frozen liveColumns
        // snapshot handleValueCommit set (finding S2) — success or failure,
        // the board falls back to derivedColumns (the query cache, which
        // useMoveOpportunity's onSettled/onError already keep authoritative).
        setPendingMove(null);
        setLiveColumns(null);
        setIsConfirming(false);
      }
    }

    // useCallback (not a plain function): identity feeds useImperativeHandle
    // below, so the exposed `scrollToStage` only needs to be rebuilt if this
    // callback's own identity changes (it never does — columnRefs is a ref,
    // stable across renders).
    const scrollToStage = useCallback((stage: PipelineStage) => {
      columnRefs.current[stage]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }, []);

    useImperativeHandle(ref, () => ({ scrollToStage }), [scrollToStage]);

    if (isLoading) {
      return (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {PIPELINE_STAGES.map((stage) => (
            <div
              key={stage}
              className="h-64 w-[85vw] shrink-0 animate-pulse rounded-xl bg-surface-container-low sm:w-72"
            />
          ))}
        </div>
      );
    }

    if (isError) {
      return (
        <Alert variant="destructive">
          <AlertDescription>
            Could not load the Pipeline board: {(error as Error).message}
          </AlertDescription>
        </Alert>
      );
    }

    const allDeals = deals ?? [];

    return (
      <div className="space-y-4">
        {moveOpportunity.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              Could not move the opportunity: {(moveOpportunity.error as Error).message}
            </AlertDescription>
          </Alert>
        )}

        {/* Non-blocking inline offer, not a modal ambush (PRD §2.10) —
            mirrors OpportunityDetail.tsx's own post-won Alert. */}
        {justWonDeal && (
          <Alert variant="success">
            <AlertDescription>
              "{justWonDeal.title}" won — create the delivery project?
            </AlertDescription>
            <AlertAction>
              <button
                type="button"
                onClick={() => {
                  setHandoffDeal(justWonDeal);
                  setJustWonDeal(null);
                }}
                className="rounded-sm bg-primary px-3 py-1 font-display text-[12px] font-bold text-on-primary hover:bg-primary-container"
              >
                Create project
              </button>
              <button
                type="button"
                onClick={() => setJustWonDeal(null)}
                className="rounded-sm px-2.5 py-1 text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container"
              >
                Dismiss
              </button>
            </AlertAction>
          </Alert>
        )}

        {allDeals.length === 0 ? (
          <EmptyBoardState onCreate={onCreateOpportunity} />
        ) : (
          <Kanban
            value={columns}
            onValueChange={handleValueChange}
            onValueCommit={handleValueCommit}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
            restoreOnCancel
            getItemValue={getItemValue}
          >
            <div className="flex gap-4 overflow-x-auto pb-2">
              <KanbanBoard className="contents">
                {PIPELINE_STAGES.map((stage) => {
                  const stageDeals = columns[stage];
                  const stageValue = stageDeals.reduce((sum, d) => sum + d.dealValue, 0);

                  return (
                    <div
                      key={stage}
                      ref={(el) => {
                        columnRefs.current[stage] = el;
                      }}
                      className="w-[85vw] shrink-0 sm:w-72"
                    >
                      <KanbanColumn
                        value={stage}
                        className="flex min-h-32 flex-col gap-2.5 rounded-xl bg-surface-container p-2"
                      >
                        <div className="flex items-center gap-2 px-1 pb-1">
                          <h3 className="text-sm font-bold text-on-surface">{STAGE_LABELS[stage]}</h3>
                          <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[11px] font-medium text-on-surface-variant">
                            {stageDeals.length}
                          </span>
                          <span className="flex-1" />
                          {/* `font-mono`, not `text-data-mono` (finding N4):
                              `text-data-mono` already carries its own fixed
                              13px font-size token, which conflicts with the
                              explicit `text-[11px]` size here — `font-mono`
                              applies only the monospace font family. */}
                          <span className="font-mono text-[11px] text-on-surface-variant">
                            {formatIDRCompact(stageValue)}
                          </span>
                        </div>

                        <KanbanColumnContent value={stage} className="flex flex-col gap-2.5">
                          {stageDeals.map((deal) => {
                            const dragOk = canDragDeal(user, deal);
                            return (
                              <KanbanItem
                                key={deal.id}
                                value={getItemValue(deal)}
                                disabled={!dragOk}
                                className={dragOk ? undefined : "opacity-100"}
                              >
                                <OpportunityCard
                                  deal={deal}
                                  canDrag={dragOk}
                                  onClick={() => navigate(`/pipeline/${deal.id}`)}
                                />
                              </KanbanItem>
                            );
                          })}
                          {/* Per-column empties render nothing (PRD §2.11) — no
                              placeholder card, no dashed drop hint. */}
                        </KanbanColumnContent>
                      </KanbanColumn>
                    </div>
                  );
                })}
              </KanbanBoard>
            </div>

            <KanbanOverlay>
              {({ value }) => {
                const deal = allDeals.find((d) => d.id === String(value));
                if (!deal) return null;
                return (
                  <KanbanItem value={getItemValue(deal)}>
                    <OpportunityCard deal={deal} canDrag dragging />
                  </KanbanItem>
                );
              }}
            </KanbanOverlay>
          </Kanban>
        )}

        {pendingMove && (
          <ConfirmModal
            open
            onClose={() => {
              // Cancel path (finding S2): nothing was ever written, so
              // dropping the frozen liveColumns snapshot alongside pendingMove
              // restores the card to its pre-drag column/position immediately.
              setPendingMove(null);
              setLiveColumns(null);
            }}
            onConfirm={handleConfirmMove}
            title={pendingMove.payload.stage === "WON" ? "Mark opportunity as Won?" : "Drop this opportunity?"}
            body={
              <>
                Move <strong>{pendingMove.deal.title}</strong> to{" "}
                <strong>{STAGE_LABELS[pendingMove.payload.stage]}</strong>? This records a stage change on
                the deal's activity log.
              </>
            }
            confirmLabel={pendingMove.payload.stage === "WON" ? "Mark as Won" : "Move to Drop"}
            confirmTone={pendingMove.payload.stage === "WON" ? "primary" : "warning"}
            busy={isConfirming}
          />
        )}

        <HandoffProjectModal
          open={handoffDeal !== null}
          onClose={() => setHandoffDeal(null)}
          deal={handoffDeal}
        />
      </div>
    );
  },
);

function EmptyBoardState({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-outline-variant px-6 py-14 text-center">
      <span className="material-symbols-outlined text-3xl text-on-surface-variant">monetization_on</span>
      <p className="text-sm font-semibold text-on-surface">No opportunities yet</p>
      <p className="max-w-xs text-xs text-on-surface-variant">
        Opportunities you create will appear here, grouped by stage.
      </p>
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-2 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-display text-xs font-bold text-on-primary hover:bg-primary-container"
        >
          <span className="material-symbols-outlined text-base">add</span>
          New opportunity
        </button>
      )}
    </div>
  );
}
