// Pure-helper suite — no DB. Importing scripts/import-velora.ts must not open
// a Prisma connection; see the isMainModule guard at the bottom of that
// file (same discipline as test/normalizeDayDates.test.ts).
import { describe, expect, it } from "vitest";
import { PipelineStage } from "@prisma/client";
import {
  buildEmailIndex,
  checkTargetSafety,
  chunk,
  findNonDenseStageOrders,
  mapStageLiteral,
  matchProfileToUser,
  toDaySemanticDate,
} from "../scripts/import-velora.js";

describe("mapStageLiteral", () => {
  it("maps all 9 current Velora stage literals onto PipelineStage", () => {
    expect(mapStageLiteral("assessment")).toBe(PipelineStage.ASSESSMENT);
    expect(mapStageLiteral("rfp")).toBe(PipelineStage.RFP);
    expect(mapStageLiteral("poc")).toBe(PipelineStage.POC);
    expect(mapStageLiteral("technical_clarification")).toBe(PipelineStage.TECHNICAL_CLARIFICATION);
    expect(mapStageLiteral("deliver_proposal")).toBe(PipelineStage.DELIVER_PROPOSAL);
    expect(mapStageLiteral("waiting_response")).toBe(PipelineStage.WAITING_RESPONSE);
    expect(mapStageLiteral("won")).toBe(PipelineStage.WON);
    expect(mapStageLiteral("drop")).toBe(PipelineStage.DROP);
    expect(mapStageLiteral("hold")).toBe(PipelineStage.HOLD);
  });

  it("is trim/case insensitive", () => {
    expect(mapStageLiteral("  ASSESSMENT  ")).toBe(PipelineStage.ASSESSMENT);
    expect(mapStageLiteral("Hold")).toBe(PipelineStage.HOLD);
  });

  it("maps Velora's pre-rename legacy literals defensively", () => {
    expect(mapStageLiteral("lead")).toBe(PipelineStage.ASSESSMENT);
    expect(mapStageLiteral("qualified")).toBe(PipelineStage.RFP);
    expect(mapStageLiteral("proposal")).toBe(PipelineStage.DELIVER_PROPOSAL);
    expect(mapStageLiteral("negotiation")).toBe(PipelineStage.WAITING_RESPONSE);
    expect(mapStageLiteral("lost")).toBe(PipelineStage.DROP);
  });

  it("returns undefined for an unrecognized literal", () => {
    expect(mapStageLiteral("banana")).toBeUndefined();
    expect(mapStageLiteral("")).toBeUndefined();
  });
});

describe("toDaySemanticDate", () => {
  it("returns null through", () => {
    expect(toDaySemanticDate(null)).toBeNull();
  });

  it("produces exact UTC midnight for a day string, never local-midnight drift", () => {
    const d = toDaySemanticDate("2026-03-14");
    expect(d?.toISOString()).toBe("2026-03-14T00:00:00.000Z");
  });
});

describe("findNonDenseStageOrders", () => {
  it("reports nothing for dense 0..n-1 orders within each stage", () => {
    const rows = [
      { stage: "assessment", stage_order: 0 },
      { stage: "assessment", stage_order: 1 },
      { stage: "rfp", stage_order: 0 },
    ];
    expect(findNonDenseStageOrders(rows)).toEqual([]);
  });

  it("flags a gap without resequencing", () => {
    const rows = [
      { stage: "assessment", stage_order: 0 },
      { stage: "assessment", stage_order: 2 },
    ];
    expect(findNonDenseStageOrders(rows)).toEqual([{ stage: "assessment", orders: [0, 2] }]);
  });

  it("flags a duplicate order", () => {
    const rows = [
      { stage: "hold", stage_order: 0 },
      { stage: "hold", stage_order: 0 },
    ];
    expect(findNonDenseStageOrders(rows)).toEqual([{ stage: "hold", orders: [0, 0] }]);
  });

  it("scopes the density check per stage independently", () => {
    const rows = [
      { stage: "won", stage_order: 0 },
      { stage: "won", stage_order: 1 },
      { stage: "drop", stage_order: 0 },
      { stage: "drop", stage_order: 5 },
    ];
    expect(findNonDenseStageOrders(rows)).toEqual([{ stage: "drop", orders: [0, 5] }]);
  });
});

describe("buildEmailIndex / matchProfileToUser", () => {
  const index = buildEmailIndex([
    { id: 1, email: "Jane.Doe@Solvro.local" },
    { id: 2, email: "bob@solvro.local" },
  ]);

  it("matches case-insensitively", () => {
    expect(matchProfileToUser("jane.doe@solvro.local", index)).toBe(1);
    expect(matchProfileToUser("BOB@SOLVRO.LOCAL", index)).toBe(2);
  });

  it("returns null for no match — never creates a user", () => {
    expect(matchProfileToUser("ghost@solvro.local", index)).toBeNull();
  });
});

describe("checkTargetSafety", () => {
  it("refuses when DATABASE_URL is unset", () => {
    const result = checkTargetSafety(undefined, true);
    expect(result.ok).toBe(false);
  });

  it("refuses an unrecognized database name even when confirmed", () => {
    const result = checkTargetSafety("postgresql://u:p@host:5432/velora", true);
    expect(result.ok).toBe(false);
  });

  it("refuses the solvro database without --yes/CONFIRM", () => {
    const result = checkTargetSafety("postgresql://u:p@host:5432/solvro", false);
    expect(result.ok).toBe(false);
  });

  it("allows the solvro database when confirmed", () => {
    expect(checkTargetSafety("postgresql://u:p@host:5432/solvro", true)).toEqual({ ok: true });
  });

  it("allows any *_test database when confirmed", () => {
    expect(checkTargetSafety("postgresql://u:p@host:5432/solvro_test", true)).toEqual({ ok: true });
    expect(checkTargetSafety("postgresql://u:p@host:5432/foo_test?schema=public", true)).toEqual({ ok: true });
  });
});

describe("chunk", () => {
  it("splits into fixed-size batches with a smaller final batch", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns an empty array for empty input", () => {
    expect(chunk([], 3)).toEqual([]);
  });
});
