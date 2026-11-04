import { describe, expect, it } from "vitest";
import { sharedProjectsOf } from "./CustomerDeleteBody";

const link = (id: number, name: string, isPrimary: boolean) => ({ id, name, isPrimary });

describe("sharedProjectsOf", () => {
  const projects = [
    { id: 1, name: "Solo", customers: [link(1, "A", true)] },
    { id: 2, name: "Shared, A primary", customers: [link(1, "A", true), link(2, "B", false), link(3, "C", false)] },
    { id: 3, name: "Shared, A secondary", customers: [link(2, "B", true), link(1, "A", false)] },
    { id: 4, name: "Other", customers: [link(2, "B", true), link(3, "C", false)] },
  ];
  it("lists only shared projects linked to the customer", () => {
    expect(sharedProjectsOf(1, projects).map((p) => p.id)).toEqual([2, 3]);
  });
  it("names the heir only when the deleted customer was primary", () => {
    const r = sharedProjectsOf(1, projects);
    expect(r[0].heir).toBe("B");
    expect(r[1].heir).toBeNull();
  });
});
