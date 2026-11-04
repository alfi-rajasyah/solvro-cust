import { describe, expect, it } from "vitest";
import { TASK_CATEGORY_GROUP_LABEL } from "./labels";
import type { TaskStatusDef } from "./queries";
import { compareStatusDefs, groupStatusDefs, statusFilterOptions, statusFilterToQuery, statusSortKey } from "./taskStatuses";

const def = (over: Partial<TaskStatusDef> & Pick<TaskStatusDef, "id" | "category" | "position">): TaskStatusDef => ({
  name: `S${over.id}`,
  color: "gray",
  isDefault: false,
  ...over,
});

const SEEDED = [
  def({ id: 1, name: "To do", category: "TODO", position: 0, isDefault: true }),
  def({ id: 2, name: "In progress", category: "IN_PROGRESS", position: 1, isDefault: true }),
  def({ id: 3, name: "Done", category: "DONE", position: 2, isDefault: true }),
];
// Backlog and Development share TODO / IN_PROGRESS; positions are workspace-wide.
const CUSTOM = [
  def({ id: 4, name: "QA", category: "IN_PROGRESS", position: 3 }),
  ...SEEDED,
  def({ id: 5, name: "Backlog", category: "TODO", position: 4 }),
];

describe("groupStatusDefs", () => {
  it("groups by category in To do / In progress / Done order, each by position", () => {
    const groups = groupStatusDefs(CUSTOM);
    expect(groups.map((g) => g.category)).toEqual(["TODO", "IN_PROGRESS", "DONE"]);
    expect(groups.map((g) => g.defs.map((d) => d.name))).toEqual([
      ["To do", "Backlog"],
      ["In progress", "QA"],
      ["Done"],
    ]);
  });

  it("leaves empty categories out and tolerates no list", () => {
    expect(groupStatusDefs([SEEDED[0]]).map((g) => g.category)).toEqual(["TODO"]);
    expect(groupStatusDefs(undefined)).toEqual([]);
  });
});

describe("status ordering", () => {
  it("sorts category first, then position", () => {
    const sorted = [...CUSTOM].sort(compareStatusDefs).map((d) => d.name);
    expect(sorted).toEqual(["To do", "Backlog", "In progress", "QA", "Done"]);
    const byKey = [...CUSTOM].sort((a, b) => statusSortKey(a) - statusSortKey(b)).map((d) => d.name);
    expect(byKey).toEqual(sorted);
  });
});

describe("statusFilterOptions / statusFilterToQuery", () => {
  it("lists exactly the three seeded statuses when each category has one", () => {
    expect(statusFilterOptions(SEEDED, TASK_CATEGORY_GROUP_LABEL).map((o) => [o.value, o.label])).toEqual([
      ["id:1", "To do"],
      ["id:2", "In progress"],
      ["id:3", "Done"],
    ]);
  });

  it("adds a whole-category pick ahead of a category that has several statuses", () => {
    expect(statusFilterOptions(CUSTOM, TASK_CATEGORY_GROUP_LABEL).map((o) => [o.value, o.label])).toEqual([
      ["cat:TODO", "Not started (all)"],
      ["id:1", "To do"],
      ["id:5", "Backlog"],
      ["cat:IN_PROGRESS", "Active (all)"],
      ["id:2", "In progress"],
      ["id:4", "QA"],
      ["id:3", "Done"],
    ]);
  });

  it("maps a category pick to ?status= and a status pick to ?statusId=", () => {
    expect(statusFilterToQuery("cat:DONE")).toEqual({ status: "DONE" });
    expect(statusFilterToQuery("id:7")).toEqual({ statusId: 7 });
    expect(statusFilterToQuery(undefined)).toEqual({});
    expect(statusFilterToQuery("cat:NOPE")).toEqual({});
    expect(statusFilterToQuery("id:abc")).toEqual({});
  });
});
