import { describe, expect, it } from "vitest";
import { preloadProjectTab, projectTabFromPath } from "./projectTabPreload";

describe("projectTabFromPath", () => {
  it("reads the tab segment of a project route", () => {
    expect(projectTabFromPath("/projects/12/kanban")).toBe("kanban");
    expect(projectTabFromPath("/projects/12/gantt/")).toBe("gantt");
  });
  it("is undefined off a tab", () => {
    expect(projectTabFromPath("/projects/12")).toBeUndefined();
    expect(projectTabFromPath("/customers/3/overview")).toBeUndefined();
  });
});

describe("preloadProjectTab", () => {
  it("ignores unknown tabs and inherited keys", () => {
    expect(() => preloadProjectTab(undefined)).not.toThrow();
    expect(() => preloadProjectTab("constructor")).not.toThrow();
    expect(() => preloadProjectTab("nope")).not.toThrow();
  });
});
