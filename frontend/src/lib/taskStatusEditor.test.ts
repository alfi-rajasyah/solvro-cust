import { describe, expect, it } from "vitest";
import {
  addStatus,
  buildSaveBody,
  deleteBlocker,
  isDirty,
  needsMoveTarget,
  removeStatus,
  reorderCategory,
  mergeTaskCounts,
  resetToDefaults,
  restoreRemoved,
  rowsIn,
  seedState,
  setDefault,
  updateRow,
  validateState,
  type AdminStatusDef,
} from "./taskStatusEditor";

const DEFS: AdminStatusDef[] = [
  { id: 1, name: "To do", category: "TODO", color: "gray", position: 0, isDefault: true, taskCount: 4 },
  { id: 2, name: "In progress", category: "IN_PROGRESS", color: "primary", position: 1, isDefault: true, taskCount: 3 },
  { id: 3, name: "Review", category: "IN_PROGRESS", color: "amber", position: 2, isDefault: false, taskCount: 0 },
  { id: 4, name: "Done", category: "DONE", color: "emerald", position: 3, isDefault: true, taskCount: 7 },
];

describe("taskStatusEditor", () => {
  it("seeds grouped by category and is not dirty", () => {
    const s = seedState(DEFS);
    expect(s.rows.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(isDirty(s, DEFS)).toBe(false);
  });

  it("add + rename + reorder build a whole-list body in order, ids kept", () => {
    let s = seedState(DEFS);
    s = addStatus(s, "IN_PROGRESS", "n1");
    s = updateRow(s, "n1", { name: "  QA / UAT " });
    s = updateRow(s, "s1", { name: "Backlog" });
    s = reorderCategory(s, "IN_PROGRESS", [...rowsIn(s, "IN_PROGRESS")].reverse());
    const body = buildSaveBody(s);
    expect(body.statuses.map((x) => [x.id, x.name])).toEqual([
      [1, "Backlog"],
      [undefined, "QA / UAT"],
      [3, "Review"],
      [2, "In progress"],
      [4, "Done"],
    ]);
    expect(body.moveTo).toBeUndefined();
    expect(isDirty(s, DEFS)).toBe(true);
  });

  it("blocks deleting a default or the last status of a category", () => {
    const s = seedState(DEFS);
    expect(deleteBlocker(s, s.rows[1])).toMatch(/default/);
    expect(deleteBlocker(s, s.rows[0])).toMatch(/at least one/);
    expect(deleteBlocker(s, s.rows[2])).toBeNull();
    const only = seedState([DEFS[0]]);
    expect(deleteBlocker(only, { ...only.rows[0], isDefault: false })).toMatch(/at least one/);
  });

  it("setDefault moves the flag within the category only", () => {
    const s = setDefault(seedState(DEFS), "s3");
    expect(s.rows.map((r) => r.isDefault)).toEqual([true, false, true, true]);
  });

  it("deleting a status with tasks needs a target and emits moveTo", () => {
    let s = seedState(DEFS);
    s = setDefault(s, "s3"); // free "In progress" to be deleted
    const row = s.rows[1];
    expect(needsMoveTarget(s, row)).toBe(true);
    expect(removeStatus(s, "s2")).toBe(s); // no target: refused
    s = removeStatus(s, "s2", 3);
    const body = buildSaveBody(s);
    expect(body.statuses.map((x) => x.id)).toEqual([1, 3, 4]);
    expect(body.moveTo).toEqual({ "2": 3 });
  });

  it("deleting an unused status needs no moveTo; a queued target forces a retarget", () => {
    let s = seedState(DEFS);
    s = setDefault(s, "s3");
    s = removeStatus(s, "s2", 3); // 3 tasks -> Review
    // Review now receives tasks, so deleting it needs a new target even with 0 own tasks.
    s = setDefault(s, "s3");
    expect(needsMoveTarget(s, s.rows.find((r) => r.key === "s3")!)).toBe(true);
  });

  it("validates empty and duplicate names", () => {
    let s = addStatus(seedState(DEFS), "TODO", "n1");
    expect(validateState(s)).toEqual({ n1: "Give this status a name" });
    s = updateRow(s, "n1", { name: "to DO" });
    expect(Object.keys(validateState(s)).sort()).toEqual(["n1", "s1"]);
  });

  it("reset keeps ids on name matches, renames the category default otherwise, and moves the rest", () => {
    let s = seedState(DEFS);
    s = updateRow(s, "s1", { name: "Backlog" });
    const r = resetToDefaults(s);
    expect(r.rows.map((x) => [x.id, x.name, x.isDefault])).toEqual([
      [1, "To do", true],
      [2, "In progress", true],
      [4, "Done", true],
    ]);
    expect(r.removed.map((x) => x.id)).toEqual([3]);
    // Review had no tasks: nothing to move.
    expect(buildSaveBody(r).moveTo).toBeUndefined();
    expect(buildSaveBody(r).statuses.every((x) => x.id !== undefined)).toBe(true);

    const withTasks = seedState(DEFS.map((d) => (d.id === 3 ? { ...d, taskCount: 5 } : d)));
    expect(buildSaveBody(resetToDefaults(withTasks)).moveTo).toEqual({ "3": 2 });
  });

  it("reset never moves tasks across categories, even with an unsaved default in the category", () => {
    let s = seedState(DEFS.map((d) => (d.id === 1 ? { ...d, taskCount: 9 } : d)));
    s = updateRow(s, "s1", { name: "Backlog" });
    s = addStatus(s, "TODO", "n1");
    s = updateRow(s, "n1", { name: "Triage" });
    s = setDefault(s, "n1");
    const r = resetToDefaults(s);
    expect(r.rows.map((x) => [x.id, x.name, x.category])).toEqual([
      [1, "To do", "TODO"],
      [2, "In progress", "IN_PROGRESS"],
      [4, "Done", "DONE"],
    ]);
    expect(r.removed.map((x) => x.id)).toEqual([3]);
    expect(buildSaveBody(r).moveTo).toBeUndefined();
  });

  it("restoreRemoved puts a deleted status back with the server's count; mergeTaskCounts refreshes counts", () => {
    let s = seedState(DEFS);
    s = removeStatus(s, "s3"); // Review, shown with 0 tasks
    expect(s.removed).toHaveLength(1);
    s = restoreRemoved(s, 3, 2);
    expect(s.removed).toHaveLength(0);
    const review = s.rows.find((r) => r.id === 3)!;
    expect(review.taskCount).toBe(2);
    expect(needsMoveTarget(s, review)).toBe(true);
    s = mergeTaskCounts(s, DEFS.map((d) => (d.id === 4 ? { ...d, taskCount: 11 } : d)));
    expect(s.rows.find((r) => r.id === 4)!.taskCount).toBe(11);
  });
});
