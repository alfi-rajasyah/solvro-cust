import { describe, expect, it } from "vitest";
import type { AuthUser } from "@/lib/auth";
import { canAssignDeal, canDeleteDeal, canDragDeal, needsTerminalConfirm } from "./boardLogic";

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 1,
    username: "sa.one",
    email: "sa.one@example.com",
    role: "SA",
    permissions: [],
    ...overrides,
  };
}

describe("canDragDeal", () => {
  it("denies a user with no pipeline permissions", () => {
    expect(canDragDeal(user({ permissions: [] }), { picId: 1 })).toBe(false);
  });

  it("allows edit_all regardless of ownership", () => {
    expect(canDragDeal(user({ id: 1, permissions: ["pipeline:edit_all"] }), { picId: 2 })).toBe(true);
  });

  it("allows edit_own only when the deal's picId matches the user", () => {
    const u = user({ id: 1, permissions: ["pipeline:edit_own"] });
    expect(canDragDeal(u, { picId: 1 })).toBe(true);
    expect(canDragDeal(u, { picId: 2 })).toBe(false);
    expect(canDragDeal(u, { picId: null })).toBe(false);
  });

  it("the '*' wildcard allows everything, same as the backend's hasPermission", () => {
    expect(canDragDeal(user({ id: 1, permissions: ["*"] }), { picId: 999 })).toBe(true);
  });

  it("denies for a null/undefined user", () => {
    expect(canDragDeal(null, { picId: 1 })).toBe(false);
    expect(canDragDeal(undefined, { picId: 1 })).toBe(false);
  });
});

describe("canDeleteDeal", () => {
  it("denies a user with no pipeline permissions", () => {
    expect(canDeleteDeal(user({ permissions: [] }), { picId: 1 })).toBe(false);
  });

  it("allows delete_all regardless of ownership", () => {
    expect(canDeleteDeal(user({ id: 1, permissions: ["pipeline:delete_all"] }), { picId: 2 })).toBe(
      true,
    );
  });

  it("allows delete_own only when the deal's picId matches the user", () => {
    const u = user({ id: 1, permissions: ["pipeline:delete_own"] });
    expect(canDeleteDeal(u, { picId: 1 })).toBe(true);
    expect(canDeleteDeal(u, { picId: 2 })).toBe(false);
    expect(canDeleteDeal(u, { picId: null })).toBe(false);
  });

  it("the '*' wildcard allows everything, same as the backend's hasPermission", () => {
    expect(canDeleteDeal(user({ id: 1, permissions: ["*"] }), { picId: 999 })).toBe(true);
  });

  it("denies for a null/undefined user", () => {
    expect(canDeleteDeal(null, { picId: 1 })).toBe(false);
    expect(canDeleteDeal(undefined, { picId: 1 })).toBe(false);
  });
});

describe("canAssignDeal", () => {
  it("denies a user with no pipeline permissions", () => {
    expect(canAssignDeal(user({ permissions: [] }), { picId: null })).toBe(false);
  });

  it("allows edit_all for an unassigned deal, the caller's own deal, and a foreign deal", () => {
    const u = user({ id: 1, permissions: ["pipeline:edit_all"] });
    expect(canAssignDeal(u, { picId: null })).toBe(true);
    expect(canAssignDeal(u, { picId: 1 })).toBe(true);
    expect(canAssignDeal(u, { picId: 2 })).toBe(true);
  });

  it("allows edit_own only for an unassigned deal, never an already-assigned one", () => {
    const u = user({ id: 1, permissions: ["pipeline:edit_own"] });
    expect(canAssignDeal(u, { picId: null })).toBe(true);
    expect(canAssignDeal(u, { picId: 1 })).toBe(false);
    expect(canAssignDeal(u, { picId: 2 })).toBe(false);
  });

  it("the '*' wildcard allows everything, same as the backend's hasPermission", () => {
    expect(canAssignDeal(user({ id: 1, permissions: ["*"] }), { picId: 999 })).toBe(true);
  });

  it("denies for a null/undefined user", () => {
    expect(canAssignDeal(null, { picId: null })).toBe(false);
    expect(canAssignDeal(undefined, { picId: null })).toBe(false);
  });
});

describe("needsTerminalConfirm", () => {
  it("requires confirmation when entering WON from another stage", () => {
    expect(needsTerminalConfirm("WON", "RFP")).toBe(true);
  });

  it("requires confirmation when entering DROP from another stage", () => {
    expect(needsTerminalConfirm("DROP", "WAITING_RESPONSE")).toBe(true);
  });

  it("does NOT require confirmation for a same-stage reorder within WON", () => {
    expect(needsTerminalConfirm("WON", "WON")).toBe(false);
  });

  it("does NOT require confirmation for a same-stage reorder within DROP", () => {
    expect(needsTerminalConfirm("DROP", "DROP")).toBe(false);
  });

  it("does NOT require confirmation for any non-terminal target stage", () => {
    expect(needsTerminalConfirm("RFP", "ASSESSMENT")).toBe(false);
    expect(needsTerminalConfirm("HOLD", "POC")).toBe(false);
  });
});
