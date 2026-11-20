import { describe, expect, it } from "vitest";
import {
  bulkResultMessage,
  collectVisibleIds,
  pruneSelection,
  selectAllState,
  selectionHasSubtask,
  toggleAllVisible,
  toggleSelected,
} from "./listSelection";

describe("collectVisibleIds", () => {
  it("lists top-level tasks and their subtasks", () => {
    expect(
      collectVisibleIds([
        { task: { id: 1 }, subtasks: [{ id: 5 }, { id: 6 }] },
        { task: { id: 2 }, subtasks: [] },
      ]),
    ).toEqual([1, 5, 6, 2]);
  });
});

describe("collectVisibleIds with collapsed rows", () => {
  const nodes = [
    { task: { id: 1 }, subtasks: [{ id: 5 }] },
    { task: { id: 2 }, subtasks: [{ id: 6 }] },
  ];
  it("leaves out the subtasks of a collapsed row but keeps the row", () => {
    expect(collectVisibleIds(nodes, new Set([1]))).toEqual([1, 2, 6]);
  });
  it("leaves out collapsed sections when the caller passes only expanded ones", () => {
    const sections = [
      { collapsed: true, nodes },
      { collapsed: false, nodes: [{ task: { id: 9 }, subtasks: [] }] },
    ];
    expect(collectVisibleIds(sections.filter((g) => !g.collapsed).flatMap((g) => g.nodes))).toEqual([9]);
  });
});

describe("bulkResultMessage", () => {
  it("reads well for 0, 1 and many", () => {
    expect(bulkResultMessage(0)).toBe("No tasks changed.");
    expect(bulkResultMessage(1)).toBe("Updated 1 task.");
    expect(bulkResultMessage(4)).toBe("Updated 4 tasks.");
  });
});

describe("pruneSelection", () => {
  it("drops ids that are no longer visible", () => {
    expect([...pruneSelection(new Set([1, 2, 3]), new Set([1, 3]))]).toEqual([1, 3]);
  });

  it("returns the same set when nothing was dropped", () => {
    const selected = new Set([1, 2]);
    expect(pruneSelection(selected, new Set([1, 2, 3]))).toBe(selected);
  });
});

describe("toggleSelected", () => {
  it("adds and removes without mutating the input", () => {
    const a = new Set([1]);
    const b = toggleSelected(a, 2);
    expect([...b]).toEqual([1, 2]);
    expect([...a]).toEqual([1]);
    expect([...toggleSelected(b, 1)]).toEqual([2]);
  });
});

describe("select all visible", () => {
  const visible = [1, 2, 3];

  it("reports none, some and all", () => {
    expect(selectAllState(new Set(), visible)).toBe("none");
    expect(selectAllState(new Set([2]), visible)).toBe("some");
    expect(selectAllState(new Set([1, 2, 3]), visible)).toBe("all");
    expect(selectAllState(new Set([9]), visible)).toBe("none");
    expect(selectAllState(new Set([1]), [])).toBe("none");
  });

  it("selects the rest from the some state, and clears only visible ids from all", () => {
    expect([...toggleAllVisible(new Set([2]), visible)].sort()).toEqual([1, 2, 3]);
    expect([...toggleAllVisible(new Set([1, 2, 3, 9]), visible)]).toEqual([9]);
  });
});

describe("selectionHasSubtask", () => {
  const tasks = [
    { id: 1, parentTaskId: null },
    { id: 2, parentTaskId: 1 },
  ];
  it("is true only when a selected task has a parent", () => {
    expect(selectionHasSubtask(new Set([1]), tasks)).toBe(false);
    expect(selectionHasSubtask(new Set([1, 2]), tasks)).toBe(true);
    expect(selectionHasSubtask(new Set([3]), tasks)).toBe(false);
  });
});
