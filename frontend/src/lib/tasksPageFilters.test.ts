import { describe, expect, it } from "vitest";
import { normalizeTasksFilter, tasksQueryString } from "@/lib/queries";
import {
  cleanLabelNames,
  chipValuesOfChips,
  chipsFromValues,
  parseChipValues,
  pruneChipValues,
  writeChipValues,
  normalizeLabelNames,
  parseLabelNames,
  pruneLabelNames,
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

const none = { status: [], priority: [], assignedToId: [], customerId: [], label: [] };

describe("chip values in the URL", () => {
  it("round-trips every chip and leaves view, tamId and assigneeId alone", () => {
    const base = new URLSearchParams("view=overdue&tamId=4&assigneeId=9");
    const values = {
      status: ["id:3"],
      priority: ["HIGH"],
      assignedToId: ["7"],
      customerId: ["12"],
      label: ["Blocked", "Needs review"],
    };
    const written = writeChipValues(base, values);
    expect(written.get("status")).toBe("id:3");
    expect(written.get("priority")).toBe("HIGH");
    expect(written.get("assignee")).toBe("7");
    expect(written.get("customer")).toBe("12");
    expect(written.getAll("label")).toEqual(["Blocked", "Needs review"]);
    expect(written.get("view")).toBe("overdue");
    expect(written.get("tamId")).toBe("4");
    expect(written.get("assigneeId")).toBe("9");
    expect(parseChipValues(new URLSearchParams(written.toString()))).toEqual(values);
  });

  it("reads a status category and a single status", () => {
    expect(parseChipValues(new URLSearchParams("status=cat:DONE")).status).toEqual(["cat:DONE"]);
    expect(parseChipValues(new URLSearchParams("status=id:5")).status).toEqual(["id:5"]);
  });

  it("ignores malformed values", () => {
    const p = parseChipValues(
      new URLSearchParams("status=nope&priority=urgent&assignee=abc&customer=-3&status=id:2"),
    );
    expect(p).toEqual(none);
    expect(parseChipValues(new URLSearchParams("assignee=0")).assignedToId).toEqual([]);
    expect(parseChipValues(new URLSearchParams("status=id:0")).status).toEqual([]);
  });

  it("an all-empty value set removes every chip param", () => {
    const base = new URLSearchParams("status=id:1&priority=LOW&assignee=2&customer=3&label=x&view=all");
    expect(writeChipValues(base, none).toString()).toBe("view=all");
  });
});

describe("chips and values", () => {
  const priorityChip = { id: "p1", field: "priority", operator: "is", values: ["LOW"] };

  it("reads the values a chip list holds", () => {
    const chips = [
      priorityChip,
      { id: "l1", field: "label", operator: "is_any_of", values: ["Bug", "bug", "Blocked"] },
      { id: "s1", field: "status", operator: "is", values: [] },
    ];
    expect(chipValuesOfChips(chips)).toEqual({ ...none, priority: ["LOW"], label: ["Bug", "Blocked"] });
  });

  it("builds a chip for each set field and keeps ids and empty pending chips", () => {
    const built = chipsFromValues({ ...none, priority: ["HIGH"], label: ["Bug"] }, []);
    expect(built.map((c) => [c.field, c.operator, c.values])).toEqual([
      ["priority", "is", ["HIGH"]],
      ["label", "is_any_of", ["Bug"]],
    ]);
    const pending = { id: "c1", field: "customerId", operator: "is", values: [] };
    const next = chipsFromValues({ ...none, priority: ["URGENT"] }, [priorityChip, pending]);
    expect(next).toEqual([{ ...priorityChip, values: ["URGENT"] }, pending]);
  });

  it("drops a chip whose field the URL no longer sets", () => {
    expect(chipsFromValues(none, [priorityChip])).toEqual([]);
  });
});

describe("pruneChipValues", () => {
  const values = { status: ["id:9"], priority: ["LOW"], assignedToId: ["4"], customerId: ["8"], label: ["Gone", "bug"] };

  it("drops values the loaded lists no longer offer", () => {
    expect(
      pruneChipValues(values, {
        status: ["id:1", "cat:TODO"],
        assignedToId: ["5"],
        customerId: ["8"],
        label: ["Bug"],
      }),
    ).toEqual({ status: [], priority: ["LOW"], assignedToId: [], customerId: ["8"], label: ["Bug"] });
  });

  it("never prunes a chip whose list is not loaded, and never prunes priority", () => {
    expect(pruneChipValues(values, {})).toBeNull();
    expect(pruneChipValues(values, { customerId: ["8"] })).toBeNull();
  });

  it("returns null when everything is still offered", () => {
    expect(
      pruneChipValues(
        { ...none, status: ["cat:DONE"], assignedToId: ["4"], label: ["Bug"] },
        { status: ["cat:DONE"], assignedToId: ["4"], label: ["Bug"] },
      ),
    ).toBeNull();
  });
});
