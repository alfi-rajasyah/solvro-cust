import type { StatusTone, TaskStatus, TaskStatusDef } from "@/lib/queries";

// Pure helpers over the workspace status list
// (docs/archive/plans/custom-task-statuses.md §3 B2/B4).

/** Category order everywhere statuses are grouped or sorted. */
export const STATUS_CATEGORY_ORDER: readonly TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

/** The one tone a bare category (and a new status in it) starts with: To do gray, In progress primary, Done emerald. */
export const CATEGORY_DEFAULT_TONE: Record<TaskStatus, StatusTone> = {
  TODO: "gray",
  IN_PROGRESS: "primary",
  DONE: "emerald",
};

/** Material Symbols glyph for each category header. */
export const STATUS_CATEGORY_ICON: Record<TaskStatus, string> = {
  TODO: "radio_button_unchecked",
  IN_PROGRESS: "timelapse",
  DONE: "check_circle",
};

type DefOrder = Pick<TaskStatusDef, "category" | "position">;

/** Category first (To do, In progress, Done), then the admin-set position. */
export function compareStatusDefs(a: DefOrder, b: DefOrder): number {
  return (
    STATUS_CATEGORY_ORDER.indexOf(a.category) - STATUS_CATEGORY_ORDER.indexOf(b.category) ||
    a.position - b.position
  );
}

/** The defs under their category, in the category order, each by position. Empty categories are left out. */
export function groupStatusDefs<T extends DefOrder>(
  defs: readonly T[] | undefined,
): { category: TaskStatus; defs: T[] }[] {
  const sorted = [...(defs ?? [])].sort(compareStatusDefs);
  return STATUS_CATEGORY_ORDER.map((category) => ({
    category,
    defs: sorted.filter((d) => d.category === category),
  })).filter((g) => g.defs.length > 0);
}

/** One sortable number: category first, then position (positions stay far below 1e6). */
export function statusSortKey(def: DefOrder): number {
  return STATUS_CATEGORY_ORDER.indexOf(def.category) * 1_000_000 + def.position;
}

/** Tasks-page status filter values: a whole category, or one workspace status. */
export const STATUS_FILTER_CATEGORY_PREFIX = "cat:";
export const STATUS_FILTER_ID_PREFIX = "id:";

export interface StatusFilterOption {
  value: string;
  label: string;
  def?: TaskStatusDef;
  category: TaskStatus;
}

/**
 * Options for the Tasks status filter, grouped by category (category order,
 * then position). A category with more than one status also gets a leading
 * "all of it" option (`cat:` -> `?status=`); a single-status category is just
 * that status (`id:` -> `?statusId=`), so the default three-status workspace
 * lists exactly To do / In progress / Done.
 */
export function statusFilterOptions(
  defs: readonly TaskStatusDef[] | undefined,
  categoryLabel: Record<TaskStatus, string>,
): StatusFilterOption[] {
  const out: StatusFilterOption[] = [];
  for (const g of groupStatusDefs(defs)) {
    if (g.defs.length > 1) {
      out.push({
        value: `${STATUS_FILTER_CATEGORY_PREFIX}${g.category}`,
        label: `${categoryLabel[g.category]} (all)`,
        category: g.category,
      });
    }
    for (const d of g.defs) {
      out.push({ value: `${STATUS_FILTER_ID_PREFIX}${d.id}`, label: d.name, def: d, category: g.category });
    }
  }
  return out;
}

/** The `TasksFilter` slice a status filter value stands for. */
export function statusFilterToQuery(value: string | undefined): { status?: TaskStatus; statusId?: number } {
  if (!value) return {};
  if (value.startsWith(STATUS_FILTER_CATEGORY_PREFIX)) {
    const c = value.slice(STATUS_FILTER_CATEGORY_PREFIX.length) as TaskStatus;
    return STATUS_CATEGORY_ORDER.includes(c) ? { status: c } : {};
  }
  if (value.startsWith(STATUS_FILTER_ID_PREFIX)) {
    const id = Number(value.slice(STATUS_FILTER_ID_PREFIX.length));
    return Number.isInteger(id) && id > 0 ? { statusId: id } : {};
  }
  return {};
}
