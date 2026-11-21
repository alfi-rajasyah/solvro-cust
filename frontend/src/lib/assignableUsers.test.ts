import { describe, expect, it } from "vitest";
import { assignableUsers, assigneeOptionLabel } from "./assignableUsers";

const users = [
  { id: 1, username: "ann", active: true },
  { id: 2, username: "old", active: false },
  { id: 3, username: "gone", active: false },
  { id: 4, username: "legacy" },
];

describe("assignableUsers", () => {
  it("hides inactive users", () => {
    expect(assignableUsers(users, null).map((u) => u.id)).toEqual([1, 4]);
  });

  it("keeps the current inactive user", () => {
    expect(assignableUsers(users, 2).map((u) => u.id)).toEqual([1, 2, 4]);
  });

  it("treats a missing active flag as active and a missing current as none", () => {
    expect(assignableUsers(users, undefined).map((u) => u.id)).toContain(4);
  });
});

describe("assigneeOptionLabel", () => {
  it("marks only inactive users, in lowercase", () => {
    expect(assigneeOptionLabel({ username: "ann", active: true })).toBe("ann");
    expect(assigneeOptionLabel({ username: "ann" })).toBe("ann");
    expect(assigneeOptionLabel({ username: "bob", active: false })).toBe("bob (inactive)");
  });
});
