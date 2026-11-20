import { describe, expect, it } from "vitest";
import { parseStoryPoints, storyPointTotalsByEpic, sumStoryPoints } from "./storyPoints";

describe("parseStoryPoints", () => {
  it("treats empty as not estimated", () => {
    expect(parseStoryPoints("")).toEqual({ ok: true, value: null });
    expect(parseStoryPoints("  ")).toEqual({ ok: true, value: null });
  });
  it("accepts whole numbers 0 to 100", () => {
    expect(parseStoryPoints("0")).toEqual({ ok: true, value: 0 });
    expect(parseStoryPoints(" 13 ")).toEqual({ ok: true, value: 13 });
    expect(parseStoryPoints("100")).toEqual({ ok: true, value: 100 });
  });
  it("refuses anything else", () => {
    for (const bad of ["101", "-1", "2.5", "1e2", "abc", "3 5"]) {
      expect(parseStoryPoints(bad).ok).toBe(false);
    }
  });
});

const t = (
  over: Partial<{ parentTaskId: number | null; status: "TODO" | "DONE"; storyPoints: number | null; epicId: number | null }>,
) => ({ parentTaskId: null, status: "TODO" as const, storyPoints: null, epicId: null, ...over });

describe("sumStoryPoints", () => {
  it("sums top-level tasks and the done part; subtasks and unestimated tasks add nothing", () => {
    expect(
      sumStoryPoints([
        t({ storyPoints: 3 }),
        t({ storyPoints: 5, status: "DONE" }),
        t({ storyPoints: 8, parentTaskId: 1 }),
        t({ storyPoints: 13, parentTaskId: 1, status: "DONE" }),
        t({ storyPoints: null }),
        t({ storyPoints: 0, status: "DONE" }),
      ]),
    ).toEqual({ total: 8, done: 5, estimated: 3 });
  });
  it("counts a task estimated at 0 as estimated", () => {
    expect(sumStoryPoints([t({ storyPoints: 0 }), t({ storyPoints: null })])).toEqual({
      total: 0,
      done: 0,
      estimated: 1,
    });
    expect(sumStoryPoints([t({ storyPoints: null })]).estimated).toBe(0);
  });
  it("is zero for an empty list", () => {
    expect(sumStoryPoints([])).toEqual({ total: 0, done: 0, estimated: 0 });
  });
});

describe("storyPointTotalsByEpic", () => {
  it("groups by epic and ignores tasks without one", () => {
    const m = storyPointTotalsByEpic([
      t({ epicId: 1, storyPoints: 2 }),
      t({ epicId: 1, storyPoints: 3, status: "DONE" }),
      t({ epicId: 2, storyPoints: 8 }),
      t({ epicId: null, storyPoints: 21 }),
    ]);
    expect(m.get(1)).toEqual({ total: 5, done: 3, estimated: 2 });
    expect(m.get(2)).toEqual({ total: 8, done: 0, estimated: 1 });
    expect(m.size).toBe(2);
  });
});
