import { describe, expect, it } from "vitest";
import { parseSectionId, parseTaskId, sectionNodeId, taskNodeId } from "./adapter";

describe("parseSectionId", () => {
  it("is the inverse of sectionNodeId", () => {
    expect(parseSectionId(sectionNodeId(42))).toBe(42);
    expect(parseSectionId(sectionNodeId(null))).toBeNull();
  });

  it("returns undefined for ids that are not section nodes", () => {
    expect(parseSectionId(taskNodeId(7))).toBeUndefined();
    expect(parseSectionId("section-")).toBeUndefined();
    expect(parseSectionId("section-12x")).toBeUndefined();
    expect(parseSectionId("section-rollup-3")).toBeUndefined();
    expect(parseSectionId("sec-3")).toBeUndefined();
  });

  it("does not overlap parseTaskId", () => {
    expect(parseTaskId(sectionNodeId(5))).toBeNull();
    expect(parseTaskId(taskNodeId(5))).toBe(5);
  });
});
