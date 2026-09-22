// Static catalogue of page destinations shared by the sidebar nav
// (Sidebar.tsx derives its render list from NAV_COMMANDS directly) and the
// ⌘K palette (CommandPalette.tsx). Single source of truth: this file stays a
// pure module — the permission check is injected so it never imports React
// and stays unit-testable in the node-env Vitest config.
export interface NavCommand {
  to: string;
  label: string;
  icon: string;
  /** Permission required to list this page; "*" restricts to admin wildcard. */
  requires?: string;
}

export const NAV_COMMANDS: readonly NavCommand[] = [
  { to: "/overview", label: "Overview", icon: "dashboard" },
  { to: "/projects", label: "Projects", icon: "folder_managed" },
  { to: "/customers", label: "Customers", icon: "groups" },
  { to: "/daily-review", label: "Daily Review", icon: "edit_note" },
  { to: "/weekly-sync", label: "Weekly Sync", icon: "table_chart" },
  // Work Logs (WorkLogs.tsx) is an unbuilt placeholder (iTop API integration),
  // so it's intentionally NOT in this catalogue. Route stays registered in
  // App.tsx — mirror of how Tasks is kept routable but hidden. This also keeps
  // the nav in CLAUDE.md's canonical order (no Work Logs entry).
  { to: "/executive", label: "Executive", icon: "leaderboard", requires: "report:executive" },
  { to: "/settings", label: "Settings", icon: "settings" },
  { to: "/admin", label: "Admin", icon: "admin_panel_settings", requires: "*" },
];

export function filterNavCommands(
  has: (permission: string) => boolean,
  query: string,
): NavCommand[] {
  const q = query.trim().toLowerCase();
  return NAV_COMMANDS.filter(
    (c) => (!c.requires || has(c.requires)) && (q === "" || c.label.toLowerCase().includes(q)),
  );
}
