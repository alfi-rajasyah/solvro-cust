import { describe, expect, it } from "vitest";
import {
  assigneeAddsMember,
  memberCandidates,
  removalWarning,
  splitMemberOverflow,
} from "./projectMembers";

describe("assigneeAddsMember", () => {
  const members = [{ userId: 5 }, { userId: 6 }];

  it("is false when nobody is picked", () => {
    expect(assigneeAddsMember(null, 1, members)).toBe(false);
    expect(assigneeAddsMember(undefined, 1, members)).toBe(false);
  });

  it("is false for the TAM and for existing members", () => {
    expect(assigneeAddsMember(1, 1, members)).toBe(false);
    expect(assigneeAddsMember(5, 1, members)).toBe(false);
  });

  it("is true for someone who is neither", () => {
    expect(assigneeAddsMember(9, 1, members)).toBe(true);
    expect(assigneeAddsMember(9, 1, [])).toBe(true);
  });

  it("is false for an inactive user (the server never adds them)", () => {
    expect(assigneeAddsMember(9, 1, members, false)).toBe(false);
    expect(assigneeAddsMember(9, 1, members, true)).toBe(true);
  });

  it("stays silent while membership is unknown", () => {
    expect(assigneeAddsMember(9, 1, undefined)).toBe(false);
    expect(assigneeAddsMember(9, undefined, members)).toBe(false);
  });
});

describe("memberCandidates", () => {
  const users = [
    { id: 1, username: "tam", active: true },
    { id: 2, username: "zed", active: true },
    { id: 3, username: "amy", active: true },
    { id: 4, username: "gone", active: false },
    { id: 5, username: "already", active: true },
  ];

  it("keeps active users who are neither TAM nor member, sorted by name", () => {
    expect(memberCandidates(users, 1, [{ userId: 5 }]).map((u) => u.username)).toEqual([
      "amy",
      "zed",
    ]);
  });

  it("tolerates a missing user list", () => {
    expect(memberCandidates(undefined, 1, [])).toEqual([]);
  });
});

describe("splitMemberOverflow", () => {
  it("shows everything when it fits", () => {
    expect(splitMemberOverflow([1, 2, 3], 4)).toEqual({ visible: [1, 2, 3], overflow: 0 });
  });

  it("counts the remainder", () => {
    expect(splitMemberOverflow([1, 2, 3, 4, 5, 6], 4)).toEqual({
      visible: [1, 2, 3, 4],
      overflow: 2,
    });
  });
});

describe("removalWarning", () => {
  it("uses the singular for one task", () => {
    expect(removalWarning(1)).toBe(
      "They are assigned to 1 task. Removing them unassigns those tasks.",
    );
  });

  it("uses the plural otherwise", () => {
    expect(removalWarning(3)).toBe(
      "They are assigned to 3 tasks. Removing them unassigns those tasks.",
    );
  });
});
