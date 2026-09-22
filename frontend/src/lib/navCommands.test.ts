import { describe, expect, it } from "vitest";
import { NAV_COMMANDS, filterNavCommands } from "./navCommands";

const none = () => false;
const wildcard = () => true; // admin: hasPermission(user, anything) === true
const execOnly = (p: string) => p === "report:executive";

describe("filterNavCommands", () => {
  it("returns all ungated pages for a user with no permissions", () => {
    const labels = filterNavCommands(none, "").map((c) => c.label);
    expect(labels).toEqual([
      "Overview",
      "Projects",
      "Customers",
      "Daily Review",
      "Weekly Sync",
      "Settings",
    ]);
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
    expect(filterNavCommands(none, "cust").map((c) => c.label)).toEqual(["Customers"]);
    expect(filterNavCommands(none, "CUSTOMERS").map((c) => c.label)).toEqual(["Customers"]);
    expect(filterNavCommands(none, "zzz")).toEqual([]);
  });

  it("pins the catalogue's route list", () => {
    expect(NAV_COMMANDS.map((c) => c.to)).toEqual([
      "/overview",
      "/projects",
      "/customers",
      "/daily-review",
      "/weekly-sync",
      "/executive",
      "/settings",
      "/admin",
    ]);
  });
});
