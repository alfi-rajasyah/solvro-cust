import { describe, expect, it } from "vitest";
import { BOARD_COLUMNS, type BoardColumn } from "./boardAdapter";
import { allowedTargets, mapDropToAction } from "./dropMapper";

// Full from x to matrix, per the dispatch's acceptance table (iTop's default
// UserRequest/Incident lifecycle, docs/archive/plans/itop-integration.md decision 10).
const EXPECTED: Record<string, { action: string; needsSheet: "resolve" | null } | null> = {
  "new>assigned": { action: "assign_to_me", needsSheet: null },
  "new>pending": null,
  "new>resolved": null,
  "new>closed": null,
  "new>new": null,
  "assigned>pending": { action: "pending", needsSheet: null },
  "assigned>resolved": { action: "resolve", needsSheet: "resolve" },
  "assigned>new": null,
  "assigned>closed": null,
  "assigned>assigned": null,
  "pending>assigned": null,
  "pending>resolved": { action: "resolve", needsSheet: "resolve" },
  "pending>new": null,
  "pending>closed": null,
  "pending>pending": null,
  "resolved>closed": { action: "close", needsSheet: null },
  "resolved>assigned": { action: "reopen", needsSheet: null },
  "resolved>new": null,
  "resolved>pending": null,
  "resolved>resolved": null,
  "closed>new": null,
  "closed>assigned": null,
  "closed>pending": null,
  "closed>resolved": null,
  "closed>closed": null,
};

describe("mapDropToAction — full matrix", () => {
  for (const from of BOARD_COLUMNS) {
    for (const to of BOARD_COLUMNS) {
      const key = `${from}>${to}`;
      it(`${key} -> ${JSON.stringify(EXPECTED[key])}`, () => {
        expect(mapDropToAction(from, to)).toEqual(EXPECTED[key] ?? null);
      });
    }
  }

  it("covers every from/to pair in the matrix (no gaps)", () => {
    expect(Object.keys(EXPECTED).length).toBe(BOARD_COLUMNS.length * BOARD_COLUMNS.length);
  });
});

describe("allowedTargets", () => {
  const cases: Array<[BoardColumn, BoardColumn[]]> = [
    ["new", ["assigned"]],
    ["assigned", ["pending", "resolved"]],
    ["pending", ["resolved"]],
    ["resolved", ["closed", "assigned"]],
    ["closed", []],
  ];

  for (const [from, expected] of cases) {
    it(`from ${from}`, () => {
      expect(allowedTargets(from).sort()).toEqual([...expected].sort());
    });
  }
});
