// Static catalogue of page destinations shared by the sidebar nav
// (Sidebar.tsx derives its render list from NAV_COMMANDS directly) and the
// ⌘K palette (CommandPalette.tsx). Single source of truth: this file stays a
// pure module — the permission check is injected so it never imports React
// and stays unit-testable in the node-env Vitest config.
export type NavGroup = "Workspace" | "Cadence" | "Insights" | "System";

// Render order of the sidebar's group sections. NAV_COMMANDS is already
// ordered group-by-group; the sidebar buckets by `group` in this order. The ⌘K
// palette ignores the field and keeps its flat list.
export const NAV_GROUPS: readonly NavGroup[] = ["Workspace", "Cadence", "Insights", "System"];

export interface NavCommand {
  to: string;
  label: string;
  icon: string;
  /** Sidebar section this page is listed under. */
  group: NavGroup;
  /** Permission required to list this page; "*" restricts to admin wildcard. */
  requires?: string;
}

export const NAV_COMMANDS: readonly NavCommand[] = [
  { to: "/overview", label: "Overview", icon: "dashboard", group: "Workspace" },
  { to: "/projects", label: "Projects", icon: "folder_managed", group: "Workspace" },
  { to: "/customers", label: "Customers", icon: "groups", group: "Workspace" },
  { to: "/daily-review", label: "Daily Review", icon: "edit_note", group: "Cadence" },
  { to: "/weekly-sync", label: "Weekly Sync", icon: "table_chart", group: "Cadence" },
  // Utilization (Utilization.tsx) replaced the old Work Logs placeholder (Task 3.3).
  { to: "/utilization", label: "Utilization", icon: "schedule", group: "Insights" },
  {
    to: "/executive",
    label: "Executive",
    icon: "leaderboard",
    group: "Insights",
    requires: "report:executive",
  },
  { to: "/settings", label: "Settings", icon: "settings", group: "System" },
  { to: "/admin", label: "Admin", icon: "admin_panel_settings", group: "System", requires: "*" },
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
