import { describe, expect, it } from "vitest";
import { STAGE_ORDER } from "@/lib/pipelineFormat";
import {
  compareDealsByStageOrder,
  PIPELINE_STAGES,
  projectToColumns,
  sortDealsCanonical,
  type PipelineBoardDeal,
} from "./adapter";

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

describe("adapter — PIPELINE_STAGES", () => {
  it("re-exports all 9 STAGE_ORDER members verbatim, in order (guard: every STAGE_ORDER member produces a column)", () => {
    expect(PIPELINE_STAGES).toEqual(STAGE_ORDER);
    expect(PIPELINE_STAGES).toHaveLength(9);
  });
});

describe("adapter — projectToColumns", () => {
  it("groups a mixed-stage deal list into per-stage columns, sorted stageOrder asc / id asc tiebreak (round-trip of grouping/ordering)", () => {
    const deals = [
      makeDeal({ id: "b2", title: "B2", stage: "RFP", stageOrder: 1 }),
      makeDeal({ id: "a1", title: "A1", stage: "ASSESSMENT", stageOrder: 0 }),
      makeDeal({ id: "b1", title: "B1", stage: "RFP", stageOrder: 0 }),
      makeDeal({ id: "w1", title: "W1", stage: "WON", stageOrder: 0 }),
    ];

    const columns = projectToColumns(deals);

    expect(columns.ASSESSMENT.map((d) => d.id)).toEqual(["a1"]);
    expect(columns.RFP.map((d) => d.id)).toEqual(["b1", "b2"]);
    expect(columns.WON.map((d) => d.id)).toEqual(["w1"]);
    // Untouched stages still present, as empty arrays.
    expect(columns.POC).toEqual([]);
    expect(columns.TECHNICAL_CLARIFICATION).toEqual([]);
    expect(columns.DELIVER_PROPOSAL).toEqual([]);
    expect(columns.WAITING_RESPONSE).toEqual([]);
    expect(columns.DROP).toEqual([]);
    expect(columns.HOLD).toEqual([]);
  });

  it("always includes all 9 PIPELINE_STAGES columns, empty arrays allowed, on an empty input (empty stages)", () => {
    const columns = projectToColumns([]);
    expect(Object.keys(columns).sort()).toEqual([...STAGE_ORDER].sort());
    for (const stage of STAGE_ORDER) {
      expect(columns[stage]).toEqual([]);
    }
  });

  it("orders within a stage by stageOrder ascending, id ascending tiebreak (out-of-order input, tied stageOrder)", () => {
    const tied = [
      makeDeal({ id: "c1", title: "third-by-id", stage: "POC", stageOrder: 0 }),
      makeDeal({ id: "a1", title: "first-by-id", stage: "POC", stageOrder: 0 }),
      makeDeal({ id: "m1", title: "middle-by-id", stage: "POC", stageOrder: 5 }),
    ];

    const columns = projectToColumns(tied);

    // Two deals tie at stageOrder 0 -> id ascending tiebreak ("a1" before
    // "c1"); stageOrder 5 sorts after both regardless of input order.
    expect(columns.POC.map((d) => d.id)).toEqual(["a1", "c1", "m1"]);
  });

  it("filtering hides deals from the projected columns without touching input order or stageOrder", () => {
    const deals = [
      makeDeal({ id: "a1", title: "A1", stage: "ASSESSMENT", stageOrder: 0 }),
      makeDeal({ id: "a2", title: "A2", stage: "ASSESSMENT", stageOrder: 1 }),
    ];
    const hideA2 = (d: PipelineBoardDeal) => d.id !== "a2";

    const columns = projectToColumns(deals, hideA2);

    expect(columns.ASSESSMENT.map((d) => d.id)).toEqual(["a1"]);
    // Original deal objects/order untouched by filtering.
    expect(deals[1].stageOrder).toBe(1);
    expect(deals.map((d) => d.id)).toEqual(["a1", "a2"]);
  });
});

describe("adapter — sort helpers", () => {
  it("compareDealsByStageOrder / sortDealsCanonical produce the same canonical order projectToColumns relies on", () => {
    const shuffled = [
      makeDeal({ id: "w1", title: "W1", stage: "WON", stageOrder: 4 }),
      makeDeal({ id: "a1", title: "A1", stage: "ASSESSMENT", stageOrder: 0 }),
      makeDeal({ id: "d1", title: "D1", stage: "DELIVER_PROPOSAL", stageOrder: 3 }),
      makeDeal({ id: "b1", title: "B1", stage: "RFP", stageOrder: 1 }),
      makeDeal({ id: "c1", title: "C1", stage: "POC", stageOrder: 2 }),
    ];

    const sorted = sortDealsCanonical(shuffled);
    expect(sorted.map((d) => d.id)).toEqual(["a1", "b1", "c1", "d1", "w1"]);
    // Does not mutate the input array.
    expect(shuffled.map((d) => d.id)).toEqual(["w1", "a1", "d1", "b1", "c1"]);
    // Exported comparator matches sortDealsCanonical's own ordering.
    expect([...shuffled].sort(compareDealsByStageOrder).map((d) => d.id)).toEqual(
      sorted.map((d) => d.id),
    );
  });
});
