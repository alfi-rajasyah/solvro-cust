import { describe, expect, it } from "vitest";
import { projectCountsLabel } from "./AccountOverview";

describe("projectCountsLabel", () => {
  it("is empty without projects", () => {
    expect(projectCountsLabel([])).toBeUndefined();
  });
  it("is just the count when nothing is shared", () => {
    expect(projectCountsLabel([{}, { isShared: false }])).toBe("2");
  });
  it("splits own and shared", () => {
    expect(projectCountsLabel([{ isShared: true }, { isShared: false }, { isShared: true }, {}])).toBe("4 · 2 own · 2 shared");
  });
});
