import { describe, expect, it } from "vitest";
import { STAGE_ORDER } from "@/lib/pipelineFormat";
import { mapCommitToMove, type PipelineCommitMetaLike } from "./commitMapper";
import type { PipelineBoardDeal } from "./adapter";

function makeDeal(
  overrides: Partial<PipelineBoardDeal> & Pick<PipelineBoardDeal, "id" | "title" | "stage" | "stageOrder">,
): PipelineBoardDeal {
  return {
    customerName: "Acme Corp",
    dealValue: 0,
    picId: null,
    pic: null,
    winProbability: 50,
    deadline: null,
    wonAt: null,
    ...overrides,
  };
}

/**
 * groupedAll equivalent — unfiltered per-stage buckets, stageOrder asc / id
 * asc tiebreak. Deliberately reimplemented locally rather than imported
 * from adapter.ts's `projectToColumns` (same choice kanban-v2/
 * commitMapper.test.ts makes for its own `groupedAll`) — fixture
 * construction shouldn't depend on the sibling module under test elsewhere.
 */
function groupedAll(deals: PipelineBoardDeal[]): Record<string, PipelineBoardDeal[]> {
  const map: Record<string, PipelineBoardDeal[]> = {};
  for (const stage of STAGE_ORDER) map[stage] = [];
  for (const deal of deals) map[deal.stage].push(deal);
  for (const stage of STAGE_ORDER) {
    map[stage].sort((a, b) => a.stageOrder - b.stageOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return map;
}

describe("commitMapper — same-column reorder", () => {
  it("drag D3 onto D1 (drop above) in ASSESSMENT -> D3 lands at the exact committed index", () => {
    const D1 = makeDeal({ id: "d1", title: "D1", stage: "ASSESSMENT", stageOrder: 0 });
    const D2 = makeDeal({ id: "d2", title: "D2", stage: "ASSESSMENT", stageOrder: 1 });
    const D3 = makeDeal({ id: "d3", title: "D3", stage: "ASSESSMENT", stageOrder: 2 });
    const previousValue = groupedAll([D1, D2, D3]);
    const committedValue = { ...previousValue, ASSESSMENT: [D3, D1, D2] };
    const meta: PipelineCommitMetaLike = {
      kind: "item",
      activeContainer: "ASSESSMENT",
      activeIndex: 2,
      overContainer: "ASSESSMENT",
      overIndex: 0,
      previousValue,
    };

    expect(mapCommitToMove(committedValue, meta)).toEqual({
      opportunityId: "d3",
      stage: "ASSESSMENT",
      stageOrder: 0,
    });
  });

  it("one-slot downward reorder within a stage resolves to the committed index, not a no-op", () => {
    const D1 = makeDeal({ id: "d1", title: "D1", stage: "ASSESSMENT", stageOrder: 0 });
    const D2 = makeDeal({ id: "d2", title: "D2", stage: "ASSESSMENT", stageOrder: 1 });
    const D3 = makeDeal({ id: "d3", title: "D3", stage: "ASSESSMENT", stageOrder: 2 });
    const previousValue = groupedAll([D1, D2, D3]);
    const committedValue = { ...previousValue, ASSESSMENT: [D1, D3, D2] };
    const meta: PipelineCommitMetaLike = {
      kind: "item",
      activeContainer: "ASSESSMENT",
      activeIndex: 1,
      overContainer: "ASSESSMENT",
      overIndex: 2,
      previousValue,
    };

    const result = mapCommitToMove(committedValue, meta);
    expect(result).toEqual({ opportunityId: "d2", stage: "ASSESSMENT", stageOrder: 2 });
    expect(result?.stageOrder).not.toBe(D2.stageOrder);
  });
});

describe("commitMapper — cross-column drop index math", () => {
  it("drag a deal from ASSESSMENT onto a card mid-RFP -> stageOrder is the committed drop index within RFP", () => {
    const A1 = makeDeal({ id: "a1", title: "A1", stage: "ASSESSMENT", stageOrder: 0 });
    const R1 = makeDeal({ id: "r1", title: "R1", stage: "RFP", stageOrder: 0 });
    const R2 = makeDeal({ id: "r2", title: "R2", stage: "RFP", stageOrder: 1 });
    const previousValue = groupedAll([A1, R1, R2]);
    const committedValue = {
      ...previousValue,
      ASSESSMENT: [],
      RFP: [R1, A1, R2],
    };
    const meta: PipelineCommitMetaLike = {
      kind: "item",
      activeContainer: "ASSESSMENT",
      activeIndex: 0,
      overContainer: "RFP",
      overIndex: 1,
      previousValue,
    };

    expect(mapCommitToMove(committedValue, meta)).toEqual({
      opportunityId: "a1",
      stage: "RFP",
      stageOrder: 1,
    });
  });

  it("drag onto the tail of a cross-column stage appends at the committed last index", () => {
    const A1 = makeDeal({ id: "a1", title: "A1", stage: "ASSESSMENT", stageOrder: 0 });
    const W1 = makeDeal({ id: "w1", title: "W1", stage: "WON", stageOrder: 0 });
    const W2 = makeDeal({ id: "w2", title: "W2", stage: "WON", stageOrder: 1 });
    const previousValue = groupedAll([A1, W1, W2]);
    const committedValue = {
      ...previousValue,
      ASSESSMENT: [],
      WON: [W1, W2, A1],
    };
    const meta: PipelineCommitMetaLike = {
      kind: "item",
      activeContainer: "ASSESSMENT",
      activeIndex: 0,
      overContainer: "WON",
      overIndex: 2,
      previousValue,
    };

    expect(mapCommitToMove(committedValue, meta)).toEqual({
      opportunityId: "a1",
      stage: "WON",
      stageOrder: 2,
    });
  });
});

describe("commitMapper — empty stages", () => {
  it("drag a deal onto a genuinely empty stage column -> stageOrder 0", () => {
    const A1 = makeDeal({ id: "a1", title: "A1", stage: "ASSESSMENT", stageOrder: 0 });
    const previousValue = groupedAll([A1]);
    const committedValue = { ...previousValue, ASSESSMENT: [], POC: [A1] };
    const meta: PipelineCommitMetaLike = {
      kind: "item",
      activeContainer: "ASSESSMENT",
      activeIndex: 0,
      overContainer: "POC",
      overIndex: 0,
      previousValue,
    };

    expect(mapCommitToMove(committedValue, meta)).toEqual({
      opportunityId: "a1",
      stage: "POC",
      stageOrder: 0,
    });
  });
});

describe("commitMapper — no-op guards", () => {
  it("dropping a deal back in its original slot fires no request", () => {
    const A1 = makeDeal({ id: "a1", title: "A1", stage: "ASSESSMENT", stageOrder: 0 });
    const A2 = makeDeal({ id: "a2", title: "A2", stage: "ASSESSMENT", stageOrder: 1 });
    const previousValue = groupedAll([A1, A2]);
    const committedValue = groupedAll([A1, A2]);
    const meta: PipelineCommitMetaLike = {
      kind: "item",
      activeContainer: "ASSESSMENT",
      activeIndex: 0,
      overContainer: "ASSESSMENT",
      overIndex: 0,
      previousValue,
    };

    expect(mapCommitToMove(committedValue, meta)).toBeNull();
  });

  it("kind: 'column' always fires no request (column reordering unsupported)", () => {
    const A1 = makeDeal({ id: "a1", title: "A1", stage: "ASSESSMENT", stageOrder: 0 });
    const R1 = makeDeal({ id: "r1", title: "R1", stage: "RFP", stageOrder: 0 });
    const previousValue = groupedAll([A1, R1]);
    // Columns swapped — an arrangement that would NOT be a no-op if treated
    // as an item commit, to prove the "column" kind short-circuit fires
    // independently of the arrangement guard.
    const committedValue: Record<string, PipelineBoardDeal[]> = {
      ...previousValue,
      ASSESSMENT: previousValue.RFP,
      RFP: previousValue.ASSESSMENT,
    };
    const meta: PipelineCommitMetaLike = {
      kind: "column",
      activeContainer: "ASSESSMENT",
      activeIndex: 0,
      overContainer: "RFP",
      overIndex: 1,
      previousValue,
    };

    expect(mapCommitToMove(committedValue, meta)).toBeNull();
  });

  it("unknown overContainer (not a PIPELINE_STAGES member) fires no request instead of an unchecked cast", () => {
    const A1 = makeDeal({ id: "a1", title: "A1", stage: "ASSESSMENT", stageOrder: 0 });
    const previousValue = groupedAll([A1]);
    const committedValue: Record<string, PipelineBoardDeal[]> = { ...previousValue, BOGUS: [A1] };
    const meta: PipelineCommitMetaLike = {
      kind: "item",
      activeContainer: "ASSESSMENT",
      activeIndex: 0,
      overContainer: "BOGUS",
      overIndex: 0,
      previousValue,
    };

    expect(mapCommitToMove(committedValue, meta)).toBeNull();
  });

  it("a committed overIndex with no deal at that slot fires no request (defensive)", () => {
    const A1 = makeDeal({ id: "a1", title: "A1", stage: "ASSESSMENT", stageOrder: 0 });
    const R1 = makeDeal({ id: "r1", title: "R1", stage: "RFP", stageOrder: 0 });
    const previousValue = groupedAll([A1, R1]);
    const committedValue = { ...previousValue, ASSESSMENT: [], RFP: [R1, A1] };
    const meta: PipelineCommitMetaLike = {
      kind: "item",
      activeContainer: "ASSESSMENT",
      activeIndex: 0,
      overContainer: "RFP",
      overIndex: 5, // out of range — no deal committed at this slot
      previousValue,
    };

    expect(mapCommitToMove(committedValue, meta)).toBeNull();
  });
});
