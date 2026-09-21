import type { Task, TaskStatus } from "@/lib/queries";
import { KANBAN_STATUSES } from "./adapter";

// Minimal STRUCTURAL type mirroring `KanbanCommitMeta<T>` from
// `frontend/src/components/reui/kanban.tsx` — defined locally rather than
// imported, per the acceptance criterion that neither this module nor
// adapter.ts may import from the vendored kanban file (or from
// `@dnd-kit/*`). Field-for-field match with the vendor shape (minus `event`,
// which this pure function never needs): `kind` ("item" | "column"),
// `activeContainer`/`activeIndex` describe where the drag STARTED (indexing
// into `previousValue`), `overContainer`/`overIndex` describe where it
// ENDED (indexing into the committed `value` passed alongside this meta) —
// see `reui/kanban.tsx:257-311` (`commitChange`) for the vendor's own
// derivation of these fields.
export interface KanbanCommitMetaLike<T = Task> {
  kind: "item" | "column";
  activeContainer: string;
  activeIndex: number;
  overContainer: string;
  overIndex: number;
  previousValue: Record<string, T[]>;
  /**
   * Explicit column-append signal (M2 fix, Phase 2 review 2026-07-27; refined
   * T10, 2026-07-27). Set by the caller when the drop landed on the column
   * body itself — not on a specific card — so the mapper doesn't have to
   * (mis)infer that from the committed arrangement. `SolvroKanban.tsx`
   * derives it from a real drag's `meta.event.over?.id` resolving to a
   * `KANBAN_STATUSES` member rather than an item id; `buildColumnAppendCommit`
   * sets it directly for the mobile move sheet's synthesized commit.
   *
   * T10 refinement: `meta.event.over?.id` resolving to a column id is NOT on
   * its own sufficient proof of a genuine column-body drop — dnd-kit's
   * `rectIntersection` can still resolve `over` to the column/content element
   * even while the live-preview arrangement shows the moved item inserted
   * MID-column (observed failure: dragging one card onto another's top edge
   * landed the preview as "inserted before", but `over` resolved to the
   * column, so the old unconditional check took the append branch, computed
   * a position equal to the card's own current slot, and the no-op guard
   * swallowed it — nothing committed while the user watched the card visibly
   * move). So `mapCommitToPatch` treats this signal as advisory only: it
   * takes effect exclusively when the COMMITTED ARRANGEMENT independently
   * agrees the moved item landed LAST among that column's (visible) members
   * (`meta.overIndex === targetColumn.length - 1`) — "the committed
   * arrangement is the truth". When the signal is set but the arrangement
   * disagrees (moved is anywhere else), the signal is ignored and ordinary
   * neighbor-based `resolvePosition` math runs instead, exactly as if no
   * signal had been passed at all. When both agree, `mapCommitToPatch`
   * anchors the position on the UNFILTERED last member of that status (moved
   * excluded) instead of the committed (possibly filtered) arrangement's
   * visible neighbors — fixes a bug where an active filter hiding the
   * column's true last card made a column-body append anchor on the last
   * *visible* card instead of the true one (FA-5).
   */
  appendToStatus?: TaskStatus;
}

export interface TaskPatch {
  status: TaskStatus;
  position?: number;
}

export interface CommitResult {
  taskId: number;
  patch: TaskPatch;
}

/**
 * Type guard validating `meta.overContainer` against the known kanban
 * statuses (Phase 1 review finding 5) instead of an unchecked `as
 * TaskStatus` cast. `overContainer` originates from the vendored engine's
 * commit meta — this module doesn't import that file's types (see the
 * `KanbanCommitMetaLike` note above), so the field arrives typed as a bare
 * `string`; nothing upstream guarantees it's one of TODO/IN_PROGRESS/DONE.
 */
function isKanbanStatus(value: string): value is TaskStatus {
  return (KANBAN_STATUSES as readonly string[]).includes(value);
}

/** Column-membership + order signature (ids only) — what "arrangement" means for the no-op guard. */
function columnSignature(column: Task[] | undefined): number[] {
  return (column ?? []).map((task) => task.id);
}

/**
 * Structural equality of two committed values: same columns, same task ids
 * in the same order per column. Deliberately NOT a full deep-equal of every
 * Task field (title/description/labels/etc. are irrelevant to "did the
 * arrangement change") — only id sequence per column matters.
 */
function arrangementsEqual(a: Record<string, Task[]>, b: Record<string, Task[]>): boolean {
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
 * Neighbor-based position resolution (Architecture Decision 3). Given the
 * moved card's committed (visible) target column and its index within it:
 *
 * - A visible predecessor (card immediately before it) exists -> position =
 *   predecessor's index in the MOVED-EXCLUDED unfiltered global order + 1.
 * - No predecessor but a visible successor exists -> position = successor's
 *   moved-excluded global index.
 * - Neither exists (the moved card is visually alone in its target column) —
 *   this happens both when the column is genuinely empty (CC-3/MS-3) AND
 *   when a filter merely hides every other member of that status (FA-3) —
 *   fall back to the UNFILTERED global order restricted to the target
 *   status: anchor on its last member (moved excluded) the same way the old
 *   `columnEndPosition` always read `groupedAll`, never the filtered
 *   `grouped`, specifically so a filter can't make a non-empty column look
 *   empty. Only when that unfiltered fallback also comes up empty is the
 *   column truly empty -> `undefined` (status-only patch).
 *
 * The returned index is clamped to `[0, movedExcludedGlobal.length]`, mirroring
 * `taskOrdering.ts`'s `insertAt` clamp (Phase 1 review finding 6) — the
 * neighbor-anchored `+1` branches below can otherwise overrun the list's end
 * when the anchor neighbor referenced by a stale/concurrently-edited commit
 * isn't found in `unfilteredGlobalOrder` (`findMovedExcludedIndex`'s
 * not-found fallback is already `movedExcludedGlobal.length`, so `+1` alone
 * would land one past the valid append slot). This mapper has no server
 * round-trip to re-derive the clamp from, so it applies the same contract
 * locally rather than shipping a `position` the backend would silently
 * reinterpret.
 */
/**
 * Shared moved-excluded-index/clamp context (Phase 1 review finding 6's
 * clamp contract) — factored out (M2 fix) so both the neighbor-based
 * resolver below and the explicit column-append path build their index math
 * from the identical `movedExcludedGlobal` list/clamp rule.
 */
function movedExcludedContext(unfilteredGlobalOrder: Task[], movedId: number) {
  const movedExcludedGlobal = unfilteredGlobalOrder.filter((t) => t.id !== movedId);

  const findIndex = (id: number): number => {
    const idx = movedExcludedGlobal.findIndex((t) => t.id === id);
    return idx === -1 ? movedExcludedGlobal.length : idx;
  };

  const clamp = (pos: number): number => Math.max(0, Math.min(pos, movedExcludedGlobal.length));

  return { movedExcludedGlobal, findIndex, clamp };
}

/**
 * Column-append position: anchor on the UNFILTERED last member of
 * `targetStatus` (moved excluded), matching the old board's
 * `columnEndPosition` semantics — so a filter hiding the column's true last
 * card can never make the append land before it. Used both as
 * `resolvePosition`'s own fallback (no visible neighbor in the committed
 * arrangement) AND directly by `mapCommitToPatch` when the caller passes an
 * explicit `appendToStatus` signal (M2 fix) — a genuine column-body drop
 * must always anchor here, never on a merely-adjacent *visible* card.
 */
function columnAppendPosition(
  targetStatus: TaskStatus,
  movedId: number,
  unfilteredGlobalOrder: Task[],
): number | undefined {
  const { movedExcludedGlobal, findIndex, clamp } = movedExcludedContext(unfilteredGlobalOrder, movedId);
  const unfilteredStatusMembers = movedExcludedGlobal.filter((t) => t.status === targetStatus);
  const last = unfilteredStatusMembers[unfilteredStatusMembers.length - 1];
  if (!last) return undefined;
  return clamp(findIndex(last.id) + 1);
}

function resolvePosition(
  targetStatus: TaskStatus,
  targetColumn: Task[],
  movedIndexInColumn: number,
  movedId: number,
  unfilteredGlobalOrder: Task[],
): number | undefined {
  const { findIndex, clamp } = movedExcludedContext(unfilteredGlobalOrder, movedId);

  const predecessor = targetColumn[movedIndexInColumn - 1];
  if (predecessor) {
    return clamp(findIndex(predecessor.id) + 1);
  }

  const successor = targetColumn[movedIndexInColumn + 1];
  if (successor) {
    return clamp(findIndex(successor.id));
  }

  return columnAppendPosition(targetStatus, movedId, unfilteredGlobalOrder);
}

/**
 * Pure, dnd-free mapper: (unfiltered global top-level list in canonical
 * pre-drag order, the committed per-column value ReUI produced, the commit
 * meta) -> `{ taskId, patch }` to PATCH, or `null` to fire no request.
 *
 * `unfilteredGlobalOrder` is always the FULL top-level list regardless of
 * active filters — filtering only ever narrows `committedValue`
 * (rendering-only), never the sibling-list math this function does. Mirrors
 * `taskOrdering.ts`'s `insertAt`: a `position` is an index into the
 * moved-excluded sibling list; omitting the key means "append" there, and
 * means "keep current slot" here (no request needed either way once the
 * no-op guards below are satisfied).
 */
export function mapCommitToPatch(
  unfilteredGlobalOrder: Task[],
  committedValue: Record<string, Task[]>,
  meta: KanbanCommitMetaLike,
): CommitResult | null {
  // Column reordering is unsupported — never produces a request.
  if (meta.kind === "column") return null;

  // Guard 1: nothing about the arrangement changed (same ids, same order,
  // in every column) -> no-op. Catches drop-in-place, self-collision, and
  // cancelled-drag-restored-to-original cases (SC-3, SC-4, NO-1, NO-3).
  if (arrangementsEqual(meta.previousValue, committedValue)) return null;

  // Guard: reject an overContainer that isn't a known kanban status (Phase 1
  // review finding 5) rather than trusting it via an unchecked cast — a
  // malformed or future-column commit fires no request instead of writing a
  // garbage `status`.
  if (!isKanbanStatus(meta.overContainer)) return null;
  const targetStatus = meta.overContainer;
  const targetColumn = committedValue[targetStatus] ?? [];
  const moved = targetColumn[meta.overIndex];
  if (!moved) return null;

  const current = unfilteredGlobalOrder.find((t) => t.id === moved.id);
  if (!current) return null;

  // M2 fix, refined T10 (2026-07-27): an explicit column-append signal (a
  // real column-body drop, or the mobile move sheet's synthesized commit)
  // anchors on the target status's TRUE unfiltered last member, bypassing
  // the committed arrangement's (possibly filtered) visible-neighbor
  // inference entirely — but ONLY when the committed arrangement itself
  // independently agrees the moved item landed LAST among that column's
  // (visible) members. `meta.event.over?.id` resolving to a column id is a
  // noisy signal on its own (dnd-kit's rectIntersection can resolve `over`
  // to the column even when the live preview shows a genuine mid-column
  // card-to-card insert) — requiring arrangement agreement is what makes
  // "the committed arrangement is the truth": when the two disagree, the
  // signal is ignored and ordinary neighbor-based math runs, exactly as if
  // no signal had been passed. A card-to-card drop never sets this signal in
  // the first place, so it always keeps using resolvePosition's neighbor-
  // based math (committed-arrangement inference stays authoritative there).
  const committedShowsMovedLast = meta.overIndex === targetColumn.length - 1;
  const useColumnAppend = meta.appendToStatus === targetStatus && committedShowsMovedLast;
  const position = useColumnAppend
    ? columnAppendPosition(targetStatus, moved.id, unfilteredGlobalOrder)
    : resolvePosition(targetStatus, targetColumn, meta.overIndex, moved.id, unfilteredGlobalOrder);

  const patch: TaskPatch = position === undefined ? { status: targetStatus } : { status: targetStatus, position };

  // Guard 2 (defensive-only, Phase 1 review finding 2): the resolved patch
  // describes the task's CURRENT state exactly (status unchanged, and either
  // no position was resolved or the resolved position equals its current
  // `position` field) -> no-op. Per NO-2, this guard's only reachable path
  // is the column-append branch (a card-to-card drop's resolved position is
  // always a distinct card's own index, which can never equal the moved
  // card's own current position). Analytically, this guard is unreachable
  // for every input reachable through this function: any committed
  // arrangement that would satisfy Guard 2 is, by construction, the same
  // id-sequence-per-column as `previousValue` — which Guard 1
  // (`arrangementsEqual`, above) already catches and returns `null` for
  // first. Guard 1 subsumes Guard 2 here. It's kept anyway as a cheap
  // invariant against future refactors that might weaken or bypass Guard 1
  // without this one noticing — not a target for dedicated test coverage;
  // no test tries to reach it without also tripping Guard 1 first.
  if (current.status === patch.status && (patch.position === undefined || current.position === patch.position)) {
    return null;
  }

  return { taskId: moved.id, patch };
}
