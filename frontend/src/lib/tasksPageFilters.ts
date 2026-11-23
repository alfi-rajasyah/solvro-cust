/**
 * URL encoding of the /tasks page's filter chips. One rule per chip: the
 * picked values live in the query string, absent param = chip inactive, and
 * every other param (`view`, `tamId`, `assigneeId`, other chips) is left alone.
 *
 *   status    `cat:<CATEGORY>` or `id:<statusId>`, as the chip's option value
 *   priority  LOW | MEDIUM | HIGH | URGENT
 *   assignee  user id. Distinct from `?assigneeId=` (carried in from the
 *             Overview); when both are set the chip wins, as before.
 *   customer  customer id
 *   label     repeated, one label NAME per param (`?label=Blocked&label=Bug`)
 *
 * Each chip's field key (`status`, `priority`, `assignedToId`, `customerId`,
 * `label`) is what the Filters component and `TasksFilter` use; `CHIP_PARAM`
 * maps it to the URL param.
 *
 * Label names, not ids: one name is a different label row in every project,
 * and the server matches the name case-insensitively across visible projects.
 */

import type { Filter } from "@/components/reui/filters";
import type { Priority } from "@/lib/queries";
import { statusFilterToQuery } from "@/lib/taskStatuses";

export const LABEL_PARAM = "label";

/** Chip field key and the stable chip id for the Label filter. */
export const LABEL_FIELD = "label";

/** Server limits on `labelName` (backend tasksListQuerySchema). */
export const MAX_LABEL_NAMES = 20;
export const MAX_LABEL_NAME_LENGTH = 50;

/**
 * Trimmed, in-range, de-duplicated (case-insensitively, first spelling wins),
 * capped at the server's limit. Keeps the given order.
 */
export function cleanLabelNames(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const name = value.trim();
    const key = name.toLowerCase();
    if (!name || name.length > MAX_LABEL_NAME_LENGTH || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length === MAX_LABEL_NAMES) break;
  }
  return out;
}

/**
 * The same set in any order or casing gives the same array, so it maps to one
 * react-query cache entry and one request URL.
 */
export function normalizeLabelNames(raw: readonly string[]): string[] {
  return cleanLabelNames(raw).sort((a, b) => {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : 0;
  });
}

export function parseLabelNames(params: URLSearchParams): string[] {
  return cleanLabelNames(params.getAll(LABEL_PARAM));
}

/** Writes `names` into a copy of `params`, leaving every other param alone. */
export function writeLabelNames(params: URLSearchParams, names: readonly string[]): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(LABEL_PARAM);
  for (const name of cleanLabelNames(names)) next.append(LABEL_PARAM, name);
  return next;
}

/**
 * The URL names that still match a known label name (case-insensitive), in
 * URL order and spelled as the list spells them; `null` when nothing changes.
 * Pass the list only once it is loaded and fresh.
 */
export function pruneLabelNames(names: readonly string[], known: readonly string[]): string[] | null {
  const byLower = new Map(known.map((k) => [k.toLowerCase(), k]));
  const kept = names.flatMap((n) => byLower.get(n.toLowerCase()) ?? []);
  const unchanged = kept.length === names.length && kept.every((k, i) => k === names[i]);
  return unchanged ? null : kept;
}

export type ChipField = "status" | "priority" | "assignedToId" | "customerId" | "label";

/** Display order of the chips when several are set. */
export const CHIP_FIELDS: readonly ChipField[] = ["status", "priority", "assignedToId", "customerId", "label"];

/** URL param of each chip. `assignee`, not `assigneeId`, which is the Overview's carried-in filter. */
export const CHIP_PARAM: Record<ChipField, string> = {
  status: "status",
  priority: "priority",
  assignedToId: "assignee",
  customerId: "customer",
  label: LABEL_PARAM,
};

/** Picked values per chip; `[]` = inactive. Every chip but Label holds at most one value. */
export type ChipValues = Record<ChipField, string[]>;

export const EMPTY_CHIP_VALUES: ChipValues = {
  status: [],
  priority: [],
  assignedToId: [],
  customerId: [],
  label: [],
};

const PRIORITIES: readonly Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

function isPositiveInt(raw: string): boolean {
  return /^\d+$/.test(raw) && Number(raw) > 0 && Number.isSafeInteger(Number(raw));
}

/** Whether `raw` is a well-formed value for a single-valued chip. */
function validSingle(field: ChipField, raw: string): boolean {
  switch (field) {
    case "status":
      return Object.keys(statusFilterToQuery(raw)).length > 0;
    case "priority":
      return (PRIORITIES as readonly string[]).includes(raw);
    default:
      return isPositiveInt(raw);
  }
}

/** The chips the URL carries. A malformed value is ignored, never trusted. */
export function parseChipValues(params: URLSearchParams): ChipValues {
  const values: ChipValues = { ...EMPTY_CHIP_VALUES, label: parseLabelNames(params) };
  for (const field of CHIP_FIELDS) {
    if (field === "label") continue;
    const raw = params.get(CHIP_PARAM[field]);
    values[field] = raw !== null && validSingle(field, raw) ? [raw] : [];
  }
  return values;
}

/** Writes `values` into a copy of `params`, leaving every other param alone. */
export function writeChipValues(params: URLSearchParams, values: ChipValues): URLSearchParams {
  let next = new URLSearchParams(params);
  for (const field of CHIP_FIELDS) {
    if (field === "label") continue;
    next.delete(CHIP_PARAM[field]);
    const [value] = values[field];
    if (value !== undefined && validSingle(field, value)) next.set(CHIP_PARAM[field], value);
  }
  next = writeLabelNames(next, values.label);
  return next;
}

/** A string that changes exactly when the picked values do. */
export function chipValuesKey(values: ChipValues): string {
  return JSON.stringify(CHIP_FIELDS.map((f) => values[f]));
}

/** The values a chip list currently holds, cleaned like the URL parse. */
export function chipValuesOfChips(chips: readonly Filter<string>[]): ChipValues {
  const values: ChipValues = { ...EMPTY_CHIP_VALUES };
  for (const field of CHIP_FIELDS) {
    const raw = chips.find((c) => c.field === field)?.values ?? [];
    if (field === "label") values.label = cleanLabelNames(raw);
    else values[field] = raw[0] !== undefined && validSingle(field, raw[0]) ? [raw[0]] : [];
  }
  return values;
}

/**
 * `chips` brought in step with `values`: a chip keeps its id and place while
 * its values change, a chip whose field is no longer set goes away (unless it
 * is still empty, i.e. just added and waiting for a pick), and a newly set
 * field gets a chip. Used when the URL changes from outside the chips.
 */
export function chipsFromValues(values: ChipValues, prev: readonly Filter<string>[]): Filter<string>[] {
  const out: Filter<string>[] = [];
  const placed = new Set<string>();
  for (const chip of prev) {
    const field = chip.field as ChipField;
    if (!CHIP_FIELDS.includes(field)) {
      out.push(chip);
      continue;
    }
    placed.add(field);
    if (values[field].length > 0) out.push({ ...chip, values: [...values[field]] });
    else if (chip.values.length === 0) out.push(chip);
  }
  for (const field of CHIP_FIELDS) {
    if (placed.has(field) || values[field].length === 0) continue;
    out.push({
      id: `${field}-filter`,
      field,
      operator: field === "label" ? "is_any_of" : "is",
      values: [...values[field]],
    });
  }
  return out;
}

/** Option values each chip currently offers; a missing key = list not loaded and fresh, never pruned. */
export type KnownChipOptions = Partial<Record<Exclude<ChipField, "priority">, readonly string[]>>;

/**
 * `values` without the picks their list no longer offers (a deleted user or
 * customer, an unknown status, a label name no project has), or `null` when
 * nothing changes. Label names match case-insensitively and take the list's
 * spelling. Priority is a fixed enum and is never pruned.
 */
export function pruneChipValues(values: ChipValues, known: KnownChipOptions): ChipValues | null {
  const next: ChipValues = { ...values };
  let changed = false;
  for (const field of ["status", "assignedToId", "customerId"] as const) {
    const options = known[field];
    if (!options || values[field].length === 0) continue;
    if (!options.includes(values[field][0])) {
      next[field] = [];
      changed = true;
    }
  }
  if (known.label) {
    const kept = pruneLabelNames(values.label, known.label);
    if (kept) {
      next.label = kept;
      changed = true;
    }
  }
  return changed ? next : null;
}
