// Route pattern -> page title + breadcrumb trail for the TopBar. Pure module
// (no React, no data fetching) so it stays unit-testable in the node-env
// Vitest config; the TopBar feeds it whatever project/customer names the
// existing `useProject` / `useCustomer` queries already hold.
//
// Titles for the static pages deliberately match the page H1 and the sidebar
// label (`NAV_COMMANDS`), so the bar and the page never disagree.

export interface Crumb {
  label: string;
  /** Present on every crumb except the last one (the current page). */
  to?: string;
}

/** Names resolved from cached queries; every field is optional while loading. */
export interface CrumbContext {
  projectName?: string | null;
  /** The project's customer (from `useProject`), if it has one. */
  projectCustomer?: { id: number; name: string } | null;
  customerName?: string | null;
}

export type RouteKind = "static" | "project" | "customer";

export interface RouteMatch {
  kind: RouteKind;
  title: string;
  /** Set when `kind === "project"`. */
  projectId: number | null;
  /** Set when `kind === "customer"`. */
  customerId: number | null;
}

/** Top-level path segment -> title. `work-logs` is a redirect to Utilization. */
const STATIC_TITLES: Record<string, string> = {
  overview: "Overview",
  projects: "Projects",
  customers: "Customers",
  "daily-review": "Daily Review",
  "weekly-sync": "Weekly Sync",
  tasks: "Tasks",
  utilization: "Utilization",
  "work-logs": "Utilization",
  executive: "Executive",
  settings: "Settings",
  admin: "Admin",
  help: "Help",
};

/** `/` redirects to `/overview`, and unknown paths redirect to `/`. */
const FALLBACK_TITLE = "Overview";

const NUMERIC = /^\d+$/;

function segmentsOf(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

export function matchRoute(pathname: string): RouteMatch {
  const segments = segmentsOf(pathname);
  const [first, second] = segments;

  if (first === "projects" && second && NUMERIC.test(second)) {
    return { kind: "project", title: "Project", projectId: Number(second), customerId: null };
  }
  if (first === "customers" && second && NUMERIC.test(second)) {
    return { kind: "customer", title: "Customer", projectId: null, customerId: Number(second) };
  }
  return {
    kind: "static",
    title: (first !== undefined && STATIC_TITLES[first]) || FALLBACK_TITLE,
    projectId: null,
    customerId: null,
  };
}

/** Plain-text page title, e.g. for `document.title`; never "Solvro". */
export function routeTitle(pathname: string, ctx: CrumbContext = {}): string {
  const crumbs = buildCrumbs(pathname, ctx);
  return crumbs[crumbs.length - 1]?.label ?? FALLBACK_TITLE;
}

export function buildCrumbs(pathname: string, ctx: CrumbContext = {}): Crumb[] {
  const match = matchRoute(pathname);

  if (match.kind === "project") {
    const crumbs: Crumb[] = [{ label: "Projects", to: "/projects" }];
    if (ctx.projectCustomer) {
      crumbs.push({
        label: ctx.projectCustomer.name,
        to: `/customers/${ctx.projectCustomer.id}`,
      });
    }
    crumbs.push({ label: ctx.projectName || match.title });
    return crumbs;
  }

  if (match.kind === "customer") {
    return [
      { label: "Customers", to: "/customers" },
      { label: ctx.customerName || match.title },
    ];
  }

  return [{ label: match.title }];
}
