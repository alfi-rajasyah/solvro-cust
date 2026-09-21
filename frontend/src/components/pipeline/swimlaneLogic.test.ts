import { describe, expect, it } from "vitest";
import {
  dealsInCell,
  groupIntoLanes,
  laneSummary,
  stageSummaries,
  SWIMLANE_STAGES,
  type SwimlaneDeal,
} from "./swimlaneLogic";

function deal(overrides: Partial<SwimlaneDeal> & Pick<SwimlaneDeal, "id" | "stage">): SwimlaneDeal {
  return {
    title: "Deal",
    dealValue: 0,
    picId: null,
    pic: null,
    deadline: null,
    ...overrides,
  };
}

describe("SWIMLANE_STAGES", () => {
  it("excludes DROP and nothing else — 8 stages (PRD §2.4: columns = stages minus drop)", () => {
    expect(SWIMLANE_STAGES).not.toContain("DROP");
    expect(SWIMLANE_STAGES).toEqual([
      "ASSESSMENT",
      "RFP",
      "POC",
      "TECHNICAL_CLARIFICATION",
      "DELIVER_PROPOSAL",
      "WAITING_RESPONSE",
      "WON",
      "HOLD",
    ]);
  });
});

describe("groupIntoLanes", () => {
  it("groups by picId and sorts lanes by display name ascending", () => {
    const deals = [
      deal({ id: "1", stage: "RFP", picId: 2, pic: { id: 2, username: "Zoe" } }),
      deal({ id: "2", stage: "ASSESSMENT", picId: 1, pic: { id: 1, username: "Amir" } }),
      deal({ id: "3", stage: "WON", picId: 1, pic: { id: 1, username: "Amir" } }),
    ];

    const lanes = groupIntoLanes(deals);

    expect(lanes.map((l) => l.picName)).toEqual(["Amir", "Zoe"]);
    expect(lanes[0].deals.map((d) => d.id)).toEqual(["2", "3"]);
    expect(lanes[1].deals.map((d) => d.id)).toEqual(["1"]);
  });

  it("buckets a null picId into a single 'Unassigned' lane", () => {
    const deals = [
      deal({ id: "1", stage: "RFP", picId: null, pic: null }),
      deal({ id: "2", stage: "HOLD", picId: null, pic: null }),
    ];

    const lanes = groupIntoLanes(deals);

    expect(lanes).toHaveLength(1);
    expect(lanes[0].picName).toBe("Unassigned");
    expect(lanes[0].picId).toBeNull();
    expect(lanes[0].deals.map((d) => d.id)).toEqual(["1", "2"]);
  });

  it("sorts 'Unassigned' alphabetically alongside named lanes, not pinned first/last", () => {
    const deals = [
      deal({ id: "1", stage: "RFP", picId: null, pic: null }), // "Unassigned"
      deal({ id: "2", stage: "RFP", picId: 1, pic: { id: 1, username: "Amir" } }),
      deal({ id: "3", stage: "RFP", picId: 2, pic: { id: 2, username: "Zoe" } }),
    ];

    const lanes = groupIntoLanes(deals);

    // "Amir" < "Unassigned" < "Zoe" under localeCompare — mirrors the
    // reference's plain string sort, no special-casing for the unassigned bucket.
    expect(lanes.map((l) => l.picName)).toEqual(["Amir", "Unassigned", "Zoe"]);
  });

  it("preserves input order within a lane and does not mutate the input array", () => {
    const deals = [
      deal({ id: "b", stage: "RFP", picId: 1, pic: { id: 1, username: "Amir" } }),
      deal({ id: "a", stage: "WON", picId: 1, pic: { id: 1, username: "Amir" } }),
    ];
    const snapshot = [...deals];

    const lanes = groupIntoLanes(deals);

    expect(lanes[0].deals.map((d) => d.id)).toEqual(["b", "a"]);
    expect(deals).toEqual(snapshot);
  });

  it("returns an empty array for an empty deal list", () => {
    expect(groupIntoLanes([])).toEqual([]);
  });
});

describe("dealsInCell", () => {
  it("filters a lane's deals down to one stage", () => {
    const lane = {
      picId: 1,
      picName: "Amir",
      pic: { id: 1, username: "Amir" },
      deals: [
        deal({ id: "1", stage: "RFP" }),
        deal({ id: "2", stage: "WON" }),
        deal({ id: "3", stage: "RFP" }),
      ],
    };

    expect(dealsInCell(lane, "RFP").map((d) => d.id)).toEqual(["1", "3"]);
    expect(dealsInCell(lane, "HOLD")).toEqual([]);
  });
});

describe("laneSummary", () => {
  it("excludes WON deals from the count and value sum (mirrors reference's activeOpps)", () => {
    const lane = {
      picId: 1,
      picName: "Amir",
      pic: { id: 1, username: "Amir" },
      deals: [
        deal({ id: "1", stage: "RFP", dealValue: 100 }),
        deal({ id: "2", stage: "WON", dealValue: 999 }),
        deal({ id: "3", stage: "HOLD", dealValue: 50 }),
      ],
    };

    expect(laneSummary(lane)).toEqual({ count: 2, total: 150 });
  });

  it("returns zeroes for a lane with no active deals", () => {
    const lane = {
      picId: 1,
      picName: "Amir",
      pic: { id: 1, username: "Amir" },
      deals: [deal({ id: "1", stage: "WON", dealValue: 500 })],
    };

    expect(laneSummary(lane)).toEqual({ count: 0, total: 0 });
  });

  // A DROP deal never reaches a lane in practice today (PipelineSwimlane.tsx
  // filters it out of `allDeals` before calling `groupIntoLanes`), but
  // `groupIntoLanes` itself doesn't filter by stage — this exercises
  // `laneSummary`'s own `isActiveDeal` exclusion as the independent safety
  // net its doc comment describes, in case a DROP deal ever did land here.
  it("excludes DROP deals from the count and value sum, same as WON", () => {
    const lane = {
      picId: 1,
      picName: "Amir",
      pic: { id: 1, username: "Amir" },
      deals: [
        deal({ id: "1", stage: "RFP", dealValue: 100 }),
        deal({ id: "2", stage: "DROP", dealValue: 999 }),
      ],
    };

    expect(laneSummary(lane)).toEqual({ count: 1, total: 100 });
  });
});

describe("stageSummaries", () => {
  it("sums count + value per stage across all lanes, INCLUDING won", () => {
    const lanes = groupIntoLanes([
      deal({ id: "1", stage: "RFP", dealValue: 100, picId: 1, pic: { id: 1, username: "Amir" } }),
      deal({ id: "2", stage: "RFP", dealValue: 200, picId: 2, pic: { id: 2, username: "Zoe" } }),
      deal({ id: "3", stage: "WON", dealValue: 999, picId: 1, pic: { id: 1, username: "Amir" } }),
    ]);

    const summaries = stageSummaries(lanes);

    expect(summaries.find((s) => s.stage === "RFP")).toEqual({ stage: "RFP", count: 2, total: 300 });
    expect(summaries.find((s) => s.stage === "WON")).toEqual({ stage: "WON", count: 1, total: 999 });
    expect(summaries.find((s) => s.stage === "ASSESSMENT")).toEqual({
      stage: "ASSESSMENT",
      count: 0,
      total: 0,
    });
  });

  it("always returns every SWIMLANE_STAGES entry, in order, even for an empty lane list", () => {
    const summaries = stageSummaries([]);
    expect(summaries.map((s) => s.stage)).toEqual(SWIMLANE_STAGES);
    for (const s of summaries) {
      expect(s).toMatchObject({ count: 0, total: 0 });
    }
  });
});
