import { describe, expect, it } from "vitest";
import type { DailyReviewCustomer, WeeklyAchievement, WeeklyHighlight, WeeklyUpdate } from "./queries";
import {
  buildSyncTable,
  hasManagerDecision,
  hasTabUpdate,
  orderForTab,
  toHtmlTable,
  toTsv,
} from "./weeklySyncTable";

let nextId = 1;

function highlight(fields: Partial<WeeklyHighlight> = {}): WeeklyHighlight {
  return {
    id: nextId++,
    position: 0,
    title: "Highlight",
    detail: null,
    risk: null,
    action: null,
    ...fields,
  };
}

function achievement(fields: Partial<WeeklyAchievement> = {}): WeeklyAchievement {
  return {
    id: nextId++,
    position: 0,
    title: "Achievement",
    detail: null,
    outstandingIssue: null,
    lessonLearned: null,
    nextWeekFocus: null,
    managerDecision: null,
    ...fields,
  };
}

function weeklyUpdate(fields: Partial<WeeklyUpdate> = {}): WeeklyUpdate {
  return {
    id: nextId++,
    weekStart: "2026-08-24T00:00:00.000Z",
    health: null,
    status: "DRAFT",
    doneAt: null,
    category: null,
    highlights: [],
    achievements: [],
    midweekSavedAt: null,
    author: { id: 1, username: "alfi" },
    updatedAt: "2026-08-24T00:00:00.000Z",
    ...fields,
  };
}

function customer(name: string, update: Partial<WeeklyUpdate> | null = {}): DailyReviewCustomer {
  return {
    id: nextId++,
    name,
    tam: null,
    projects: [],
    operationsNotes: [],
    weeklyUpdate: update === null ? null : weeklyUpdate(update),
    previousWeeklyUpdate: null,
  };
}

describe("hasManagerDecision", () => {
  it("is false for a customer with no update, no achievements, and an achievement with a null/whitespace-only decision", () => {
    expect(hasManagerDecision(customer("A", null))).toBe(false);
    expect(hasManagerDecision(customer("B", { achievements: [] }))).toBe(false);
    expect(
      hasManagerDecision(customer("C", { achievements: [achievement({ managerDecision: null })] })),
    ).toBe(false);
    expect(
      hasManagerDecision(customer("D", { achievements: [achievement({ managerDecision: "   " })] })),
    ).toBe(false);
  });

  it("is true when at least one achievement row has a non-empty decision, even among several without one", () => {
    expect(
      hasManagerDecision(
        customer("E", {
          achievements: [
            achievement({ title: "One" }),
            achievement({ title: "Two", managerDecision: "Approve budget" }),
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe("hasTabUpdate", () => {
  it("is false on both tabs for a customer with no weekly-update row", () => {
    const c = customer("None", null);
    expect(hasTabUpdate("midweek", c)).toBe(false);
    expect(hasTabUpdate("reflection", c)).toBe(false);
  });

  it("mid-week: true once the Mid-week form was saved, any highlight exists, or category has text", () => {
    expect(hasTabUpdate("midweek", customer("Saved", { midweekSavedAt: "2026-08-26T09:00:00.000Z" }))).toBe(true);
    expect(hasTabUpdate("midweek", customer("Highlight", { highlights: [highlight()] }))).toBe(true);
    expect(hasTabUpdate("midweek", customer("Category", { category: "Onboarding" }))).toBe(true);
    expect(hasTabUpdate("midweek", customer("Blank", { category: "   ", highlights: [] }))).toBe(false);
  });

  it("reflection: true once the week is done, or the week has at least one achievement", () => {
    expect(
      hasTabUpdate(
        "reflection",
        customer("Done", { status: "DONE", health: "GREEN", achievements: [achievement()] }),
      ),
    ).toBe(true);
    expect(
      hasTabUpdate(
        "reflection",
        customer("Achievement", { achievements: [achievement({ nextWeekFocus: "Phase 2" })] }),
      ),
    ).toBe(true);
    expect(hasTabUpdate("reflection", customer("Blank", { achievements: [] }))).toBe(false);
  });

  it("health alone never counts, and a Mid-week-only save is not a Reflection update", () => {
    const midweekOnly = customer("Midweek", {
      health: "AMBER",
      highlights: [highlight({ title: "Kickoff" })],
      midweekSavedAt: "2026-08-26T09:00:00.000Z",
    });
    expect(hasTabUpdate("midweek", midweekOnly)).toBe(true);
    expect(hasTabUpdate("reflection", midweekOnly)).toBe(false);
    const healthOnly = customer("Health", { health: "GREEN" });
    expect(hasTabUpdate("midweek", healthOnly)).toBe(false);
    expect(hasTabUpdate("reflection", healthOnly)).toBe(false);
  });
});

describe("orderForTab", () => {
  it("keeps input order unchanged on the mid-week tab", () => {
    const customers = [
      customer("Acme", { achievements: [achievement({ managerDecision: "Needs sign-off" })] }),
      customer("Globex"),
      customer("Initech"),
    ];
    expect(orderForTab("midweek", customers)).toEqual(customers);
  });

  it("pins customers with a non-empty manager decision (from any achievement row) first on the reflection tab, each group in input order", () => {
    const acme = customer("Acme");
    const globex = customer("Globex", { achievements: [achievement({ managerDecision: "Approve extra budget" })] });
    const initech = customer("Initech");
    const umbrella = customer("Umbrella", { achievements: [achievement({ managerDecision: "  " })] }); // whitespace-only, not pinned
    const soylent = customer("Soylent", {
      achievements: [achievement({ title: "One" }), achievement({ title: "Two", managerDecision: "Escalate to VP" })],
    });

    const ordered = orderForTab("reflection", [acme, globex, initech, umbrella, soylent]);

    expect(ordered.map((c) => c.name)).toEqual(["Globex", "Soylent", "Acme", "Initech", "Umbrella"]);
  });

  it("does not mutate the input array", () => {
    const customers = [
      customer("Acme", { achievements: [achievement({ managerDecision: "x" })] }),
      customer("Globex"),
    ];
    const copy = [...customers];
    orderForTab("reflection", customers);
    expect(customers).toEqual(copy);
  });
});

describe("buildSyncTable", () => {
  it("uses the mid-week header order: Customer, Health, Category, Highlight, Risk, Action", () => {
    const table = buildSyncTable("midweek", []);
    expect(table.header).toEqual(["Customer", "Health", "Category", "Highlight", "Risk", "Action"]);
  });

  it("uses the reflection header order: Customer, then the reflection fields — no Health or Category column", () => {
    const table = buildSyncTable("reflection", []);
    expect(table.header).toEqual([
      "Customer",
      "Weekly achievement",
      "Outstanding issue",
      "Lesson learned",
      "Next week focus",
      "Need manager decision",
    ]);
  });

  it("renders a full mid-week row", () => {
    const table = buildSyncTable("midweek", [
      customer("Acme", {
        category: "Onboarding",
        health: "AMBER",
        highlights: [highlight({ title: "Kickoff done", risk: "Vendor delay", action: "Chase vendor" })],
      }),
    ]);
    expect(table.rows).toEqual([["Acme", "Amber", "Onboarding", "Kickoff done", "Vendor delay", "Chase vendor"]]);
  });

  it("renders one row per highlight, with the customer, health, and category repeated on each (D8)", () => {
    const table = buildSyncTable("midweek", [
      customer("Acme", {
        category: "Onboarding",
        health: "AMBER",
        highlights: [
          highlight({ title: "Server request", risk: "Vendor delay", action: "Chase vendor" }),
          highlight({ title: "Remote trading test" }),
        ],
      }),
    ]);
    expect(table.rows).toEqual([
      ["Acme", "Amber", "Onboarding", "Server request", "Vendor delay", "Chase vendor"],
      ["Acme", "Amber", "Onboarding", "Remote trading test", "—", "—"],
    ]);
  });

  it("joins a highlight's title and detail with a newline in the Highlight cell", () => {
    const table = buildSyncTable("midweek", [
      customer("Acme", {
        highlights: [highlight({ title: "Server request", detail: "Waiting on vendor callback" })],
      }),
    ]);
    expect(table.rows[0][3]).toBe("Server request\nWaiting on vendor callback");
  });

  it("treats a whitespace-only detail/risk/action as empty, same as every other cell", () => {
    const table = buildSyncTable("midweek", [
      customer("Acme", {
        highlights: [highlight({ title: "Server request", detail: "   ", risk: "  ", action: "" })],
      }),
    ]);
    expect(table.rows).toEqual([["Acme", "—", "—", "Server request", "—", "—"]]);
  });

  it("a customer with a saved category but no highlight gets one row with dashes in the highlight cells", () => {
    const table = buildSyncTable("midweek", [
      customer("Acme", { category: "Onboarding", health: "GREEN", highlights: [] }),
    ]);
    expect(table.rows).toEqual([["Acme", "Green", "Onboarding", "—", "—", "—"]]);
  });

  it("renders two rows for two achievements, with the customer repeated on each (D12)", () => {
    const table = buildSyncTable("reflection", [
      customer("Acme", {
        category: "Onboarding",
        health: "GREEN",
        achievements: [
          achievement({
            title: "Shipped v1",
            outstandingIssue: "None",
            lessonLearned: "Start earlier",
            nextWeekFocus: "Phase 2",
            managerDecision: "Approve extra scope",
          }),
          achievement({ title: "Shipped v2" }),
        ],
      }),
    ]);
    expect(table.rows).toEqual([
      ["Acme", "Shipped v1", "None", "Start earlier", "Phase 2", "Approve extra scope"],
      ["Acme", "Shipped v2", "—", "—", "—", "—"],
    ]);
  });

  it("joins an achievement's title and detail with a newline in the Weekly achievement cell, treating whitespace-only detail as empty", () => {
    const withDetail = buildSyncTable("reflection", [
      customer("Acme", { achievements: [achievement({ title: "Shipped v1", detail: "Went smoothly" })] }),
    ]);
    expect(withDetail.rows[0][1]).toBe("Shipped v1\nWent smoothly");

    const blankDetail = buildSyncTable("reflection", [
      customer("Acme", { achievements: [achievement({ title: "Shipped v1", detail: "   " })] }),
    ]);
    expect(blankDetail.rows[0][1]).toBe("Shipped v1");
  });

  it("a customer with no achievement gets one row with dashes in every reflection text cell", () => {
    const table = buildSyncTable("reflection", [
      customer("Acme", { achievements: [] }),
      customer("NoUpdate", null),
    ]);
    expect(table.rows).toEqual([
      ["Acme", "—", "—", "—", "—", "—"],
      ["NoUpdate", "—", "—", "—", "—", "—"],
    ]);
  });

  it("renders — for null category/health and for a customer with no update at all", () => {
    const table = buildSyncTable("midweek", [
      customer("Blank", { category: null, health: null, highlights: [] }),
      customer("NoUpdate", null),
    ]);
    expect(table.rows).toEqual([
      ["Blank", "—", "—", "—", "—", "—"],
      ["NoUpdate", "—", "—", "—", "—", "—"],
    ]);
  });

  it("does not reorder — callers pass orderForTab's output when pinning is wanted", () => {
    const globex = customer("Globex");
    const acme = customer("Acme", { achievements: [achievement({ managerDecision: "Escalate" })] });
    const table = buildSyncTable("reflection", [globex, acme]);
    expect(table.rows.map((r) => r[0])).toEqual(["Globex", "Acme"]);
  });
});

describe("toHtmlTable", () => {
  it("wraps header and rows in a real <table><thead>/<tbody>", () => {
    const html = toHtmlTable({ header: ["Customer", "Health"], rows: [["Acme", "Green"]] });
    expect(html).toBe(
      "<table><thead><tr><th>Customer</th><th>Health</th></tr></thead>" +
        "<tbody><tr><td>Acme</td><td>Green</td></tr></tbody></table>",
    );
  });

  it("escapes <, &, \", and ' in both header and cell text", () => {
    const html = toHtmlTable({
      header: ['Risk & "Action"'],
      rows: [["<script>alert('x')</script> & co"]],
    });
    expect(html).toContain("<th>Risk &amp; &quot;Action&quot;</th>");
    expect(html).toContain(
      "<td>&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; co</td>",
    );
  });

  it("renders an internal newline as <br>", () => {
    const html = toHtmlTable({ header: ["Notes"], rows: [["Line one\nLine two"]] });
    expect(html).toContain("<td>Line one<br>Line two</td>");
  });
});

describe("toTsv", () => {
  it("joins header + rows with tabs and newlines", () => {
    const tsv = toTsv({ header: ["Customer", "Health"], rows: [["Acme", "Green"], ["Globex", "Amber"]] });
    expect(tsv).toBe("Customer\tHealth\nAcme\tGreen\nGlobex\tAmber");
  });

  it("replaces a tab or newline inside a cell with a space", () => {
    const tsv = toTsv({ header: ["Notes"], rows: [["Line one\nLine two\twith a tab"]] });
    expect(tsv).toBe("Notes\nLine one Line two with a tab");
  });
});
