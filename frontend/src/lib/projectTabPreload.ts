/**
 * Starts a project tab's lazy chunk before the tab renders. ProjectDetail only
 * mounts its `<Outlet />` once the project has loaded, so without this the tab's
 * chunk is requested after the project fetch instead of beside it. These are the
 * single source for `App.tsx`'s lazy tab pages too (a new tab registers here
 * and in `ProjectDetail.tsx`'s tab list), so the browser reuses the one
 * request and the route's lazy boundary is unchanged.
 */
export const PROJECT_TAB_LOADERS = {
  overview: () => import("@/pages/views/ProjectOverview"),
  list: () => import("@/pages/views/ProjectList"),
  kanban: () => import("@/pages/views/ProjectKanban"),
  gantt: () => import("@/pages/views/ProjectGantt"),
  epics: () => import("@/pages/views/ProjectEpics"),
  timeline: () => import("@/pages/views/ProjectTimeline"),
  risks: () => import("@/pages/views/ProjectRisks"),
  services: () => import("@/pages/views/ProjectServices"),
  docs: () => import("@/pages/views/ProjectDocs"),
} as const;

const started = new Set<string>();

/** Idempotent; a failed load is forgotten so the real render can retry it. */
export function preloadProjectTab(tab: string | undefined): void {
  if (!tab || started.has(tab)) return;
  const loaders: Record<string, (() => Promise<unknown>) | undefined> = PROJECT_TAB_LOADERS;
  const load = Object.hasOwn(loaders, tab) ? loaders[tab] : undefined;
  if (!load) return;
  started.add(tab);
  load().catch(() => started.delete(tab));
}

/** The tab segment of `/projects/:id/<tab>`, or undefined elsewhere. */
export function projectTabFromPath(pathname: string): string | undefined {
  return /^\/projects\/[^/]+\/([^/]+)\/?$/.exec(pathname)?.[1];
}
