import { describe, expect, it } from "vitest";
import { HELP_TOPICS, filterHelpTopics } from "./helpContent";
import { NAV_COMMANDS } from "./navCommands";

const none = () => false;
const wildcard = () => true; // admin: hasPermission(user, anything) === true
const execOnly = (p: string) => p === "report:executive";

describe("filterHelpTopics", () => {
  it("hides Executive and Admin help from a user with no permissions", () => {
    const ids = filterHelpTopics(none, "").map((t) => t.id);
    expect(ids).not.toContain("executive");
    expect(ids).not.toContain("admin");
    expect(ids).toContain("getting-started");
  });

  it("shows every topic to a wildcard (admin) user", () => {
    expect(filterHelpTopics(wildcard, "")).toHaveLength(HELP_TOPICS.length);
  });

  it("shows Executive but not Admin for report:executive without wildcard", () => {
    const ids = filterHelpTopics(execOnly, "").map((t) => t.id);
    expect(ids).toContain("executive");
    expect(ids).not.toContain("admin");
  });

  it("matches the query against titles and body text, case-insensitively", () => {
    // The Projects topic is gated on project:read (like its sidebar entry), so
    // the search runs as a reader.
    const reader = (p: string) => p === "project:read";
    expect(filterHelpTopics(reader, "RISK REGISTER").map((t) => t.id)).toEqual(["projects"]);
    expect(filterHelpTopics(reader, "zzz-no-match")).toEqual([]);
    expect(filterHelpTopics(none, "RISK REGISTER")).toEqual([]);
  });

  it("never lets the query reveal a gated topic", () => {
    expect(filterHelpTopics(none, "Project Override")).toEqual([]);
  });
});

describe("HELP_TOPICS", () => {
  it("has unique anchor ids", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gates each page topic exactly like the sidebar entry it links to", () => {
    for (const t of HELP_TOPICS.filter((t) => t.route)) {
      const nav = NAV_COMMANDS.find((c) => c.to === t.route);
      expect(nav, `${t.id} links to a sidebar page`).toBeDefined();
      expect(t.requires).toBe(nav?.requires);
    }
  });

  it("has a topic for every sidebar page", () => {
    const routes = HELP_TOPICS.map((t) => t.route);
    for (const nav of NAV_COMMANDS) {
      expect(routes, `help topic for ${nav.to}`).toContain(nav.to);
    }
  });
});
