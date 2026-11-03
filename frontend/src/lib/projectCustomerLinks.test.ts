import { describe, expect, it } from "vitest";
import { addLink, linkBody, removeLink, setPrimaryLink } from "./projectCustomerLinks";

const a = { id: 1, name: "A", isPrimary: true };
const b = { id: 2, name: "B", isPrimary: false };

describe("projectCustomerLinks", () => {
  it("the first added customer is the primary, later ones are not", () => {
    const one = addLink([], { id: 1, name: "A" });
    expect(one).toEqual([a]);
    expect(addLink(one, { id: 2, name: "B" })).toEqual([a, b]);
  });
  it("adding a duplicate is a no-op", () => {
    expect(addLink([a, b], { id: 2, name: "B" })).toEqual([a, b]);
  });
  it("removing the primary promotes the first remaining customer", () => {
    expect(removeLink([a, b], 1)).toEqual([{ ...b, isPrimary: true }]);
  });
  it("removing a non-primary keeps the primary", () => {
    expect(removeLink([a, b], 2)).toEqual([a]);
  });
  it("set primary moves the flag, leaving exactly one", () => {
    const r = setPrimaryLink([a, b], 2);
    expect(r.filter((l) => l.isPrimary).map((l) => l.id)).toEqual([2]);
  });
  it("builds the request body without names", () => {
    expect(linkBody([a, b])).toEqual([{ id: 1, isPrimary: true }, { id: 2, isPrimary: false }]);
  });
});
