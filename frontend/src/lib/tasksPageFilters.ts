/**
 * URL encoding of the /tasks page's filter chips. One rule per chip: the
 * picked values live in the query string, absent param = chip inactive, and
 * every other param (`view`, `tamId`, `assigneeId`, other chips) is left alone.
 *
 *   label  repeated, one label NAME per param (`?label=Blocked&label=Bug`)
 *
 * Label names, not ids: one name is a different label row in every project,
 * and the server matches the name case-insensitively across visible projects.
 */

import type { Filter } from "@/components/reui/filters";

export const LABEL_PARAM = "label";

/** Chip field key and the stable chip id for the Label filter. */
export const LABEL_FIELD = "label";
const LABEL_CHIP_ID = "label-filter";

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

/** The label names a chip list currently holds (the chip's values), cleaned. */
export function labelNamesOfChips(chips: readonly Filter<string>[]): string[] {
  return cleanLabelNames(chips.find((c) => c.field === LABEL_FIELD)?.values ?? []);
}

/**
 * `chips` with the Label chip set to `names` and every other chip untouched.
 * No names removes the chip. The id stays the same so the open picker keeps
 * its place while the values change.
 */
export function withLabelChip(chips: readonly Filter<string>[], names: readonly string[]): Filter<string>[] {
  const rest = chips.filter((c) => c.field !== LABEL_FIELD);
  if (names.length === 0) return rest;
  const id = chips.find((c) => c.field === LABEL_FIELD)?.id ?? LABEL_CHIP_ID;
  return [...rest, { id, field: LABEL_FIELD, operator: "is_any_of", values: [...names] }];
}
