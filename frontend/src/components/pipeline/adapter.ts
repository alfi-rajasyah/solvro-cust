// Pure projection helpers: Opportunity deals -> the reui/kanban board model,
// grouped by PipelineStage. Mirrors
// frontend/src/components/kanban-v2/adapter.ts (the project-tasks board on
// the same vendored engine, reui/kanban.tsx) — same shape of exports
// (a canonical comparator, a sort helper, a `projectToColumns` pure
// projection), scoped to the Pipeline module's 9 `PipelineStage` columns
// instead of the task board's 3 `TaskStatus` columns.
//
// Type-only dependency note (M2.9 dispatch): this module deliberately does
// NOT import `Opportunity` from `@/lib/queries` (M2.6's hooks task ran in
// parallel with this one). `PipelineBoardDeal` below is a local structural
// type declaring only the fields this adapter/commitMapper actually touch.
// Field set and casing match `serializeOpportunity`
// (backend/src/routes/opportunities.ts) verbatim, so the real hook-fetched
// DTO satisfies this interface structurally, without a cast.

import { STAGE_ORDER, type PipelineStage } from "@/lib/pipelineFormat";

/**
 * Minimal structural shape of an Opportunity DTO this module needs.
 * `id` is a UUID string (`Opportunity.id` in schema.prisma), unlike Task's
 * numeric id — the canonical comparator below tiebreaks with a string
 * compare accordingly.
 */
export interface PipelineBoardDeal {
  id: string;
  title: string;
  customerName: string;
  dealValue: number;
  stage: PipelineStage;
  stageOrder: number;
  picId: number | null;
  pic: { id: number; username: string; avatarUrl: string | null } | null;
  winProbability: number;
  deadline: string | null;
  wonAt: string | null;
}

/**
 * Board column order, left to right — ALL 9 `STAGE_ORDER` members
 * (ASSESSMENT..HOLD), re-exported under a kanban-v2-style name
 * (`KANBAN_STATUSES`'s counterpart) so commitMapper.ts and the board UI task
 * share one source of truth for "what is a valid kanban container id".
 *
 * This adapter maps all 9 stages unconditionally, by design (M2.9 dispatch)
 * — see this task's report for the board-UI-level finding: Velora's own
 * Kanban view (../VeloraApp components/kanban/board.tsx, read-only
 * reference) also renders all 9 `STAGES` as columns with no hide/toggle on
 * the board itself. Velora's Swimlane view (a different view mode,
 * components/kanban/swimlane-view.tsx) is the one that filters out DROP
 * (`SWIMLANE_STAGES = STAGES.filter((s) => s.id !== "drop")`) — that's a
 * board-UI (M2.10) concern for a swimlane-equivalent surface, if one is ever
 * built, not something this adapter should bake in.
 */
export const PIPELINE_STAGES: readonly PipelineStage[] = STAGE_ORDER;

/**
 * Canonical per-stage order comparator: `stageOrder` ascending, `id`
 * ascending tiebreak. Mirrors kanban-v2/adapter.ts's
 * `compareTasksByPosition`, with a string tiebreak instead of numeric (UUID
 * ids).
 */
export function compareDealsByStageOrder(a: PipelineBoardDeal, b: PipelineBoardDeal): number {
  return a.stageOrder - b.stageOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Sorts a deal list into canonical order (does not mutate input). */
export function sortDealsCanonical(deals: PipelineBoardDeal[]): PipelineBoardDeal[] {
  return [...deals].sort(compareDealsByStageOrder);
}

/** Filter predicate: `true` = deal is visible under the active filters (PIC, search, ...). */
export type DealVisibilityPredicate = (deal: PipelineBoardDeal) => boolean;

/**
 * Pure projection: an Opportunity list (any order, not trusted) + a
 * visibility predicate for the currently active filters ->
 * `Record<PipelineStage, PipelineBoardDeal[]>` shaped for ReUI Kanban's
 * `value` prop.
 *
 * - All 9 `PIPELINE_STAGES` columns are always present, empty arrays
 *   allowed — mirrors kanban-v2's TODO/IN_PROGRESS/DONE guarantee,
 *   generalized to 9 stages, so the vendored Kanban never sees a missing
 *   column key.
 * - Ordering within a column: `stageOrder` ascending, `id` ascending
 *   tiebreak — same comparator `compareDealsByStageOrder` exports.
 * - Filtering only ever hides deals from view; it never touches the input
 *   list's ordering or any deal's `stageOrder` field — mirrors kanban-v2's
 *   filtered/rendering-only vs. unfiltered/source-of-truth-for-drop-math
 *   split (commitMapper.ts is this module's drop-math counterpart, and — by
 *   design, see its own header comment — doesn't need an unfiltered global
 *   order the way kanban-v2's mapper does).
 *
 * Generic over `T extends PipelineBoardDeal` (S3, M2 review) rather than
 * fixed to `PipelineBoardDeal` itself: `queries.ts`'s `Opportunity` DTO
 * satisfies `PipelineBoardDeal` structurally but carries additional fields
 * (see this module's header comment), and callers projecting a real
 * `Opportunity[]` list want a `Record<PipelineStage, Opportunity[]>` back
 * without an unchecked `as` cast at the call site.
 */
export function projectToColumns<T extends PipelineBoardDeal>(
  deals: T[],
  isVisible: DealVisibilityPredicate = () => true,
): Record<PipelineStage, T[]> {
  const columns = Object.fromEntries(
    PIPELINE_STAGES.map((stage) => [stage, [] as T[]]),
  ) as Record<PipelineStage, T[]>;

  for (const deal of deals) {
    if (!isVisible(deal)) continue;
    columns[deal.stage].push(deal);
  }
  for (const stage of PIPELINE_STAGES) {
    columns[stage].sort(compareDealsByStageOrder);
  }
  return columns;
}
