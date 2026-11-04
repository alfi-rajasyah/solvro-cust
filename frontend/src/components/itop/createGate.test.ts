import { describe, expect, it } from "vitest";
import { resolveCreateGate, type CreateGateInput } from "./createGate";

const OK: CreateGateInput = {
  customerId: 1,
  customerName: "Northwind",
  actionsEnabled: true,
  hasToken: true,
  canViewCustomers: true,
  canWriteCustomers: true,
  mapping: "mapped",
  isAdmin: false,
};

describe("resolveCreateGate", () => {
  it("allows creation when every condition passes", () => {
    expect(resolveCreateGate(OK)).toEqual({ canCreate: true, reason: null, fix: null });
  });

  it("checks the customer first, even when everything else also fails", () => {
    const g = resolveCreateGate({ ...OK, customerId: null, actionsEnabled: false, hasToken: false, mapping: "unmapped" });
    expect(g.reason).toBe("Add a customer to this project to create tickets");
  });

  it("then the customer:write permission, before iTop actions", () => {
    const g = resolveCreateGate({ ...OK, canWriteCustomers: false, actionsEnabled: false, hasToken: false });
    expect(g.reason).toBe("You need the 'Manage customers' permission to create iTop tickets");
  });

  it("then actionsEnabled, with an admin link only for admins", () => {
    const base = { ...OK, actionsEnabled: false, hasToken: false, mapping: "unmapped" as const };
    expect(resolveCreateGate({ ...base, isAdmin: true })).toMatchObject({
      reason: "iTop actions are turned off (Admin → iTop)",
      fix: { label: "Admin → iTop", to: "/admin?tab=itop" },
    });
    expect(resolveCreateGate(base)).toMatchObject({ reason: "iTop actions are turned off. Ask an admin to turn them on", fix: null });
  });

  it("then the personal token, linking to Settings", () => {
    expect(resolveCreateGate({ ...OK, hasToken: false, mapping: "unmapped" })).toMatchObject({
      reason: "Add your iTop token in Settings",
      fix: { label: "Settings", to: "/settings" },
    });
  });

  it("then the customer:read permission, before looking at the mapping", () => {
    const g = resolveCreateGate({ ...OK, canViewCustomers: false, mapping: "loading" });
    expect(g.reason).toBe("You need the 'View customers' permission to create iTop tickets");
  });

  it("has no reason while the mapping loads, and a generic one when it errors", () => {
    expect(resolveCreateGate({ ...OK, mapping: "loading" })).toEqual({ canCreate: false, reason: null, fix: null });
    expect(resolveCreateGate({ ...OK, mapping: "error" }).reason).toBe("Couldn't check the customer's iTop mapping");
  });

  it("last, the mapping, with admin vs non-admin wording", () => {
    expect(resolveCreateGate({ ...OK, mapping: "unmapped", isAdmin: true })).toMatchObject({
      reason: "Map Northwind to an iTop organisation (Admin → iTop)",
      fix: { label: "Admin → iTop" },
    });
    expect(resolveCreateGate({ ...OK, mapping: "unmapped" }).reason).toBe("Ask an admin to map Northwind to an iTop organisation");
  });
});
