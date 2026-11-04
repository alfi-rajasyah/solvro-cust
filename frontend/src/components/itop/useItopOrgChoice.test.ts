import { describe, expect, it } from "vitest";
import { pickItopOrgs } from "./useItopOrgChoice";

const a = { id: 1, name: "PT Bank Sinar", isPrimary: true };
const b = { id: 2, name: "Telkomsel Enterprise", isPrimary: false };

describe("pickItopOrgs", () => {
  it("returns the one customer and no choices for a single-customer project", () => {
    expect(pickItopOrgs([a], new Set([1]))).toEqual({ customerId: 1, customerName: "PT Bank Sinar", organisations: [], organisationLabel: null });
  });
  it("returns nothing for a project without customers", () => {
    expect(pickItopOrgs([], new Set())).toEqual({ customerId: null, customerName: null, organisations: [], organisationLabel: null });
  });
  it("offers both mapped customers and defaults to the primary", () => {
    const r = pickItopOrgs([a, b], new Set([1, 2]));
    expect(r.customerId).toBe(1);
    expect(r.organisations.map((o) => o.id)).toEqual([1, 2]);
  });
  it("offers no picker when only one is mapped, and defaults to the mapped one", () => {
    const r = pickItopOrgs([a, b], new Set([2]));
    expect(r.customerId).toBe(2);
    expect(r.organisations).toEqual([]);
    expect(r.organisationLabel).toBe("Telkomsel Enterprise");
  });
  it("falls back to the primary when none is mapped (so the gate can explain)", () => {
    const r = pickItopOrgs([a, b], new Set());
    expect(r.customerId).toBe(1);
    expect(r.organisations).toEqual([]);
  });
});
