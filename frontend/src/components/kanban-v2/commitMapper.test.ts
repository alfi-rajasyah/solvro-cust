import { describe, expect, it } from "vitest";
import type { Task, TaskStatus } from "@/lib/queries";
import { mapCommitToPatch, type KanbanCommitMetaLike } from "./commitMapper";

// Every test in this file is a named row from
// docs/plans/kanban-reui-swap/scenarios.md sections SC/CC/FA/NO/MS (the
// binding, CP0-approved behavior spec for this mapper). RG rows are modal/
// backend paths, out of mapper scope, and are not tested here.

function makeTask(
  overrides: Partial<Task> & Pick<Task, "id" | "title" | "status" | "position">,
): Task {
  return {
    projectId: 1,
    description: null,
    priority: "MEDIUM",
    startDate: null,
    dueDate: null,
    isMilestone: false,
    isCriticalPath: false,
    baselineStartDate: null,
    baselineDueDate: null,
    assignedToId: null,
    assignedTo: null,
    parentTaskId: null,
    sectionId: null,
    section: null,
    labels: [],
    _count: { subtasks: 0, comments: 0 },
    itopTicketRef: null,
    epicId: null,
    ...overrides,
  };
}

interface ReferenceFixture {
  A: Task;
  B: Task;
  C: Task;
  D: Task;
  E: Task;
}

/** scenarios.md "Reference fixture" — top-level tasks in the global order shared by List/Kanban/Gantt. */
function referenceFixture(): ReferenceFixture {
  return {
    A: makeTask({ id: 1, title: "A", status: "TODO", position: 0 }),
    B: makeTask({ id: 2, title: "B", status: "TODO", position: 1 }),
    C: makeTask({ id: 3, title: "C", status: "TODO", position: 2 }),
    D: makeTask({ id: 4, title: "D", status: "IN_PROGRESS", position: 3 }),
    E: makeTask({ id: 5, title: "E", status: "DONE", position: 4 }),
  };
}

/** scenarios.md "Fixture variant EC (empty column)" — identical, minus task D, so IN_PROGRESS is genuinely empty. */
function ecFixture(): Omit<ReferenceFixture, "D"> {
  return {
    A: makeTask({ id: 1, title: "A", status: "TODO", position: 0 }),
    B: makeTask({ id: 2, title: "B", status: "TODO", position: 1 }),
    C: makeTask({ id: 3, title: "C", status: "TODO", position: 2 }),
    E: makeTask({ id: 5, title: "E", status: "DONE", position: 3 }),
  };
}

/** Canonical global order — position ascending, id ascending tiebreak. */
function globalOrder(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.position - b.position || a.id - b.id);
}

/** groupedAll equivalent (ProjectKanban.tsx:204-209) — unfiltered per-status buckets, same ordering. */
function groupedAll(tasks: Task[]): Record<TaskStatus, Task[]> {
  const map: Record<TaskStatus, Task[]> = { TODO: [], IN_PROGRESS: [], DONE: [] };
  for (const t of tasks) map[t.status].push(t);
  for (const status of Object.keys(map) as TaskStatus[]) {
    map[status].sort((a, b) => a.position - b.position || a.id - b.id);
  }
  return map;
}

describe("commitMapper — section 1: card drops, same column", () => {
  it("SC-1: drag C onto card A (drop above) -> C inserted before A", () => {
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    const committedValue = { ...previousValue, TODO: [C, A, B] };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 2,
      overContainer: "TODO",
      overIndex: 0,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: C.id,
      patch: { status: "TODO", position: 0 },
    });
  });

  it("SC-2: one-slot downward move must not no-op", () => {
    // The hazard this guards against: if position were computed on the
    // moved-EXCLUDED list instead of neighbor-anchored on the committed
    // arrangement, this would resolve back to B's own current position (1)
    // and silently no-op. Committed order [A, C, B] (B lands after C).
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    const committedValue = { ...previousValue, TODO: [A, C, B] };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 1,
      overContainer: "TODO",
      overIndex: 2,
      previousValue,
    };

    const result = mapCommitToPatch(global, committedValue, meta);
    expect(result).toEqual({ taskId: B.id, patch: { status: "TODO", position: 2 } });
    // Explicitly assert this is NOT the no-op B.position (1) that the
    // moved-excluded-index bug would have produced.
    expect(result?.patch.position).not.toBe(B.position);
  });

  it("SC-3: drop back in original slot fires no request", () => {
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    // No real movement: committed arrangement is identical to previousValue.
    const committedValue = groupedAll(global);
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 1,
      overContainer: "TODO",
      overIndex: 1,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toBeNull();
  });

  it("SC-4: collision resolving to the active card's own id fires no request", () => {
    // Modeled identically to SC-3 at the mapper level: whatever upstream
    // mechanism produced activeId === overId, the resulting committed
    // arrangement is unchanged from previousValue, so the arrangement
    // no-op guard covers it the same way. Flagged (per scenarios.md) as
    // defensive/likely unreachable via real collision detection.
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    const committedValue = groupedAll(global);
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 1,
      overContainer: "TODO",
      overIndex: 1,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toBeNull();
  });

  it("SC-5: card drag resolving onto a subtask row's parent card behaves like SC-1", () => {
    // The keyboard-sensor safety-net path resolves "dropped on subtask S1"
    // to "dropped on card A" before the mapper ever sees it — subtask ids
    // don't exist in this module's vocabulary (subtask dragging is retired
    // from the board). By the time a commit reaches mapCommitToPatch, this
    // is indistinguishable from SC-1's direct card-onto-card drop.
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    const committedValue = { ...previousValue, TODO: [C, A, B] };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 2,
      overContainer: "TODO",
      overIndex: 0,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: C.id,
      patch: { status: "TODO", position: 0 },
    });
  });
});

describe("commitMapper — section 2: card drops, cross column", () => {
  it("CC-1: drag D onto card B (cross-column, card-to-card)", () => {
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    const committedValue = {
      ...previousValue,
      TODO: [A, D, B, C],
      IN_PROGRESS: [],
    };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "IN_PROGRESS",
      activeIndex: 0,
      overContainer: "TODO",
      overIndex: 1,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: D.id,
      patch: { status: "TODO", position: 1 },
    });
  });

  it("CC-1b: drag D onto card B (cross-column, card-to-card) — moved lands AFTER over-card (WYSIWYG alternate)", () => {
    // Phase 1 Review Addenda #6: the orchestrator accepted WYSIWYG semantics
    // for cross-column drop-on-card — ReUI commits the live-preview
    // arrangement, which can land the moved card on EITHER side of the
    // over-card depending on pointer position (top-half vs bottom-half of
    // the over-card). CC-1 above covers "moved lands before over-card"
    // (committed TODO: [A, D, B, C]); this sibling covers the other
    // reachable arrangement — "moved lands after over-card" (committed
    // TODO: [A, B, D, C]) — same gesture, same fixture, different drop
    // half.
    //
    // Hand derivation from the moved-excluded global list:
    //   global (unfiltered) excl. D (id 4) = [A, B, C, E]  (movedExcludedGlobal)
    //   Committed TODO = [A, B, D, C] -> D is at index 2, its committed
    //     predecessor is B (index 1).
    //   findMovedExcludedIndex(B.id=2) = index of B in [A,B,C,E] = 1
    //   position = 1 + 1 = 2  (predecessor branch: index + 1)
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    const committedValue = {
      ...previousValue,
      TODO: [A, B, D, C],
      IN_PROGRESS: [],
    };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "IN_PROGRESS",
      activeIndex: 0,
      overContainer: "TODO",
      overIndex: 2,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: D.id,
      patch: { status: "TODO", position: 2 },
    });
  });

  it("CC-2: drag E onto the TODO column body (not onto a card)", () => {
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    const committedValue = {
      ...previousValue,
      TODO: [A, B, C, E],
      DONE: [],
    };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "DONE",
      activeIndex: 0,
      overContainer: "TODO",
      overIndex: 3,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: E.id,
      patch: { status: "TODO", position: 3 },
    });
  });

  it("CC-3: drag C onto a genuinely empty IN_PROGRESS column body (EC fixture)", () => {
    const { A, B, C, E } = ecFixture();
    const global = globalOrder([A, B, C, E]);
    const previousValue = groupedAll(global);
    const committedValue = {
      ...previousValue,
      TODO: [A, B],
      IN_PROGRESS: [C],
    };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 2,
      overContainer: "IN_PROGRESS",
      overIndex: 0,
      previousValue,
    };

    const result = mapCommitToPatch(global, committedValue, meta);
    expect(result).toEqual({ taskId: C.id, patch: { status: "IN_PROGRESS" } });
    // Hard constraint: no `position` key at all, not `position: undefined`.
    expect(result && "position" in result.patch).toBe(false);
  });
});

describe("commitMapper — section 3: filter-active variants (filter-agnostic — CP0 decision log #2)", () => {
  it("FA-1: filter hides B; drag C onto card A still shifts B's global slot correctly", () => {
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]); // unfiltered — always passed in full
    const previousValue: Record<string, Task[]> = {
      TODO: [A, C], // B hidden
      IN_PROGRESS: [D],
      DONE: [E],
    };
    const committedValue = { ...previousValue, TODO: [C, A] };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 1,
      overContainer: "TODO",
      overIndex: 0,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: C.id,
      patch: { status: "TODO", position: 0 },
    });
  });

  it("FA-2: filter hides C; drag A onto card D (cross-column) anchors on D's true global index", () => {
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue: Record<string, Task[]> = {
      TODO: [A, B], // C hidden
      IN_PROGRESS: [D],
      DONE: [E],
    };
    const committedValue = {
      ...previousValue,
      TODO: [B],
      IN_PROGRESS: [D, A],
    };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 0,
      overContainer: "IN_PROGRESS",
      overIndex: 1,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: A.id,
      patch: { status: "IN_PROGRESS", position: 3 },
    });
  });

  it("FA-2b: filter hides C; drag A onto card D (cross-column) — moved lands BEFORE over-card (WYSIWYG alternate)", () => {
    // Phase 1 Review Addenda #6, same delta as CC-1b but under an active
    // filter: FA-2 above covers "moved lands after over-card" (committed
    // IN_PROGRESS: [D, A]); this sibling covers "moved lands before
    // over-card" (committed IN_PROGRESS: [A, D]).
    //
    // Hand derivation from the moved-excluded global list:
    //   global (unfiltered — filter never touches this input) excl. A (id 1)
    //     = [B, C, D, E]  (movedExcludedGlobal; hidden C still counted)
    //   Committed IN_PROGRESS = [A, D] -> A is at index 0, no predecessor,
    //     successor is D (index 1).
    //   findMovedExcludedIndex(D.id=4) = index of D in [B,C,D,E] = 2
    //   position = 2  (successor branch: index, no +1)
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue: Record<string, Task[]> = {
      TODO: [A, B], // C hidden
      IN_PROGRESS: [D],
      DONE: [E],
    };
    const committedValue = {
      ...previousValue,
      TODO: [B],
      IN_PROGRESS: [A, D],
    };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 0,
      overContainer: "IN_PROGRESS",
      overIndex: 0,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: A.id,
      patch: { status: "IN_PROGRESS", position: 2 },
    });
  });

  it("FA-3: filter hides the only IN_PROGRESS card (D); column-body drop must not treat it as empty", () => {
    // The row scenarios.md calls out as the one that "would catch a
    // wrong-empty-column bug": the FILTERED committed column shows only the
    // moved card (D invisible), which looks indistinguishable from a truly
    // empty column — the mapper must fall back to the UNFILTERED global
    // order to find D as the real anchor, not treat this as a status-only
    // patch.
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]); // unfiltered — still contains D
    const previousValue: Record<string, Task[]> = {
      TODO: [A, B, C],
      IN_PROGRESS: [], // D hidden by filter
      DONE: [E],
    };
    const committedValue = {
      ...previousValue,
      TODO: [B, C],
      IN_PROGRESS: [A], // still only the moved card visible — D remains hidden
    };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 0,
      overContainer: "IN_PROGRESS",
      overIndex: 0,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: A.id,
      patch: { status: "IN_PROGRESS", position: 3 },
    });
  });

  it("FA-4: filter hides B; same-column column-body drop keeps B's hidden slot intact", () => {
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue: Record<string, Task[]> = {
      TODO: [A, C], // B hidden
      IN_PROGRESS: [D],
      DONE: [E],
    };
    const committedValue = { ...previousValue, TODO: [C, A] };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 0,
      overContainer: "TODO",
      overIndex: 1,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: A.id,
      patch: { status: "TODO", position: 2 },
    });
  });

  it("FA-5 (Phase 2 review, 2026-07-27): filter hides C; column-body drop of D onto TODO anchors on C (true last member), not B (last VISIBLE card)", () => {
    // M2 fix. Fixture: A,B,C TODO / D IN_PROGRESS / E DONE, filter hides C.
    // Dragging D onto the TODO column BODY (not onto a card) is a genuine
    // column-append: SolvroKanban.tsx sets meta.appendToStatus = "TODO" from
    // meta.event.over?.id resolving to the column id. The committed
    // (filtered) TODO shows only [A, B, D] — C stays invisible — so D's
    // committed predecessor is B, NOT C. Without the explicit signal,
    // neighbor-based resolution would anchor on B (position 2), silently
    // landing D BEFORE the hidden C instead of after it (the true end).
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue: Record<string, Task[]> = {
      TODO: [A, B], // C hidden
      IN_PROGRESS: [D],
      DONE: [E],
    };
    const committedValue = {
      ...previousValue,
      TODO: [A, B, D], // D appended after the two VISIBLE cards only
      IN_PROGRESS: [],
    };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "IN_PROGRESS",
      activeIndex: 0,
      overContainer: "TODO",
      overIndex: 2,
      previousValue,
      appendToStatus: "TODO",
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: D.id,
      patch: { status: "TODO", position: 3 },
    });
  });

  it("FA-5-MS (Phase 2 review, 2026-07-27): move-sheet variant of FA-5 — same explicit signal, same true-end anchor", () => {
    // Same fixture/hazard as FA-5, reached through the synthesized move-sheet
    // commit shape (buildColumnAppendCommit) instead of a real drag — proves
    // mapCommitToPatch's appendToStatus handling is shared by both callers,
    // not drag-path-specific (matches the existing "MS rows share the exact
    // column-append code path CC rows use" test's own framing, section 5).
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue: Record<string, Task[]> = {
      TODO: [A, B], // C hidden
      IN_PROGRESS: [D],
      DONE: [E],
    };
    const committedValue = {
      ...previousValue,
      TODO: [A, B, D],
      IN_PROGRESS: [],
    };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "IN_PROGRESS",
      activeIndex: 0,
      overContainer: "TODO",
      overIndex: 2, // targetColumn.length before append, per buildColumnAppendCommit
      previousValue,
      appendToStatus: "TODO",
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: D.id,
      patch: { status: "TODO", position: 3 },
    });
  });

  it("card-to-card drops under a filter still use visible-neighbor math even when appendToStatus names a different column (mismatched signal is ignored)", () => {
    // Guards the branch condition itself — `meta.appendToStatus ===
    // targetStatus`, not merely `meta.appendToStatus` truthy. Reuses FA-2's
    // fixture/gesture (card-to-card cross-column drop under a filter) with a
    // deliberately mismatched appendToStatus ("DONE", not the actual drop
    // target "IN_PROGRESS") to prove the neighbor-based resolvePosition path
    // still runs — the explicit signal never leaks into other columns' math.
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue: Record<string, Task[]> = {
      TODO: [A, B], // C hidden
      IN_PROGRESS: [D],
      DONE: [E],
    };
    const committedValue = {
      ...previousValue,
      TODO: [B],
      IN_PROGRESS: [D, A],
    };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 0,
      overContainer: "IN_PROGRESS",
      overIndex: 1,
      previousValue,
      appendToStatus: "DONE",
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: A.id,
      patch: { status: "IN_PROGRESS", position: 3 },
    });
  });
});

describe("commitMapper — T10 (2026-07-27) M2 refinement: appendToStatus requires arrangement agreement", () => {
  // Diagnosis (G9a failure, real drag run): dragging one card onto another's
  // TOP edge sometimes resolves dnd-kit's `over` to the COLUMN itself (not
  // the card) even though the live-preview arrangement clearly shows a
  // card-to-card "insert before" — SolvroKanban.tsx's `appendToStatus`
  // derivation only inspects `meta.event.over?.id`, so it set the signal
  // unconditionally in that case. The three rows below pin the fixed rule:
  // the signal only takes effect when the COMMITTED ARRANGEMENT itself also
  // shows the moved item last in the target column; otherwise it's ignored
  // and ordinary neighbor math (`resolvePosition`) runs, identical to a
  // plain card-to-card drop.

  it("(a) G9a-shape: signal set but committed arrangement shows moved NOT last -> signal ignored, neighbor math used", () => {
    // Reproduces the real bug this fix addresses. Minimal 2-card TODO
    // column: v2 dragged onto v1's card, landing BEFORE it (committed
    // TODO: [v2, v1] — v2 is NOT last, v1 follows). A mis-resolved
    // `meta.event.over?.id` set `appendToStatus: "TODO"` anyway.
    //
    // Under the OLD (unconditional) M2 code this signal alone would have
    // taken the append branch: `columnAppendPosition` anchors on the
    // UNFILTERED last member excluding v2, which is v1 itself (the only
    // other TODO task) -> position = 0 + 1 = 1. But v2's own CURRENT
    // position is already 1 -> Guard 2 (current-state no-op) swallows it,
    // producing `null` — no PATCH fires even though the user just watched
    // v2 move to the front of the column. That silent no-op IS the WYSIWYG
    // violation from the diagnosis.
    //
    // Fixed: `meta.overIndex` (0) !== `targetColumn.length - 1` (1), so the
    // signal is ignored and `resolvePosition` runs instead — predecessor
    // absent (v2 is first), successor is v1, `findIndex(v1)` in the
    // moved-excluded global order (`[v1]`) is 0, no `+1` (successor
    // branch) -> position 0. A real, correct PATCH fires.
    const v1 = makeTask({ id: 101, title: "v1", status: "TODO", position: 0 });
    const v2 = makeTask({ id: 102, title: "v2", status: "TODO", position: 1 });
    const global = globalOrder([v1, v2]);
    const previousValue = groupedAll(global);
    const committedValue = { ...previousValue, TODO: [v2, v1] };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 1,
      overContainer: "TODO",
      overIndex: 0,
      previousValue,
      appendToStatus: "TODO", // mis-resolved signal — arrangement disagrees
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: v2.id,
      patch: { status: "TODO", position: 0 },
    });
  });

  it("(b) FA-5-shape: signal set AND committed arrangement agrees moved is last -> unfiltered-anchor append still fires", () => {
    // Same fixture/gesture as the existing FA-5 test above — kept here too
    // (not just there) so this describe block reads as the complete,
    // self-contained agreement-rule spec: when the arrangement DOES agree
    // (moved last, `overIndex === targetColumn.length - 1`), the signal
    // still takes effect and anchors on the true unfiltered last member
    // (hidden C), exactly as FA-5 pins.
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue: Record<string, Task[]> = {
      TODO: [A, B], // C hidden
      IN_PROGRESS: [D],
      DONE: [E],
    };
    const committedValue = {
      ...previousValue,
      TODO: [A, B, D], // D appended after the two VISIBLE cards only
      IN_PROGRESS: [],
    };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "IN_PROGRESS",
      activeIndex: 0,
      overContainer: "TODO",
      overIndex: 2, // last index in a 3-item committed column -> agreement
      previousValue,
      appendToStatus: "TODO",
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: D.id,
      patch: { status: "TODO", position: 3 },
    });
  });

  it("(c) no signal, moved last VISIBLE with a hidden true-last: neighbor math anchors on the visible predecessor, not the hidden card — correct WYSIWYG for a card-targeted drop", () => {
    // Contrast with (b)/FA-5 immediately above: the IDENTICAL committed
    // arrangement (TODO: [A, B, D], C hidden by the filter) but reached by
    // dropping D directly ONTO card B (over resolves to B's own card id, so
    // SolvroKanban.tsx never sets `appendToStatus` in the first place — see
    // its `overId` derivation) rather than onto the column body. This is
    // the case the ORIGINAL (pre-M2) mapper had to handle on its own: with
    // no signal, `mapCommitToPatch` must NOT reach for the hidden true-last
    // member C — it uses ordinary neighbor-based `resolvePosition`,
    // anchoring on D's committed (visible) predecessor B instead. That is
    // correct, not a bug: the user dropped D onto B specifically, so D
    // landing immediately after B (position 2) — not after the invisible C
    // (position 3, FA-5's answer) — is exactly what was shown on screen.
    // The append-to-true-end semantics are reserved for genuine
    // column-space drops; a drop that targeted a specific card never gets
    // them, filter or no filter.
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue: Record<string, Task[]> = {
      TODO: [A, B], // C hidden
      IN_PROGRESS: [D],
      DONE: [E],
    };
    const committedValue = {
      ...previousValue,
      TODO: [A, B, D], // D dropped directly onto B, landing after it
      IN_PROGRESS: [],
    };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "IN_PROGRESS",
      activeIndex: 0,
      overContainer: "TODO",
      overIndex: 2,
      previousValue,
      // no appendToStatus — over resolved to card B, not the column
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: D.id,
      patch: { status: "TODO", position: 2 },
    });
  });
});

describe("commitMapper — section 4: no-op guards", () => {
  it("NO-1: dropping a card back in its original slot fires no request", () => {
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    const committedValue = groupedAll(global);
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "IN_PROGRESS",
      activeIndex: 0,
      overContainer: "IN_PROGRESS",
      overIndex: 0,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toBeNull();
  });

  it("NO-2: already-last card dropped onto its own column body fires no request", () => {
    // Per scenarios.md's own note, this is the ONE branch where the
    // resolved-status+position-equals-current guard is provably necessary
    // (a card-to-card drop's resolved position can never coincide with the
    // moved card's own position by construction) — here the arrangement is
    // also literally unchanged (C stays last), so the arrangement guard
    // fires too; both guards agree.
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    const committedValue = groupedAll(global); // C ([A,B,C]) unchanged — already last
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 2,
      overContainer: "TODO",
      overIndex: 2,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toBeNull();
  });

  it("NO-3: Escape mid-drag (restoreOnCancel) fires no request", () => {
    // onDragCancel never calls onValueCommit in the vendored component, so
    // this scenario never actually reaches the mapper in production — this
    // test documents the mapper's own safety net for the hypothetical case
    // where a caller invokes it anyway with a restored (unchanged)
    // arrangement.
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    const committedValue = groupedAll(global); // restoreOnCancel snapped back to previousValue
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 1,
      overContainer: "TODO",
      overIndex: 1,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toBeNull();
  });
});

describe("commitMapper — section 5: mobile move sheet", () => {
  it("MS-1: move sheet targets a non-empty column (In Progress already has D)", () => {
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    const committedValue = {
      ...previousValue,
      TODO: [A, B],
      IN_PROGRESS: [D, C],
    };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 2,
      overContainer: "IN_PROGRESS",
      overIndex: 1,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toEqual({
      taskId: C.id,
      patch: { status: "IN_PROGRESS", position: 3 },
    });
  });

  it("MS-2: move sheet's own-status button fires no request", () => {
    // In the real component, `onMove`'s own `status !== mobileSheetTask.status`
    // guard means computeCardDrop-equivalent math never even runs for this
    // button. Modeled here as an unchanged arrangement, so the mapper's own
    // guard independently produces the same no-request outcome.
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    const committedValue = groupedAll(global);
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 2,
      overContainer: "TODO",
      overIndex: 2,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toBeNull();
  });

  it("MS-3: move sheet targets a genuinely empty column (EC fixture) omits position", () => {
    const { A, B, C, E } = ecFixture();
    const global = globalOrder([A, B, C, E]);
    const previousValue = groupedAll(global);
    const committedValue = {
      ...previousValue,
      TODO: [A, B],
      IN_PROGRESS: [C],
    };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 2,
      overContainer: "IN_PROGRESS",
      overIndex: 0,
      previousValue,
    };

    const result = mapCommitToPatch(global, committedValue, meta);
    expect(result).toEqual({ taskId: C.id, patch: { status: "IN_PROGRESS" } });
    expect(result && "position" in result.patch).toBe(false);
  });

  it("MS rows share the exact column-append code path CC rows use (no move-sheet special-casing)", () => {
    // mapCommitToPatch has no move-sheet-specific parameter or branch —
    // KanbanCommitMetaLike carries only the drag-commit shape. A move-sheet
    // "tap" and a column-body drag produce structurally identical inputs
    // (item lands at the end of a committed target column), and this test
    // exercises both a CC-shaped call and an MS-shaped call side by side to
    // demonstrate that.
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);

    const ccCommitted = { ...previousValue, TODO: [A, B, C, E], DONE: [] };
    const ccMeta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "DONE",
      activeIndex: 0,
      overContainer: "TODO",
      overIndex: 3,
      previousValue,
    };

    const msCommitted = { ...previousValue, TODO: [A, B], IN_PROGRESS: [D, C] };
    const msMeta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 2,
      overContainer: "IN_PROGRESS",
      overIndex: 1,
      previousValue,
    };

    expect(mapCommitToPatch(global, ccCommitted, ccMeta)).toEqual({
      taskId: E.id,
      patch: { status: "TODO", position: 3 },
    });
    expect(mapCommitToPatch(global, msCommitted, msMeta)).toEqual({
      taskId: C.id,
      patch: { status: "IN_PROGRESS", position: 3 },
    });
  });
});

describe("commitMapper — column-kind commits", () => {
  it("kind: 'column' always fires no request (column reordering unsupported)", () => {
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    // Columns swapped — an arrangement that would NOT be a no-op if treated
    // as an item commit, to prove the "column" kind short-circuit fires
    // independently of the arrangement guard.
    const committedValue: Record<string, Task[]> = {
      TODO: previousValue.IN_PROGRESS,
      IN_PROGRESS: previousValue.TODO,
      DONE: previousValue.DONE,
    };
    const meta: KanbanCommitMetaLike = {
      kind: "column",
      activeContainer: "TODO",
      activeIndex: 0,
      overContainer: "IN_PROGRESS",
      overIndex: 1,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toBeNull();
  });
});

describe("commitMapper — Phase 1 review hardening (findings 5 & 6)", () => {
  it("unknown overContainer (not a KANBAN_STATUS) fires no request instead of an unchecked cast", () => {
    // Finding 5: previously `meta.overContainer as TaskStatus` trusted the
    // input unconditionally. A "BOGUS" container isn't in KANBAN_STATUSES
    // (adapter.ts), so the mapper must reject it and return null. The
    // committed value deliberately differs from previousValue (adds a
    // "BOGUS" key) so this exercises the container-validation guard
    // specifically, rather than being caught by the earlier arrangement
    // no-op guard.
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    const committedValue: Record<string, Task[]> = { ...previousValue, BOGUS: [C] };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "TODO",
      activeIndex: 2,
      overContainer: "BOGUS",
      overIndex: 0,
      previousValue,
    };

    expect(mapCommitToPatch(global, committedValue, meta)).toBeNull();
  });

  it("committed predecessor absent from the global list -> clamped append, not length+1", () => {
    // Finding 6: mirrors taskOrdering.ts's insertAt clamp
    // (Math.max(0, Math.min(requestedPosition, others.length))) locally, so
    // a stale-drag input (the commit's target column references a
    // predecessor task no longer present in the unfiltered global order —
    // e.g. deleted concurrently) resolves to a valid append index instead of
    // one-past-the-end.
    //
    // Hand derivation: global (unfiltered) excl. E (id 5, the moved task)
    //   = [A, B, C, D]  (movedExcludedGlobal, length 4)
    // Committed TODO = [A, B, C, STALE, E] -> E's committed predecessor is
    //   STALE (id 999), which does not exist anywhere in `global`.
    // findMovedExcludedIndex(999) -> not found -> falls back to
    //   movedExcludedGlobal.length = 4
    // Raw candidate = 4 + 1 = 5 (one past the valid end, length 4).
    // Clamped = Math.min(5, 4) = 4 -> append, not 5.
    const { A, B, C, D, E } = referenceFixture();
    const global = globalOrder([A, B, C, D, E]);
    const previousValue = groupedAll(global);
    const stale = makeTask({ id: 999, title: "STALE", status: "TODO", position: 99 });
    const committedValue: Record<string, Task[]> = {
      TODO: [A, B, C, stale, E],
      IN_PROGRESS: [D],
      DONE: [],
    };
    const meta: KanbanCommitMetaLike = {
      kind: "item",
      activeContainer: "DONE",
      activeIndex: 0,
      overContainer: "TODO",
      overIndex: 4,
      previousValue,
    };

    const result = mapCommitToPatch(global, committedValue, meta);
    expect(result).toEqual({ taskId: E.id, patch: { status: "TODO", position: 4 } });
    // Explicitly assert the clamp actually did work — the un-clamped raw
    // candidate (5) would be a subtly-wrong request the backend's own clamp
    // would silently reinterpret differently than intended.
    expect(result?.patch.position).not.toBe(5);
  });
});
