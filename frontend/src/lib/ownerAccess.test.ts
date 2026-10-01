import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import type { AuthUser } from "@/lib/auth";
import {
  OWNER_ONLY_MESSAGE,
  canOwnCustomer,
  canOwnProject,
  isOwnerOnlyError,
  saveErrorMessage,
} from "./ownerAccess";

const user = (id: number, permissions: string[] = ["project:read", "project:write"]): AuthUser => ({
  id,
  username: `u${id}`,
  email: `u${id}@x.test`,
  role: "TAM",
  permissions,
});

describe("canOwnProject", () => {
  it("is true for the project's TAM", () => {
    expect(canOwnProject(user(1), { tamId: 1 }, undefined)).toBe(true);
  });
  it("is true for the owner of the project's customer", () => {
    expect(canOwnProject(user(2), { tamId: 1 }, 2)).toBe(true);
  });
  it("is true for view-all and wildcard users", () => {
    expect(canOwnProject(user(3, ["project:view-all"]), { tamId: 1 }, 9)).toBe(true);
    expect(canOwnProject(user(3, ["*"]), { tamId: 1 }, null)).toBe(true);
  });
  it("is false for a member with access through membership only", () => {
    expect(canOwnProject(user(4), { tamId: 1 }, 2)).toBe(false);
    expect(canOwnProject(user(4), { tamId: 1 }, null)).toBe(false);
  });
  it("is false while the customer owner is unknown", () => {
    expect(canOwnProject(user(4), { tamId: 1 }, undefined)).toBe(false);
  });
  it("is false when signed out", () => {
    expect(canOwnProject(null, { tamId: 1 }, 1)).toBe(false);
  });
});

describe("canOwnCustomer", () => {
  it("is true for the owner", () => {
    expect(canOwnCustomer(user(1), { tamId: 1 }, [])).toBe(true);
  });
  it("is true for an unowned customer", () => {
    expect(canOwnCustomer(user(1), { tamId: null }, [])).toBe(true);
  });
  it("is true when the user is TAM of one of its projects", () => {
    expect(canOwnCustomer(user(5), { tamId: 1 }, [2, 5])).toBe(true);
  });
  it("is true for view-all", () => {
    expect(canOwnCustomer(user(6, ["project:view-all"]), { tamId: 1 }, [])).toBe(true);
  });
  it("is false for someone who only reaches it through a project membership", () => {
    expect(canOwnCustomer(user(7), { tamId: 1 }, [2])).toBe(false);
  });
});

describe("owner_only errors", () => {
  const ownerOnly = new ApiError(403, "Forbidden", { code: "owner_only" });
  it("recognises the 403 owner_only refusal", () => {
    expect(isOwnerOnlyError(ownerOnly)).toBe(true);
    expect(isOwnerOnlyError(new ApiError(403, "Forbidden", { code: "forbidden" }))).toBe(false);
    expect(isOwnerOnlyError(new ApiError(400, "x", { code: "owner_only" }))).toBe(false);
    expect(isOwnerOnlyError(new Error("x"))).toBe(false);
  });
  it("maps it to the clear message, other errors pass through", () => {
    expect(saveErrorMessage(ownerOnly, "Save failed.")).toBe(OWNER_ONLY_MESSAGE);
    expect(saveErrorMessage(new ApiError(500, "Boom", null), "Save failed.")).toBe("Boom");
    expect(saveErrorMessage(new Error("net"), "Save failed.")).toBe("Save failed.");
  });
});
