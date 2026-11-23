import { describe, expect, it } from "vitest";
import { normalizeTasksFilter, tasksQueryString } from "@/lib/queries";
import {
  cleanLabelNames,
  labelNamesOfChips,
  normalizeLabelNames,
  parseLabelNames,
  pruneLabelNames,
  withLabelChip,
  writeLabelNames,
} from "@/lib/tasksPageFilters";

describe("tasksQueryString labelNames", () => {
  it("sends each name as a repeated labelName", () => {
    const qs = new URLSearchParams(tasksQueryString({ labelNames: ["Bug", "Blocked"] }));
    expect(qs.getAll("labelName")).toEqual(["Blocked", "Bug"]);
  });

  it("gives the same query and the same normalized filter for the same set in another order", () => {
    const a = { labelNames: ["Bug", "blocked", "A_b"] };
    const b = { labelNames: ["A_b", "Blocked", "bug"] };
    expect(tasksQueryString(a).toLowerCase()).toBe(tasksQueryString(b).toLowerCase());
    expect(normalizeLabelNames(a.labelNames).map((n) => n.toLowerCase())).toEqual(
      normalizeLabelNames(b.labelNames).map((n) => n.toLowerCase()),
    );
    const sameOrder = { labelNames: ["Bug", "Blocked"] };
    const reordered = { labelNames: ["Blocked", "Bug"] };
    expect(normalizeTasksFilter(sameOrder)).toEqual(normalizeTasksFilter(reordered));
  });

  it("omits the param for an empty or missing list and encodes odd names", () => {
    expect(tasksQueryString({ labelNames: [] })).toBe("");
    expect(tasksQueryString({})).toBe("");
    expect(new URLSearchParams(tasksQueryString({ labelNames: ["50% & more"] })).get("labelName")).toBe(
      "50% & more",
    );
  });

  it("keeps the other filters alongside", () => {
    const qs = new URLSearchParams(tasksQueryString({ priority: "HIGH", labelNames: ["Bug"], open: true }));
    expect(qs.get("priority")).toBe("HIGH");
    expect(qs.get("open")).toBe("true");
    expect(qs.getAll("labelName")).toEqual(["Bug"]);
  });
});

describe("label names in the URL", () => {
  it("round-trips repeated ?label= and leaves other params alone", () => {
    const base = new URLSearchParams("view=overdue&tamId=4");
    const written = writeLabelNames(base, ["Blocked", "Needs review"]);
    expect(written.getAll("label")).toEqual(["Blocked", "Needs review"]);
    expect(written.get("view")).toBe("overdue");
    expect(written.get("tamId")).toBe("4");
    expect(parseLabelNames(new URLSearchParams(written.toString()))).toEqual(["Blocked", "Needs review"]);
  });

  it("rewrites rather than appends, and an empty list removes the param", () => {
    const once = writeLabelNames(new URLSearchParams(), ["a", "b"]);
    expect(writeLabelNames(once, ["c"]).getAll("label")).toEqual(["c"]);
    expect(writeLabelNames(once, []).has("label")).toBe(false);
  });

  it("drops blank, over-long and case-duplicate names and caps at 20", () => {
    expect(cleanLabelNames([" Bug ", "", "bug", "x".repeat(51), "Ok"])).toEqual(["Bug", "Ok"]);
    const many = Array.from({ length: 30 }, (_, i) => `n${i}`);
    expect(cleanLabelNames(many)).toHaveLength(20);
  });
});

describe("pruneLabelNames", () => {
  it("returns null when every name is already spelled as the list spells it", () => {
    expect(pruneLabelNames(["Blocked", "Bug"], ["Blocked", "Bug", "Other"])).toBeNull();
  });

  it("respells a name to the list's casing so the picker shows it selected", () => {
    expect(pruneLabelNames(["blocked", "BUG"], ["Blocked", "Bug"])).toEqual(["Blocked", "Bug"]);
  });

  it("drops names with no case-insensitive match, keeping URL order", () => {
    expect(pruneLabelNames(["Gone", "bug", "Blocked"], ["Blocked", "Bug"])).toEqual(["Bug", "Blocked"]);
  });

  it("matches _ and % literally", () => {
    expect(pruneLabelNames(["a_b"], ["axb"])).toEqual([]);
    expect(pruneLabelNames(["A_B"], ["A_B"])).toBeNull();
  });
});

describe("label chip", () => {
  const status = { id: "s1", field: "status", operator: "is", values: ["TODO"] };

  it("adds, updates and removes the chip without touching the others", () => {
    const added = withLabelChip([status], ["Bug"]);
    expect(added).toEqual([status, { id: "label-filter", field: "label", operator: "is_any_of", values: ["Bug"] }]);
    const updated = withLabelChip(added, ["Bug", "Blocked"]);
    expect(updated[1].id).toBe("label-filter");
    expect(labelNamesOfChips(updated)).toEqual(["Bug", "Blocked"]);
    expect(withLabelChip(updated, [])).toEqual([status]);
  });
});
