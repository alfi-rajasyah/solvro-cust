import { describe, expect, it } from "vitest";
import appSource from "@/App.tsx?raw";
import { buildCrumbs, matchRoute, routeTitle } from "./routeMeta";

/**
 * Every concrete path App.tsx declares, read from the source so a new route
 * that forgets its title fails here. `projects/:id` owns the nested routes up
 * to its closing tag; `/login` (outside the shell) and the `*` catch-all are
 * not top-bar pages.
 */
function appPaths(): string[] {
  const paths: string[] = [];
  const parentIdx = appSource.indexOf('path="projects/:id"');
  const parentEnd = appSource.indexOf("</Route>", parentIdx);
  for (const m of appSource.matchAll(/path="([^"]+)"/g)) {
    const raw = m[1];
    if (raw === "/login" || raw === "*") continue;
    const nested = m.index > parentIdx && m.index < parentEnd;
    const full = nested ? `/projects/:id/${raw}` : `/${raw}`;
    paths.push(full.replace(":id", "7"));
  }
  return paths;
}

describe("routeMeta over App.tsx", () => {
  const paths = appPaths();

  it("finds the routes (guards against a broken parser)", () => {
    expect(paths).toContain("/projects");
    expect(paths).toContain("/projects/7");
    expect(paths).toContain("/projects/7/gantt");
    expect(paths).toContain("/customers/7");
    expect(paths).toContain("/admin");
    expect(paths.length).toBeGreaterThanOrEqual(18);
  });

  it.each(appPaths())("%s resolves to a real title and non-empty crumbs", (path) => {
    const crumbs = buildCrumbs(path);
    expect(crumbs.length).toBeGreaterThan(0);
    for (const crumb of crumbs) {
      expect(crumb.label.trim()).not.toBe("");
      expect(crumb.label).not.toBe("Solvro");
    }
    expect(routeTitle(path)).not.toBe("Solvro");
  });
});

describe("static pages", () => {
  it("titles match the page H1s and sidebar labels", () => {
    expect(routeTitle("/overview")).toBe("Overview");
    expect(routeTitle("/projects")).toBe("Projects");
    expect(routeTitle("/customers")).toBe("Customers");
    expect(routeTitle("/daily-review")).toBe("Daily Review");
    expect(routeTitle("/weekly-sync")).toBe("Weekly Sync");
    expect(routeTitle("/utilization")).toBe("Utilization");
    expect(routeTitle("/work-logs")).toBe("Utilization");
    expect(routeTitle("/executive")).toBe("Executive");
    expect(routeTitle("/settings")).toBe("Settings");
    expect(routeTitle("/admin")).toBe("Admin");
    expect(routeTitle("/help")).toBe("Help");
    expect(routeTitle("/tasks")).toBe("Tasks");
  });

  it("is a single, unlinked crumb", () => {
    expect(buildCrumbs("/projects")).toEqual([{ label: "Projects" }]);
  });

  it("falls back to Overview for / and unknown paths, never Solvro", () => {
    expect(routeTitle("/")).toBe("Overview");
    expect(routeTitle("/nope/never")).toBe("Overview");
  });
});

describe("project routes", () => {
  const ctx = {
    projectName: "Migration",
    projectCustomer: { id: 3, name: "Acme" },
  };

  it("matches the id on every sub-view", () => {
    expect(matchRoute("/projects/12/kanban")).toMatchObject({ kind: "project", projectId: 12 });
    expect(matchRoute("/projects/12")).toMatchObject({ kind: "project", projectId: 12 });
  });

  it("builds Projects / customer / project", () => {
    expect(buildCrumbs("/projects/12/gantt", ctx)).toEqual([
      { label: "Projects", to: "/projects" },
      { label: "Acme", to: "/customers/3" },
      { label: "Migration" },
    ]);
  });

  it("omits the customer crumb for a project without one", () => {
    expect(buildCrumbs("/projects/12", { projectName: "Solo", projectCustomer: null })).toEqual([
      { label: "Projects", to: "/projects" },
      { label: "Solo" },
    ]);
  });

  it("uses a placeholder while the project is loading", () => {
    expect(buildCrumbs("/projects/12")).toEqual([
      { label: "Projects", to: "/projects" },
      { label: "Project" },
    ]);
  });

  it("does not treat a non-numeric id as a project", () => {
    expect(matchRoute("/projects/abc").kind).toBe("static");
  });
});

describe("customer detail", () => {
  it("builds Customers / name", () => {
    expect(buildCrumbs("/customers/5", { customerName: "Acme" })).toEqual([
      { label: "Customers", to: "/customers" },
      { label: "Acme" },
    ]);
    expect(matchRoute("/customers/5")).toMatchObject({ kind: "customer", customerId: 5 });
  });

  it("uses a placeholder while loading", () => {
    expect(buildCrumbs("/customers/5")[1]).toEqual({ label: "Customer" });
  });

  it("the list page stays a static Customers title", () => {
    expect(matchRoute("/customers").kind).toBe("static");
  });
});
