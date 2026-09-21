import { describe, expect, it } from "vitest";
import { createFilter, findFilterMatch, type Filter } from "./filters";

/**
 * Deterministic regression proof for the duplicate-chip idempotence guard
 * (docs/ISSUES.md's "Duplicate-chip mouse race" entry): Base UI's
 * useMenuItemCommonProps can fire a programmatic click on mouseup on top of
 * the natural one, so a single user interaction can invoke a chip-creating
 * handler twice. `findFilterMatch` is the pure comparison core every
 * unconditional chip-append call site in `filters.tsx` consults before
 * appending — this suite pins its behavior independent of DOM/e2e timing,
 * which the e2e spec (`e2e/tests/filters-duplicate-chip.spec.ts`) cannot
 * force deterministically.
 */
describe("findFilterMatch — duplicate-chip idempotence guard's comparison core", () => {
  const existing: Filter<string>[] = [createFilter("status", "is", ["TODO"])];

  it("finds the exact duplicate: same field, identical values — this is the raced double-append", () => {
    const match = findFilterMatch(existing, "status", ["TODO"]);
    expect(match).toBe(existing[0]);
  });

  it("allows a different value for the same field — a legitimate second allowMultiple chip", () => {
    const match = findFilterMatch(existing, "status", ["DONE"]);
    expect(match).toBeUndefined();
  });

  it("allows a different-length values array for the same field (e.g. a multiselect chip growing)", () => {
    const match = findFilterMatch(existing, "status", ["TODO", "DONE"]);
    expect(match).toBeUndefined();
  });

  it("allows the same values for a different field", () => {
    const match = findFilterMatch(existing, "priority", ["TODO"]);
    expect(match).toBeUndefined();
  });

  it("returns undefined against an empty filter list", () => {
    expect(findFilterMatch([], "status", ["TODO"])).toBeUndefined();
  });

  it("matches on empty values too (the plain addFilter fallback path's default state)", () => {
    const emptyValueFilters: Filter<string>[] = [createFilter("customerId", "is", [])];
    expect(findFilterMatch(emptyValueFilters, "customerId", [])).toBe(emptyValueFilters[0]);
    expect(findFilterMatch(emptyValueFilters, "customerId", ["1"])).toBeUndefined();
  });

  it("compares elements with ===, so multiselect value order matters (same set, different order, does not match)", () => {
    const multi: Filter<string>[] = [createFilter("labels", "is_any_of", ["a", "b"])];
    expect(findFilterMatch(multi, "labels", ["b", "a"])).toBeUndefined();
    expect(findFilterMatch(multi, "labels", ["a", "b"])).toBe(multi[0]);
  });
});
