import { describe, expect, it } from "vitest";
import { NAV_COMMANDS, NAV_GROUPS, filterNavCommands } from "./navCommands";

const none = () => false;
const wildcard = () => true; // admin: hasPermission(user, anything) === true
const execOnly = (p: string) => p === "report:executive";

describe("filterNavCommands", () => {
  it("returns all ungated pages for a user with no permissions", () => {
    const labels = filterNavCommands(none, "").map((c) => c.label);
    expect(labels).toEqual([
      "Overview",
      "Projects",
      "Settings",
    ]);
  });

  it("lists Customers, Daily Review and Weekly Sync only to holders of project:read", () => {
    const ungated = filterNavCommands(none, "").map((c) => c.label);
    expect(ungated).not.toContain("Customers");
    expect(ungated).not.toContain("Daily Review");
    expect(ungated).not.toContain("Weekly Sync");
    const reader = filterNavCommands((p) => p === "project:read", "").map((c) => c.label);
    expect(reader).toContain("Customers");
    expect(reader).toContain("Daily Review");
    expect(reader).toContain("Weekly Sync");
    expect(NAV_COMMANDS.find((c) => c.to === "/weekly-sync")?.requires).toBe("project:read");
    expect(NAV_COMMANDS.find((c) => c.to === "/customers")?.requires).toBe("project:read");
    expect(NAV_COMMANDS.find((c) => c.to === "/daily-review")?.requires).toBe("project:read");
  });

  it("lists Utilization only to holders of project:read", () => {
    expect(filterNavCommands(none, "").map((c) => c.label)).not.toContain("Utilization");
    expect(filterNavCommands((p) => p === "project:read", "").map((c) => c.label)).toContain("Utilization");
    expect(NAV_COMMANDS.find((c) => c.to === "/utilization")?.requires).toBe("project:read");
  });

  it("includes Executive and Admin for a wildcard (admin) user", () => {
    const labels = filterNavCommands(wildcard, "").map((c) => c.label);
    expect(labels).toContain("Executive");
    expect(labels).toContain("Admin");
    expect(labels).toHaveLength(NAV_COMMANDS.length);
  });

  it("includes Executive but not Admin for report:executive without wildcard", () => {
    const labels = filterNavCommands(execOnly, "").map((c) => c.label);
    expect(labels).toContain("Executive");
    expect(labels).not.toContain("Admin");
  });

  it("filters by label, case-insensitively", () => {
    expect(filterNavCommands(wildcard, "cust").map((c) => c.label)).toEqual(["Customers"]);
    expect(filterNavCommands(wildcard, "CUSTOMERS").map((c) => c.label)).toEqual(["Customers"]);
    expect(filterNavCommands(none, "zzz")).toEqual([]);
  });

  it("pins the catalogue's route list", () => {
    expect(NAV_COMMANDS.map((c) => c.to)).toEqual([
      "/overview",
      "/projects",
      "/customers",
      "/daily-review",
      "/weekly-sync",
      "/utilization",
      "/executive",
      "/settings",
      "/admin",
    ]);
  });

  it("assigns every page to a sidebar group, contiguous and in group order", () => {
    expect(NAV_COMMANDS.map((c) => [c.label, c.group])).toEqual([
      ["Overview", "Workspace"],
      ["Projects", "Workspace"],
      ["Customers", "Workspace"],
      ["Daily Review", "Cadence"],
      ["Weekly Sync", "Cadence"],
      ["Utilization", "Insights"],
      ["Executive", "Insights"],
      ["Settings", "System"],
      ["Admin", "System"],
    ]);
    expect(NAV_GROUPS).toEqual(["Workspace", "Cadence", "Insights", "System"]);
  });

  it("keeps /tasks out of the catalogue", () => {
    expect(NAV_COMMANDS.some((c) => c.to === "/tasks")).toBe(false);
  });
});
