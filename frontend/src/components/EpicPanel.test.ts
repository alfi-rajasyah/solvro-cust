import { describe, expect, it } from "vitest";
import { splitEpicOwnerOptions } from "./EpicPanel";

const users = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

describe("splitEpicOwnerOptions", () => {
  it("puts known project people first and keeps everyone else listed", () => {
    const { onProject, others } = splitEpicOwnerOptions(users, new Set([1, 3]), null);
    expect(onProject.map((u) => u.id)).toEqual([1, 3]);
    expect(others.map((u) => u.id)).toEqual([2, 4]);
  });

  it("always keeps the current owner selectable", () => {
    const { onProject, others } = splitEpicOwnerOptions(users, new Set([1]), 4);
    expect(onProject.map((u) => u.id)).toEqual([1, 4]);
    expect(others.map((u) => u.id)).toEqual([2, 3]);
  });
});
