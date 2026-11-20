import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/queries";
import {
  EMPTY_FILTERS,
  buildFilterContext,
  carryFilterSearch,
  clearPatch,
  countActiveFilters,
  parseTaskFilters,
  reorderAmongVisible,
  visibleOrderUnchanged,
  scopeFilters,
  taskMatchesEpic,
  taskMatchesLabels,
  taskVisible,
  writeTaskFilters,
  type TaskFilters,
} from "./taskFilters";

function task(id: number, over: Partial<Task> = {}): Task {
  return {
    id,
    parentTaskId: null,
    epicId: null,
    labels: [],
    assignedToId: null,
    priority: "MEDIUM",
    ...over,
  } as unknown as Task;
}

const label = (id: number) => ({ id, projectId: 1, name: `L${id}`, color: "#000000" });
const f = (over: Partial<TaskFilters>): TaskFilters => ({ ...EMPTY_FILTERS, ...over });

describe("URL encoding", () => {
  it("round-trips every control", () => {
    const filters = f({ epic: 12, labelIds: [3, 7], noLabel: true, assigneeId: 5, priority: "HIGH" });
    const params = writeTaskFilters(new URLSearchParams("task=9&epic=2"), filters);
    expect(params.get("epicFilter")).toBe("12");
    expect(params.get("labels")).toBe("3,7,none");
    expect(params.get("task")).toBe("9");
    expect(parseTaskFilters(params)).toEqual(filters);
  });

  it("encodes No epic and drops inactive params", () => {
    const p = writeTaskFilters(new URLSearchParams("epicFilter=4&labels=1"), f({ epic: "none" }));
    expect(p.get("epicFilter")).toBe("none");
    expect(p.has("labels")).toBe(false);
    expect(writeTaskFilters(p, EMPTY_FILTERS).toString()).toBe("");
  });

  it("ignores malformed values", () => {
    const parsed = parseTaskFilters(new URLSearchParams("epicFilter=abc&labels=1,x,,2,1&assignee=-3&priority=NOPE"));
    expect(parsed).toEqual(f({ labelIds: [1, 2] }));
  });

  it("carries only the filter params between tabs", () => {
    const params = new URLSearchParams("task=9&epic=2&epicFilter=none&labels=3,none&new=task");
    expect(carryFilterSearch(params)).toBe("?epicFilter=none&labels=3%2Cnone");
    expect(carryFilterSearch(new URLSearchParams("task=9"))).toBe("");
  });
});

describe("epic filter", () => {
  const parent = task(1, { epicId: 10 });
  const sub = task(2, { parentTaskId: 1, epicId: null });
  const noEpic = task(3);
  const { tasksById } = buildFilterContext([parent, sub, noEpic]);

  it("a subtask inherits its parent's epic", () => {
    expect(taskMatchesEpic(sub, tasksById, 10)).toBe(true);
    expect(taskMatchesEpic(sub, tasksById, "none")).toBe(false);
  });

  it("matches All, No epic and one epic", () => {
    expect(taskMatchesEpic(noEpic, tasksById, "all")).toBe(true);
    expect(taskMatchesEpic(noEpic, tasksById, "none")).toBe(true);
    expect(taskMatchesEpic(noEpic, tasksById, 10)).toBe(false);
    expect(taskMatchesEpic(parent, tasksById, "none")).toBe(false);
  });
});

describe("label filter", () => {
  it("is inactive with nothing selected", () => {
    expect(taskMatchesLabels(task(1), f({}))).toBe(true);
  });

  it("ORs the selected labels", () => {
    const t = task(1, { labels: [label(2)] });
    expect(taskMatchesLabels(t, f({ labelIds: [1, 2] }))).toBe(true);
    expect(taskMatchesLabels(t, f({ labelIds: [1, 3] }))).toBe(false);
  });

  it("No label matches only unlabelled tasks, and ORs with selected labels", () => {
    expect(taskMatchesLabels(task(1), f({ noLabel: true }))).toBe(true);
    expect(taskMatchesLabels(task(1, { labels: [label(1)] }), f({ noLabel: true }))).toBe(false);
    expect(taskMatchesLabels(task(1, { labels: [label(1)] }), f({ noLabel: true, labelIds: [1] }))).toBe(true);
    expect(taskMatchesLabels(task(1), f({ noLabel: true, labelIds: [1] }))).toBe(true);
  });
});

describe("taskVisible", () => {
  const parent = task(1, { labels: [label(1)], epicId: 10, assignedToId: 4 });
  const matchingSub = task(2, { parentTaskId: 1, labels: [label(2)] });
  const otherSub = task(3, { parentTaskId: 1, labels: [label(1)] });
  const plain = task(4, { epicId: 10, priority: "URGENT" });
  const ctx = buildFilterContext([parent, matchingSub, otherSub, plain]);

  it("shows everything with no filter", () => {
    for (const t of [parent, matchingSub, otherSub, plain]) expect(taskVisible(t, EMPTY_FILTERS, ctx)).toBe(true);
  });

  it("a subtask follows its own labels", () => {
    const filters = f({ labelIds: [2] });
    expect(taskVisible(matchingSub, filters, ctx)).toBe(true);
    expect(taskVisible(otherSub, filters, ctx)).toBe(false);
  });

  it("a parent stays visible when one of its subtasks matches", () => {
    expect(taskVisible(parent, f({ labelIds: [2] }), ctx)).toBe(true);
    expect(taskVisible(plain, f({ labelIds: [2] }), ctx)).toBe(false);
  });

  it("combines controls with AND", () => {
    expect(taskVisible(parent, f({ epic: 10, labelIds: [1] }), ctx)).toBe(true);
    expect(taskVisible(parent, f({ epic: "none", labelIds: [1] }), ctx)).toBe(false);
    expect(taskVisible(parent, f({ epic: 10, assigneeId: 9 }), ctx)).toBe(false);
    expect(taskVisible(plain, f({ priority: "URGENT", epic: 10 }), ctx)).toBe(true);
    expect(taskVisible(plain, f({ priority: "LOW" }), ctx)).toBe(false);
  });

  it("a subtask is hidden when its parent's epic is filtered out", () => {
    expect(taskVisible(matchingSub, f({ epic: 99 }), ctx)).toBe(false);
    expect(taskVisible(matchingSub, f({ epic: 10 }), ctx)).toBe(true);
  });
});

describe("scope and counting", () => {
  const all = f({ epic: 1, labelIds: [1, 2], noLabel: true, assigneeId: 3, priority: "LOW" });

  it("counts each control once", () => {
    expect(countActiveFilters(all)).toBe(4);
    expect(countActiveFilters(f({ labelIds: [1, 2, 3] }))).toBe(1);
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
  });

  it("scopes views to the controls they show", () => {
    expect(scopeFilters(all, "epic")).toEqual(f({ epic: 1 }));
    expect(scopeFilters(all, "list")).toEqual(f({ epic: 1, labelIds: [1, 2], noLabel: true }));
    expect(scopeFilters(all, "board")).toEqual(all);
  });

  it("clears only what a view shows", () => {
    expect({ ...all, ...clearPatch("list") }).toEqual(f({ assigneeId: 3, priority: "LOW" }));
    expect({ ...all, ...clearPatch("epic") }).toEqual({ ...all, epic: "all" });
    expect({ ...all, ...clearPatch("board") }).toEqual(EMPTY_FILTERS);
  });
});

describe("reorder with hidden rows", () => {
  it("saves nothing when the only visible row is dropped (no other visible row)", () => {
    expect(reorderAmongVisible(["S", "A", "B"], ["S"], "S", 0)).toBeNull();
  });

  it("saves nothing when the visible order is unchanged, even with hidden rows between", () => {
    // Full [S, A(hidden), B]; dropping S back in place must not become [A, S, B].
    expect(reorderAmongVisible(["S", "A", "B"], ["S", "B"], "S", 0)).toBeNull();
    expect(visibleOrderUnchanged(["S", "B"], "S", 0)).toBe(true);
    expect(visibleOrderUnchanged(["S", "B"], "B", 1)).toBe(true);
    expect(visibleOrderUnchanged(["S", "B"], "S", 1)).toBe(false);
  });

  it("anchors a real move on the visible neighbour so hidden rows keep their place", () => {
    // Move S after B: hidden A stays between nothing and B.
    expect(reorderAmongVisible(["S", "A", "B"], ["S", "B"], "S", 1)).toEqual(["A", "B", "S"]);
    // Move B before S.
    expect(reorderAmongVisible(["S", "A", "B"], ["S", "B"], "B", 0)).toEqual(["B", "S", "A"]);
  });

  it("matches a plain reorder when nothing is hidden", () => {
    expect(reorderAmongVisible(["a", "b", "c"], ["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(reorderAmongVisible(["a", "b", "c"], ["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
  });
});
