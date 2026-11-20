// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAssigneeMembership } from "./useAssigneeMembership";

const teamAccess = { current: undefined as unknown };

vi.mock("@/lib/queries", () => ({
  useProject: () => ({ data: { tam: { id: 1 } } }),
  useProjectMembers: () => ({ data: [{ userId: 5 }] }),
  useUsers: () => ({ data: [{ id: 9, active: true }, { id: 8, active: true }] }),
  useProjectTeamAccess: () => ({ data: teamAccess.current }),
}));

describe("useAssigneeMembership", () => {
  it("is silent while the team-access list is loading", () => {
    teamAccess.current = undefined;
    const { result } = renderHook(() => useAssigneeMembership(3));
    expect(result.current(9)).toBe(false);
  });

  it("does not flag the TAM, members or users with access through a customer team", () => {
    teamAccess.current = { teamAccessUserIds: [9] };
    const { result } = renderHook(() => useAssigneeMembership(3));
    expect(result.current(1)).toBe(false);
    expect(result.current(5)).toBe(false);
    expect(result.current(9)).toBe(false);
    expect(result.current(8)).toBe(true);
  });
});
