// "Actions" group of the ⌘K palette. Pure module (like navCommands.ts): the
// permission check is injected so it stays unit-testable in the node-env
// Vitest config. Each action navigates with a one-shot `?new=` query param
// that the target page reads to open its own create modal, then strips.
export interface PaletteAction {
  id: string;
  label: string;
  icon: string;
  to: string;
}

/** Query param the create-capable pages read to open their create form. */
export const NEW_PARAM = "new";

const PROJECT_PATH = /^\/projects\/(\d+)(?:\/|$)/;

/** The project id when `pathname` is a project page, else null. */
export function projectIdFromPath(pathname: string): number | null {
  const m = PROJECT_PATH.exec(pathname);
  return m ? Number(m[1]) : null;
}

export function buildPaletteActions(
  has: (permission: string) => boolean,
  pathname: string,
  query: string,
  search = "",
): PaletteAction[] {
  const actions: PaletteAction[] = [];
  if (has("project:write")) {
    actions.push({
      id: "new-project",
      label: "New project",
      icon: "add",
      to: `/projects?${NEW_PARAM}=1`,
    });
    actions.push({
      id: "new-customer",
      label: "New customer",
      icon: "add",
      to: `/customers?${NEW_PARAM}=1`,
    });
  }
  if (has("task:write") && projectIdFromPath(pathname) !== null) {
    // Stay on the current tab; ProjectDetail opens the modal on any of them.
    // Merge into the current query string so an open ?task= / ?epic= panel
    // or a ?view= filter survives the navigation.
    const params = new URLSearchParams(search);
    params.set(NEW_PARAM, "task");
    actions.push({
      id: "add-task",
      label: "Add task",
      icon: "add_task",
      to: `${pathname}?${params.toString()}`,
    });
  }
  const q = query.trim().toLowerCase();
  return q === "" ? actions : actions.filter((a) => a.label.toLowerCase().includes(q));
}
