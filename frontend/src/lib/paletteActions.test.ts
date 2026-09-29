import { describe, expect, it } from "vitest";
import { buildPaletteActions, projectIdFromPath } from "./paletteActions";

const none = () => false;
const all = () => true;
const only = (...perms: string[]) => (p: string) => perms.includes(p);
const labels = (has: (p: string) => boolean, path: string, q = "") =>
  buildPaletteActions(has, path, q).map((a) => a.label);

describe("projectIdFromPath", () => {
  it("reads the id on a project page and any of its tabs", () => {
    expect(projectIdFromPath("/projects/12")).toBe(12);
    expect(projectIdFromPath("/projects/12/kanban")).toBe(12);
  });
  it("is null elsewhere", () => {
    expect(projectIdFromPath("/projects")).toBeNull();
    expect(projectIdFromPath("/customers/3")).toBeNull();
    expect(projectIdFromPath("/projects/abc")).toBeNull();
  });
});

describe("buildPaletteActions", () => {
  it("offers nothing without permissions", () => {
    expect(labels(none, "/projects/1/list")).toEqual([]);
  });

  it("gates New project / New customer on project:write", () => {
    expect(labels(only("project:write"), "/overview")).toEqual(["New project", "New customer"]);
    expect(labels(only("task:write"), "/overview")).toEqual([]);
  });

  it("offers Add task only on a project page with task:write", () => {
    expect(labels(only("task:write"), "/projects/7/kanban")).toEqual(["Add task"]);
    expect(labels(only("task:write"), "/projects")).toEqual([]);
    expect(labels(only("project:write"), "/projects/7/kanban")).toEqual([
      "New project",
      "New customer",
    ]);
  });

  it("keeps the current tab for Add task", () => {
    const [a] = buildPaletteActions(all, "/projects/7/kanban", "add");
    expect(a.to).toBe("/projects/7/kanban?new=task");
  });

  it("merges into the current query string instead of dropping it", () => {
    const [a] = buildPaletteActions(all, "/projects/7/list", "add", "?task=5");
    expect(a.to).toBe("/projects/7/list?task=5&new=task");
    const [b] = buildPaletteActions(all, "/projects/7/list", "add", "?new=old&view=x");
    expect(b.to).toBe("/projects/7/list?new=task&view=x");
  });

  it("filters by query, case-insensitively", () => {
    expect(labels(all, "/projects/7/list", "CUSTOMER")).toEqual(["New customer"]);
    expect(labels(all, "/projects/7/list", "zzz")).toEqual([]);
  });
});
