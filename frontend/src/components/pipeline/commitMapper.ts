// Pure, dnd-free mapper: a drag commit from the vendored reui/kanban engine
// -> the move payload for `POST /opportunities/:id/move`. Mirrors
// frontend/src/components/kanban-v2/commitMapper.ts's `mapCommitToPatch` —
// same commit-meta shape, same no-op/type guards — but the position math
// itself is deliberately simpler, per a real difference in the two ordering
// contracts:
//
// `Task.position` is a single field spanning ALL THREE kanban-v2 columns at
// once (one global order for List/Kanban/Gantt), so kanban-v2's mapper has
// to reconstruct a "moved-excluded global index" from the committed
// (possibly filtered) per-column arrangement — see its `resolvePosition`/
// `columnAppendPosition`.
//
// `Opportunity.stageOrder`, by contrast, is dense PER STAGE ONLY — 0..n-1
// within one `PipelineStage`'s siblings (see `stageSiblingIds`/
// `insertAtStage` in backend/src/routes/opportunities.ts, which mirrors
// `lib/taskOrdering.ts`'s `insertAt` but scoped to `stage` instead of
// `(projectId, parentTaskId)`). That means the committed destination
// column's own index of the moved deal (`meta.overIndex`) already IS the
// exact insertion index the server needs: reui/kanban.tsx's `commitChange`
// computes it via `newOverItems.splice(overIndex, 0, movedItem)` — the same
// splice-at-index `insertAtStage` performs server-side after removing
// `moved` from its freshly-queried sibling list. No cross-column global
// order reconstruction, and no unfiltered-list parameter, is needed here.
// (If the board UI task ever adds filtering, revisit this — kanban-v2's
// FA-series scenarios in its own commitMapper.test.ts are the reference for
// what breaks and why.)
//
// The server re-clamps and re-packs to dense 0..n-1 itself (`insertAtStage`
// clamps `requestedPosition` to `[0, others.length]`), so this mapper does
// not duplicate that clamp — it emits `meta.overIndex` verbatim.

import { PIPELINE_STAGES, type PipelineBoardDeal } from "./adapter";
import type { PipelineStage } from "@/lib/pipelineFormat";

// Minimal STRUCTURAL type mirroring `KanbanCommitMeta<T>` from
// `frontend/src/components/reui/kanban.tsx` — defined locally rather than
// imported, same as kanban-v2/commitMapper.ts's `KanbanCommitMetaLike`, so
// neither this module nor adapter.ts imports the vendored kanban file or
// `@dnd-kit/*`. Field-for-field match with the vendor shape (minus `event`,
// which this pure function never needs): `kind` ("item" | "column"),
// `activeContainer`/`activeIndex` describe where the drag STARTED (indexing
// into `previousValue`), `overContainer`/`overIndex` describe where it
// ENDED (indexing into the committed value passed alongside this meta).
export interface PipelineCommitMetaLike<T = PipelineBoardDeal> {
  kind: "item" | "column";
  activeContainer: string;
  activeIndex: number;
  overContainer: string;
  overIndex: number;
  previousValue: Record<string, T[]>;
}

/** The move payload `POST /opportunities/:id/move` expects (`moveOpportunitySchema`, backend/src/routes/opportunities.ts). */
export interface OpportunityMovePayload {
  opportunityId: string;
  stage: PipelineStage;
  stageOrder: number;
}

/**
 * Type guard validating `meta.overContainer` against the known pipeline
 * stages (mirrors kanban-v2/commitMapper.ts's `isKanbanStatus`, Phase 1
 * review finding 5 there) instead of an unchecked `as PipelineStage` cast.
 */
function isPipelineStage(value: string): value is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(value);
}

/** Column-membership + order signature (ids only) — what "arrangement" means for the no-op guard. */
function columnSignature(column: PipelineBoardDeal[] | undefined): string[] {
  return (column ?? []).map((deal) => deal.id);
}

/**
 * Structural equality of two committed values: same stages, same deal ids
 * in the same order per stage. Deliberately NOT a full deep-equal of every
 * deal field — only id sequence per stage matters (mirrors kanban-v2's
 * `arrangementsEqual`).
 */
function arrangementsEqual(
  a: Record<string, PipelineBoardDeal[]>,
  b: Record<string, PipelineBoardDeal[]>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const sigA = columnSignature(a[key]);
    const sigB = columnSignature(b[key]);
    if (sigA.length !== sigB.length) return false;
    for (let i = 0; i < sigA.length; i++) {
      if (sigA[i] !== sigB[i]) return false;
    }
  }
  return true;
}

/**
 * Pure, dnd-free mapper: (the committed per-column value ReUI produced, the
 * commit meta) -> `{ opportunityId, stage, stageOrder }` to POST to
 * `/opportunities/:id/move`, or `null` to fire no request.
 */
export function mapCommitToMove(
  committedValue: Record<string, PipelineBoardDeal[]>,
  meta: PipelineCommitMetaLike,
): OpportunityMovePayload | null {
  // Column reordering is unsupported — never produces a request.
  if (meta.kind === "column") return null;

  // Guard: nothing about the arrangement changed (same ids, same order, in
  // every stage) -> no-op. Catches drop-in-place, self-collision, and
  // cancelled-drag-restored-to-original cases.
  if (arrangementsEqual(meta.previousValue, committedValue)) return null;

  // Guard: reject an overContainer that isn't a known pipeline stage rather
  // than trusting it via an unchecked cast — a malformed or future-column
  // commit fires no request instead of writing a garbage `stage`.
  if (!isPipelineStage(meta.overContainer)) return null;
  const targetStage = meta.overContainer;
  const targetColumn = committedValue[targetStage] ?? [];
  const moved = targetColumn[meta.overIndex];
  if (!moved) return null;

  return { opportunityId: moved.id, stage: targetStage, stageOrder: meta.overIndex };
}
